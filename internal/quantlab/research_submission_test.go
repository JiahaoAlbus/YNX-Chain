package quantlab

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

const researchFixtureKey = "quant-research-12345678-1234-1234-1234-123456789abc"

type replayResearchMarket struct{ calls atomic.Int64 }

func (m *replayResearchMarket) History(string, int) ([]Bar, string, error) {
	m.calls.Add(1)
	return bars(), "fixture://actual-matches", nil
}
func (*replayResearchMarket) Latest(string) (MarketTick, error) { return MarketTick{}, ErrUnavailable }

func TestResearchSubmissionReplayConflictRestartAndReceiptIsolation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	market := &replayResearchMarket{}
	s, err := New(Config{StatePath: path, MarketData: market})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r := request()
	first, err := s.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, researchFixtureKey)
	if err != nil {
		t.Fatal(err)
	}
	if first.ResearchRequestKey != researchFixtureKey || first.ResearchRequestDigest == "" {
		t.Fatal("missing correlation")
	}
	before, _ := os.ReadFile(path)
	for _, key := range []string{"", "short", researchFixtureKey + "/../bad", strings.ToUpper(researchFixtureKey)} {
		if _, err := s.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, key); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid key: %v", err)
		}
	}
	changed := r.Assumptions
	changed.FeeBPS++
	if _, err := s.RunBacktestFromMarketOnce(r.Strategy, changed, researchFixtureKey); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed costs: %v", err)
	}
	r.Strategy.Name = "Changed name"
	if _, err := s.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, researchFixtureKey); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed request: %v", err)
	}
	after, _ := os.ReadFile(path)
	if !reflect.DeepEqual(before, after) || market.calls.Load() != 1 {
		t.Fatal("rejection changed persisted state or read market")
	}
	restarted, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	r = request()
	replayed, err := restarted.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, researchFixtureKey)
	if err != nil || !reflect.DeepEqual(first, replayed) {
		t.Fatalf("restart replay failed: %v", err)
	}
	replayed.Strategy.Params["fast"] = 99
	replayed.EquityCurve[0].Equity = 0
	latest, err := restarted.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, researchFixtureKey)
	if err != nil || !reflect.DeepEqual(first, latest) {
		t.Fatal("caller mutated stored receipt")
	}
	if len(restarted.Snapshot()["experiments"].(map[string]Experiment)) != 1 {
		t.Fatal("duplicate experiment")
	}
}

func TestResearchSubmissionConcurrentInstancesAndTenantIsolation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	market := &replayResearchMarket{}
	a, err := New(Config{StatePath: path, MarketData: market})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := New(Config{StatePath: path, MarketData: market})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	var wg sync.WaitGroup
	results := make(chan Experiment, 12)
	failures := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			r := request()
			s := a
			if index%2 == 1 {
				s = b
			}
			result, err := s.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, researchFixtureKey)
			if err != nil {
				failures <- err
			} else {
				results <- result
			}
		}(i)
	}
	wg.Wait()
	close(results)
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	var first Experiment
	count := 0
	for result := range results {
		if count == 0 {
			first = result
		} else if !reflect.DeepEqual(first, result) {
			t.Fatal("different concurrent receipts")
		}
		count++
	}
	if count != 12 {
		t.Fatalf("receipts=%d", count)
	}
	if len(a.Snapshot()["experiments"].(map[string]Experiment)) != 1 {
		t.Fatal("duplicate concurrent commits")
	}
	other, err := New(Config{StatePath: filepath.Join(t.TempDir(), "other.json"), MarketData: market})
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	r := request()
	r.Strategy.Name = "Independent tenant research"
	result, err := other.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, researchFixtureKey)
	if err != nil || result.Strategy.Name == first.Strategy.Name {
		t.Fatal("tenant key mixed records")
	}
}

func TestResearchSubmissionHTTPInvalidBindingAndReplayedReceipt(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: &replayResearchMarket{}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	server := NewServer(s)
	r := request()
	invoke := func(body []byte) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/backtests/from-market", strings.NewReader(string(body)))
		req.RemoteAddr = "127.0.0.1:12345"
		req.Header.Set("X-YNX-Preview-Mode", "local-paper")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, req)
		return w
	}
	payload := map[string]any{"strategy": r.Strategy, "assumptions": r.Assumptions}
	for _, key := range []any{nil, "", 7, "bad"} {
		payload["idempotencyKey"] = key
		bytes, _ := json.Marshal(payload)
		w := invoke(bytes)
		if w.Code != 400 {
			t.Fatalf("invalid key status %d body %s", w.Code, w.Body.String())
		}
	}
	payload["idempotencyKey"] = researchFixtureKey
	bytes, _ := json.Marshal(payload)
	var previous string
	for i := 0; i < 2; i++ {
		w := invoke(bytes)
		if w.Code != 201 {
			t.Fatalf("replay status %d %s", w.Code, w.Body.String())
		}
		if i > 0 && w.Body.String() != previous {
			t.Fatal("HTTP replay bytes changed")
		}
		previous = w.Body.String()
	}
}
