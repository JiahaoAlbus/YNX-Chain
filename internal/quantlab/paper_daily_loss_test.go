package quantlab

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPaperDailyMarkedLossPersistsLatchAndUTCReset(t *testing.T) {
	testPaperDailyMarkedLoss(t, Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
}

func TestPostgreSQLPaperDailyMarkedLossPersistsLatchAndUTCReset(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	testPaperDailyMarkedLoss(t, Config{StatePath: filepath.Join(t.TempDir(), "unused.json"), DatabaseURL: databaseURL, StateNamespace: fmt.Sprintf("quant-daily-it-%d", time.Now().UnixNano())})
}

func testPaperDailyMarkedLoss(t *testing.T, cfg Config) {
	t.Helper()
	now := time.Date(2026, 10, 3, 23, 0, 0, 0, time.UTC)
	cfg.Now = func() time.Time { return now }
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	if store, ok := s.store.(*postgresStateStore); ok {
		t.Cleanup(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key = $1`, cfg.StateNamespace); err != nil {
				t.Error(err)
			}
		})
	}
	digest := strings.Repeat("a", 64)
	if _, err := s.ApplyPaperSignal(digest, "buy", 200_000_000, 10_000_000, 100_000_000); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	// Position10 tokens drops from200 to100: exactly1000 units loss.
	if _, err := reopened.ApplyPaperSignal(digest, "sell", 100_000_000, 1_000_000, 10_000_000); !errors.Is(err, ErrForbidden) {
		t.Fatalf("threshold error=%v", err)
	}
	p := s.Snapshot()["paper"].(PaperState)
	if p.DailyRisk == nil || !p.DailyRisk.Breached || p.DailyRisk.Loss != 1_000_000_000 || len(p.Orders) != 1 || p.Position != 10_000_000 {
		t.Fatalf("risk=%+v paper=%+v", p.DailyRisk, p)
	}
	// Recovery of price cannot clear the same-day breach or create an order.
	if _, err := s.ApplyPaperSignal(digest, "sell", 200_000_000, 1_000_000, 10_000_000); !errors.Is(err, ErrForbidden) {
		t.Fatalf("latch error=%v", err)
	}
	now = now.Add(2 * time.Hour)
	if _, err := reopened.ApplyPaperSignal(digest, "sell", 100_000_000, 1_000_000, 10_000_000); err != nil {
		t.Fatal(err)
	}
	p = s.Snapshot()["paper"].(PaperState)
	if p.DailyRisk.Day != "2026-10-04" || p.DailyRisk.Breached || p.DailyRisk.Loss != 0 || len(p.Orders) != 2 {
		t.Fatalf("next-day=%+v", p)
	}
	if _, err := s.Kill("manual stop survives daily reset"); err != nil {
		t.Fatal(err)
	}
	now = now.Add(24 * time.Hour)
	if _, err := reopened.ApplyPaperSignal(digest, "sell", 100_000_000, 1_000_000, 10_000_000); !errors.Is(err, ErrForbidden) {
		t.Fatalf("daily reset bypassed kill: %v", err)
	}
}

func TestPaperDailyRiskExactArithmeticLegacyAndClockFence(t *testing.T) {
	now := time.Date(2026, 10, 3, 8, 0, 0, 0, time.FixedZone("QA+8", 8*3600))
	risk, err := paperDailyRisk(PaperState{Cash: 10, Position: -1_000_000}, 3, now, 2)
	if err != nil || risk.OpeningEquity != 7 || risk.Day != "2026-10-03" {
		t.Fatalf("short=%+v %v", risk, err)
	}
	if _, err := paperDailyRisk(PaperState{Cash: math.MaxInt64, Position: 1_000_000}, 1, now, 2); !errors.Is(err, ErrInvalid) {
		t.Fatal("overflow accepted")
	}
	prior := *risk
	prior.Day = "2026-10-04"
	if _, err := paperDailyRisk(PaperState{DailyRisk: &prior}, 3, now, 2); !errors.Is(err, ErrInvalid) {
		t.Fatal("clock rollback accepted")
	}
	prior.Day = "2026-10-03"
	prior.Policy = "unknown"
	if _, err := paperDailyRisk(PaperState{DailyRisk: &prior}, 3, now, 2); !errors.Is(err, ErrInvalid) {
		t.Fatal("unknown policy accepted")
	}
	encoded, err := json.Marshal(PaperState{Cash: 123})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "DailyRisk") {
		t.Fatal("legacy integrity representation changed")
	}
}

func TestPaperDailyLossHTTPReturnsPreciseRejectionWithoutOrder(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: &submissionMarket{}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	experiment, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	digest := experiment.Strategy.StrategyHash
	if _, err := s.ApplyPaperSignal(digest, "buy", 200_000_000, 10_000_000, 100_000_000); err != nil {
		t.Fatal(err)
	}
	body := `{"strategyHash":"` + digest + `","side":"sell","amount":1000000,"idempotencyKey":"typed-daily-rejection"}`
	r := httptest.NewRequest(http.MethodPost, "/v1/paper/orders", strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:23456"
	r.Header.Set("X-YNX-Preview-Mode", "local-paper")
	w := httptest.NewRecorder()
	NewServer(s).ServeHTTP(w, r)
	var problem map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &problem); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusForbidden || problem["error"] != "paper_daily_loss_limit" || problem["errorId"] == "" {
		t.Fatalf("status=%d body=%v", w.Code, problem)
	}
	p := s.Snapshot()["paper"].(PaperState)
	if len(p.Orders) != 1 || p.DailyRisk == nil || !p.DailyRisk.Breached {
		t.Fatalf("unconfirmed order or missing risk: %+v", p)
	}
	if !errors.Is(ErrPaperDailyLoss, ErrForbidden) {
		t.Fatal("forbidden compatibility lost")
	}
}
