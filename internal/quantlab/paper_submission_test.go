package quantlab

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
)

type submissionMarket struct {
	calls  atomic.Int64
	enter  chan struct{}
	resume chan struct{}
}

func (m *submissionMarket) History(string, int) ([]Bar, string, error) {
	return nil, "", ErrUnavailable
}

func (m *submissionMarket) Latest(string) (MarketTick, error) {
	m.calls.Add(1)
	if m.enter != nil {
		close(m.enter)
		<-m.resume
	}
	return MarketTick{Price: 1_200_000, Volume: 20_000_000, Source: "fixture://synthetic-local-paper-only"}, nil
}

func TestPaperHTTPSubmissionOwnershipReplayAndConflict(t *testing.T) {
	m := &submissionMarket{}
	statePath := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: statePath, MarketData: m})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	experiment, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	digest := experiment.Strategy.StrategyHash
	for _, key := range []string{"", "short", "contains space", strings.Repeat("a", 129)} {
		if _, err := s.SubmitPaperSignalFromMarket(digest, "buy", 1_000_000, key); err != ErrInvalid {
			t.Fatalf("key %q: %v", key, err)
		}
	}
	if _, err := s.SubmitPaperSignalFromMarket(strings.Repeat("a", 64), "buy", 1_000_000, "unknown-strategy"); err != ErrForbidden {
		t.Fatalf("unknown strategy: %v", err)
	}
	if m.calls.Load() != 0 {
		t.Fatal("invalid/unowned request reached market adapter")
	}
	first, err := s.SubmitPaperSignalFromMarket(digest, "buy", 1_000_000, "paper-stable-key")
	if err != nil {
		t.Fatal(err)
	}
	if first.IdempotencyKey != "paper-stable-key" || first.Filled != 1_000_000 {
		t.Fatalf("order %+v", first)
	}
	for _, changed := range []struct {
		hash, side string
		amount     int64
	}{
		{digest, "sell", 1_000_000}, {digest, "buy", 2_000_000}, {strings.Repeat("b", 64), "buy", 1_000_000},
	} {
		if _, err := s.SubmitPaperSignalFromMarket(changed.hash, changed.side, changed.amount, "paper-stable-key"); err != ErrConflict {
			t.Fatalf("changed request must conflict: %v", err)
		}
	}
	// Restart without any market adapter: replay is a receipt read, not a new fill.
	reopened, err := New(Config{StatePath: statePath})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	replayed, err := reopened.SubmitPaperSignalFromMarket(digest, "buy", 1_000_000, "paper-stable-key")
	if err != nil || !reflect.DeepEqual(first, replayed) {
		t.Fatalf("replay %+v %v", replayed, err)
	}
	if m.calls.Load() != 1 {
		t.Fatal("replay/conflict fetched market again")
	}
	if orders := reopened.Snapshot()["paper"].(PaperState).Orders; len(orders) != 1 {
		t.Fatalf("orders=%d", len(orders))
	}
}

func TestPaperHTTPSubmissionRechecksStrategyAfterMarketRead(t *testing.T) {
	m := &submissionMarket{enter: make(chan struct{}), resume: make(chan struct{})}
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: m})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	experiment, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, err := s.SubmitPaperSignalFromMarket(experiment.Strategy.StrategyHash, "buy", 1_000_000, "paper-stale-inflight")
		result <- err
	}()
	<-m.enter
	replacement := request()
	replacement.Strategy.Seed++
	if _, err := s.RunBacktest(replacement); err != nil {
		close(m.resume)
		t.Fatal(err)
	}
	close(m.resume)
	if err := <-result; err != ErrForbidden {
		t.Fatalf("stale in-flight hash: %v", err)
	}
	if orders := s.Snapshot()["paper"].(PaperState).Orders; len(orders) != 0 {
		t.Fatal("stale strategy created order")
	}
}

func TestPaperLegacyOrderJSONRemainsCompatible(t *testing.T) {
	b, err := json.Marshal(PaperOrder{ID: "legacy-order"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "IdempotencyKey") {
		t.Fatal("empty key changes legacy serialized order")
	}
	statePath := filepath.Join(t.TempDir(), "legacy-state.json")
	s, err := New(Config{StatePath: statePath})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	order, err := s.ApplyPaperSignal(strings.Repeat("a", 64), "buy", 1_000_000, 500_000, 10_000_000)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(statePath)
	if err != nil || strings.Contains(string(before), "IdempotencyKey") {
		t.Fatalf("legacy state shape changed: %v", err)
	}
	reopened, err := New(Config{StatePath: statePath})
	if err != nil {
		t.Fatalf("legacy integrity rejected: %v", err)
	}
	defer reopened.Close()
	orders := reopened.Snapshot()["paper"].(PaperState).Orders
	if len(orders) != 1 || !reflect.DeepEqual(orders[0], order) {
		t.Fatal("legacy order changed on reopen")
	}
	after, err := os.ReadFile(statePath)
	if err != nil || string(after) != string(before) {
		t.Fatalf("restart rewrote legacy bytes/integrity: %v", err)
	}
}
