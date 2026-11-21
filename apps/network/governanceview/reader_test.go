package governanceview

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestGovernanceUpstreamAccessAndMethodStatus(t *testing.T) {
	id := strings.Repeat("a", 64)
	for _, tc := range []struct {
		status int
		code   string
	}{
		{http.StatusUnauthorized, "ACCESS_RESTRICTED"},
		{http.StatusForbidden, "ACCESS_RESTRICTED"},
		{http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED"},
	} {
		t.Run(fmt.Sprint(tc.status), func(t *testing.T) {
			var requests atomic.Int32
			httpSource := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				if r.Method != http.MethodGet || (r.URL.Path != "/governance/proposals" && r.URL.Path != "/governance/proposals/"+id) {
					t.Errorf("unexpected upstream request: %s %s", r.Method, r.URL.Path)
				}
				if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
					t.Error("local credentials reached upstream")
				}
				w.Header().Set("Content-Type", "text/plain")
				w.Header().Set("WWW-Authenticate", "Bearer")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte("untrusted upstream error body"))
			}))
			defer httpSource.Close()
			reader, err := New(httpSource.URL, nil)
			if err != nil {
				t.Fatal(err)
			}
			list := reader.ListProposals(context.Background())
			detail := reader.Proposal(context.Background(), id)
			for _, m := range []Metadata{list.Metadata, detail.Metadata} {
				if m.Code != tc.code || m.Classification != "RPC_ONLY" || m.Authority ||
					m.WalletApproval || m.NativeEligibility || m.ChainFinality || m.Source != nil ||
					m.Version != nil || m.AsOf != nil || m.ResponseSHA256 != nil {
					t.Errorf("want %s and no source claims, got %+v", tc.code, m)
				}
			}
			if len(list.Proposals) != 0 || list.ReportedCount != nil || list.ReturnedCount != "0" || list.Truncated || detail.Proposal != nil || requests.Load() != 2 {
				t.Error("source refusal exposed data or caused a fallback request")
			}
		})
	}
}
