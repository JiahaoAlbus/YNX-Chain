package quantlab

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type barIntegrityMarket struct {
	rows  []Bar
	calls int
}

func (m *barIntegrityMarket) History(string, int) ([]Bar, string, error) {
	m.calls++
	return append([]Bar(nil), m.rows...), "fixture://bar-integrity-tape", nil
}
func (*barIntegrityMarket) Latest(string) (MarketTick, error) { return MarketTick{}, ErrUnavailable }

func TestResearchInvalidOHLCOrTimeCannotPersistAnExperiment(t *testing.T) {
	cases := map[string]func(*Bar){
		"zero-time":        func(b *Bar) { b.Time = time.Time{} },
		"nonpositive-open": func(b *Bar) { b.Open = 0 },
		"nonpositive-low":  func(b *Bar) { b.Low = 0 },
		"open-above-high":  func(b *Bar) { b.Open = b.High + 1 },
		"open-below-low":   func(b *Bar) { b.Open = b.Low - 1 },
		"close-above-high": func(b *Bar) { b.Close = b.High + 1 },
		"close-below-low":  func(b *Bar) { b.Close = b.Low - 1 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			r := request()
			mutate(&r.Bars[0])
			before := hash(s.state)
			x, err := s.RunBacktest(r)
			if !errors.Is(err, ErrInvalid) || x.ID != "" {
				t.Fatalf("invalid bar accepted: id=%q error=%v", x.ID, err)
			}
			if hash(s.state) != before {
				t.Fatal("invalid tape changed saved research state")
			}
		})
	}
}

func TestSavedResearchRejectsBadTapeThenRecoversSameIntentAndReopens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	r := request()
	market := &barIntegrityMarket{rows: append([]Bar(nil), r.Bars...)}
	s, err := New(Config{StatePath: path, MarketData: market})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// Retain a pre-existing valid result, not merely empty process memory.
	if _, err := s.RunBacktest(r); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	market.rows[r.Assumptions.TrainEnd].Close = market.rows[r.Assumptions.TrainEnd].High + 1
	body, err := json.Marshal(map[string]any{"strategy": map[string]any{"ID": r.Strategy.ID, "Name": r.Strategy.Name, "Seed": r.Strategy.Seed, "Params": r.Strategy.Params}, "assumptions": r.Assumptions})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	NewRoleServer(s, "research").ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/public/research/backtests/from-market", bytes.NewReader(body)))
	if w.Code != 400 || !bytes.Contains(w.Body.Bytes(), []byte(`"errorId"`)) {
		t.Fatalf("guest accepted bad tape: %d %s", w.Code, w.Body.String())
	}
	bad, err := s.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, researchFixtureKey)
	if !errors.Is(err, ErrInvalid) || bad.ID != "" {
		t.Fatal("saved research accepted impossible OOS close", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("invalid market tape changed persisted results")
	}
	market.rows = append([]Bar(nil), r.Bars...)
	valid, err := s.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, researchFixtureKey)
	if err != nil || valid.Status != "completed_oos" || !valid.Attribution.Reconciled {
		t.Fatal("corrected tape did not recover original intent", err)
	}
	if market.calls != 3 {
		t.Fatal("market reads were duplicated")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(Config{StatePath: path}) // no live data source on second launch
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := reopened.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, researchFixtureKey)
	if err != nil || hash(replay) != hash(valid) {
		t.Fatal("second launch lost exact saved research receipt", err)
	}
	final, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(saved, final) {
		t.Fatal("offline replay rewrote saved results")
	}
}

func TestResearchValidFlatZeroVolumeAndObservationGapRemainAccepted(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r := request()
	for i := range r.Bars {
		r.Bars[i].Open, r.Bars[i].High, r.Bars[i].Low, r.Bars[i].Close = 1000000, 1000000, 1000000, 1000000
		r.Bars[i].Volume = 0
	}
	r.Bars[len(r.Bars)-1].Time = r.Bars[len(r.Bars)-1].Time.Add(3 * time.Minute)
	x, err := s.RunBacktest(r)
	if err != nil || !x.Metrics.NoTrade || x.Metrics.Trades != 0 || x.Metrics.DataGaps == 0 || !x.Attribution.Reconciled {
		t.Fatal("valid observations were rejected or invented fills", err)
	}
}
