package quantlab

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"
)

func TestBoundedNativePaperHistoryPreservesDurableRecordsAndRejectsStalePages(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.json")
	s, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	// Persisted test data, not claims of market provenance or public approval.
	for n := 0; n < 43; n++ {
		id := fmt.Sprintf("fixture-%03d", n)
		curve := make([]EquityPoint, 5000)
		for i := range curve {
			curve[i] = EquityPoint{Time: time.Unix(int64(i+1), 0).UTC(), Equity: int64(1000 + i), BenchmarkEquity: 1000}
		}
		s.state.Experiments[id] = Experiment{ID: id, CreatedAt: time.Unix(int64(n+1), 0).UTC(), EquityCurve: curve}
		s.audit("backtest_completed", id, hash(id))
	}
	if err = s.save(); err != nil {
		t.Fatal(err)
	}
	legacyBytes, err := json.Marshal(s.state.Experiments)
	if err != nil || len(legacyBytes) <= 2097152 {
		t.Fatal("fixture does not exercise the original response limit")
	}
	read := func(service *Service, path string) (map[string]json.RawMessage, error) {
		value, err := service.boundedPaperHistory(httptest.NewRequest("GET", path, nil))
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		var result map[string]json.RawMessage
		err = json.Unmarshal(encoded, &result)
		return result, err
	}
	first, err := read(s, "/v1/wallet/paper/snapshot?history=bounded_v1")
	if err != nil {
		t.Fatal(err)
	}
	var meta struct {
		Revision string
		Offset   int
		HasNext  bool
		Counts   map[string]int
	}
	_ = json.Unmarshal(first["history"], &meta)
	var rows map[string]Experiment
	_ = json.Unmarshal(first["experiments"], &rows)
	if len(rows) != 20 || meta.Counts["experiments"] != 43 || !meta.HasNext {
		t.Fatal("history silently truncated")
	}
	for _, row := range rows {
		if row.EquityCurve != nil {
			t.Fatal("index returned full curve")
		}
	}
	raw, _ := json.Marshal(first)
	if len(raw) > 100000 {
		t.Fatal("index grew with curve history")
	}
	seen := map[string]bool{}
	for id := range rows {
		seen[id] = true
	}
	// Independent process/reload observation accepts the same durable revision.
	restarted, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	for _, offset := range []int{20, 40} {
		page, err := read(restarted, fmt.Sprintf("/v1/wallet/paper/snapshot?history=bounded_v1&offset=%d&revision=%s", offset, url.QueryEscape(meta.Revision)))
		if err != nil {
			t.Fatal(err)
		}
		rows = nil
		_ = json.Unmarshal(page["experiments"], &rows)
		for id := range rows {
			if seen[id] {
				t.Fatal("duplicate pagination record")
			}
			seen[id] = true
		}
	}
	if len(seen) != 43 {
		t.Fatal("records lost between pages")
	}
	detail, err := read(restarted, "/v1/wallet/paper/experiment?id=fixture-042&revision="+url.QueryEscape(meta.Revision))
	if err != nil {
		t.Fatal(err)
	}
	var result Experiment
	_ = json.Unmarshal(detail["experiment"], &result)
	if len(result.EquityCurve) != 200 || result.EquityCurve[0] != s.state.Experiments[result.ID].EquityCurve[0] || result.EquityCurve[199] != s.state.Experiments[result.ID].EquityCurve[4999] {
		t.Fatal("sample invented values/endpoints")
	}
	if len(restarted.state.Experiments[result.ID].EquityCurve) != 5000 {
		t.Fatal("reader mutated saved curve")
	}
	for _, path := range []string{"/v1/wallet/paper/snapshot?history=bounded_v1&offset=1", "/v1/wallet/paper/snapshot?history=bounded_v1&offset=20", "/v1/wallet/paper/snapshot?history=bounded_v1&offset=00", "/v1/wallet/paper/snapshot?history=bounded_v1&tenant=other", "/v1/wallet/paper/snapshot?history=bounded_v1&history=bounded_v1", "/v1/wallet/paper/experiment?id=foreign&revision=" + url.QueryEscape(meta.Revision)} {
		if _, err := read(s, path); err == nil {
			t.Fatal("invalid/foreign selector accepted", path)
		}
	}
	s.audit("backtest_completed", "new", hash("new"))
	if err = s.save(); err != nil {
		t.Fatal(err)
	}
	if _, err = read(restarted, "/v1/wallet/paper/snapshot?history=bounded_v1&offset=20&revision="+url.QueryEscape(meta.Revision)); err != ErrConflict {
		t.Fatal("stale cursor did not conflict", err)
	}
	// Point 1 is not among the 200 projected indices: validation must still
	// reject it rather than hiding unsafe/nonmonotonic data behind sampling.
	broken := s.state.Experiments["fixture-042"]
	broken.EquityCurve[1].Time = broken.EquityCurve[0].Time
	s.state.Experiments[broken.ID] = broken
	s.audit("backtest_completed", "corrupt-fixture", hash("corrupt-fixture"))
	if err = s.save(); err != nil {
		t.Fatal(err)
	}
	current, err := read(restarted, "/v1/wallet/paper/snapshot?history=bounded_v1")
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(current["history"], &meta)
	if _, err = read(restarted, "/v1/wallet/paper/experiment?id=fixture-042&revision="+url.QueryEscape(meta.Revision)); err != ErrUnavailable {
		t.Fatal("projection hid invalid original point", err)
	}
}
