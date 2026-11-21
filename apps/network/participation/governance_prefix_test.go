package participation

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// The same host-supplied source is used by both governanceview and the local
// participation reader. This fixture is a local HTTP test, not chain evidence.
func TestParticipationUsesFixedGovernancePrefix(t *testing.T) {
	var governanceCalls, chainCalls atomic.Int32
	gov := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		governanceCalls.Add(1)
		if r.Method != http.MethodGet || r.URL.Path != "/fixed-prefix/governance/parameters" || r.URL.RawQuery != "" {
			t.Errorf("unexpected governance route: %s %s", r.Method, r.URL.String())
			http.Error(w, "unexpected", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"source":"ynx-governance-authoritative-state","version":"ynx-governance-api/v1","data":{"fixture":true}}`))
	}))
	defer gov.Close()
	chain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chainCalls.Add(1)
		http.Error(w, "no governance fallback", http.StatusBadRequest)
	}))
	defer chain.Close()
	network := Network{Genesis: strings.Repeat("a", 64), NetworkID32: strings.Repeat("b", 64), NativeChainID: "6423", CometChainID: "PUBLIC-comet"}
	reader, err := NewHTTPReader(gov.URL+"/fixed-prefix/", chain.URL, network, nil)
	if err != nil {
		t.Fatal(err)
	}
	report, err := reader.ReadGovernanceParameters(context.Background())
	if err != nil || report.Source != "ynx-governance-authoritative-state" || governanceCalls.Load() != 1 || chainCalls.Load() != 0 {
		t.Fatalf("fixed prefix or source mismatch: %+v %v governance=%d chain=%d", report, err, governanceCalls.Load(), chainCalls.Load())
	}
	for _, invalid := range []string{gov.URL + "/fixed-prefix//", gov.URL + "/fixed-prefix/../other", gov.URL + "/fixed-prefix%2fother", gov.URL + "/fixed-prefix?", gov.URL + "/fixed-prefix?source=other", gov.URL + "/fixed-prefix#fragment", "http://not-loopback.invalid/fixed-prefix", "https://user:secret@example.invalid/fixed-prefix"} {
		if _, err := NewHTTPReader(invalid, chain.URL, network, nil); err == nil {
			t.Errorf("accepted noncanonical source")
		}
	}
	if _, err := NewHTTPReader(gov.URL+"/fixed-prefix", chain.URL+"/unexpected", network, nil); err == nil {
		t.Error("accepted changed chain root")
	}
	if governanceCalls.Load() != 1 || chainCalls.Load() != 0 {
		t.Fatal("configuration validation made a request or changed source")
	}
}
