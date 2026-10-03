package quantlab

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// Cancel the real context at a deterministic calculation checkpoint rather
// than relying on a machine-specific sleep or abandoning a worker goroutine.
type calculationCancelContext struct {
	context.Context
	cancel context.CancelFunc
	checks int
	stopAt int
}

func (c *calculationCancelContext) Err() error {
	c.checks++
	if c.checks == c.stopAt {
		c.cancel()
	}
	return c.Context.Err()
}

func TestResearchCancellationStopsInsideCalculationWithoutPersistence(t *testing.T) {
	for _, stopAt := range []int{10, 60, 80, 400} {
		t.Run(fmt.Sprint(stopAt), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state.json")
			s, err := New(Config{StatePath: path})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			if _, err := s.RunBacktest(request()); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			base, cancel := context.WithCancel(context.Background())
			defer cancel()
			ctx := &calculationCancelContext{Context: base, cancel: cancel, stopAt: stopAt}
			_, err = s.RunBacktestContext(ctx, request())
			if !errors.Is(err, context.Canceled) || ctx.checks != stopAt {
				t.Fatalf("calculation did not honor cancellation checkpoint: err=%v checks=%d", err, ctx.checks)
			}
			after, err := os.ReadFile(path)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatal("cancelled calculation changed durable state")
			}
		})
	}
}

type cancelAfterHistoryMarket struct{ cancel context.CancelFunc }

func (m *cancelAfterHistoryMarket) History(string, int) ([]Bar, string, error) {
	m.cancel()
	return bars(), "fixture://returned-research-bars", nil
}
func (*cancelAfterHistoryMarket) Latest(string) (MarketTick, error) {
	return MarketTick{}, ErrUnavailable
}

func TestSavedResearchHTTPDoesNotCommitAfterMarketCancelsRequest(t *testing.T) {
	for _, keyed := range []bool{false, true} {
		t.Run(map[bool]string{false: "legacy", true: "same-request-retry"}[keyed], func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			path := filepath.Join(t.TempDir(), "state.json")
			s, err := New(Config{StatePath: path, MarketData: &cancelAfterHistoryMarket{cancel: cancel}})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			if _, err := s.RunBacktest(request()); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			input := request()
			payload := map[string]any{"strategy": input.Strategy, "assumptions": input.Assumptions}
			if keyed {
				payload["idempotencyKey"] = researchFixtureKey
			}
			body, _ := json.Marshal(payload)
			r := httptest.NewRequest(http.MethodPost, "/v1/backtests/from-market", strings.NewReader(string(body))).WithContext(ctx)
			r.RemoteAddr = "127.0.0.1:12345"
			r.Header.Set("X-YNX-Preview-Mode", "local-paper")
			w := httptest.NewRecorder()
			NewServer(s).ServeHTTP(w, r)
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if w.Code != http.StatusRequestTimeout || !strings.Contains(w.Body.String(), "request_cancelled") || !reflect.DeepEqual(before, after) {
				t.Fatalf("cancelled research committed or reported success: status=%d changed=%v body=%s", w.Code, !reflect.DeepEqual(before, after), w.Body.String())
			}
		})
	}
}

// The first admission check deliberately completes before cancellation; the
// actual service mutex is held until the test cancels and releases it.
type admittedResearchContext struct {
	context.Context
	once     sync.Once
	admitted chan struct{}
}

func (c *admittedResearchContext) Err() error {
	first := false
	c.once.Do(func() { first = true; close(c.admitted) })
	if first {
		return nil
	}
	return c.Context.Err()
}

func TestResearchCancellationWhileWaitingForActualCommitMutexPreservesDisk(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	base, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx := &admittedResearchContext{Context: base, admitted: make(chan struct{})}
	s.mu.Lock()
	done := make(chan error, 1)
	go func() { _, err := s.RunBacktestContext(ctx, request()); done <- err }()
	<-ctx.admitted
	cancel()
	s.mu.Unlock()
	if err := <-done; err != context.Canceled {
		t.Fatalf("cancel after admission: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("cancelled lock waiter changed durable state")
	}
	reopened, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if len(reopened.Snapshot()["experiments"].(map[string]Experiment)) != 1 {
		t.Fatal("cancelled experiment survived restart")
	}
}

func TestCancelledResearchCannotReplayPreviouslySavedReceipt(t *testing.T) {
	market := &replayResearchMarket{}
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: market})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r := request()
	first, err := s.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, researchFixtureKey)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.RunBacktestFromMarketOnceContext(ctx, r.Strategy, r.Assumptions, researchFixtureKey); err != context.Canceled {
		t.Fatalf("cancelled replay: %v", err)
	}
	replayed, err := s.RunBacktestFromMarketOnceContext(context.Background(), r.Strategy, r.Assumptions, researchFixtureKey)
	if err != nil || !reflect.DeepEqual(first, replayed) || market.calls.Load() != 1 {
		t.Fatal("explicit fresh retry lost its original saved receipt")
	}
}
