package exchangeproduct

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestExistingPublicConfigRealHTTPConsumerOfflineRecovery(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node unavailable; actual consumer integration NOT_RUN")
	}
	s, _, _ := newTestService(t)
	var reads atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/config" || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("X-YNX-Product-Session-Proof-V2") != "" {
			t.Error("public consumer attempted an unauthorized or non-read route")
			http.Error(w, "fixture refused", http.StatusForbidden)
			return
		}
		reads.Add(1)
		http.StripPrefix("/api", NewServer(s)).ServeHTTP(w, r)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, node, filepath.Join("..", "..", "apps", "exchange", "tests", "http-venue-config.mjs"), server.URL, strconv.FormatInt(s.cfg.WithdrawalFeeMicroYNXT, 10))
	output, err := command.CombinedOutput()
	if err != nil || reads.Load() != 2 || !strings.Contains(string(output), "EXCHANGE_REAL_HTTP_CONFIG_RECOVERY_PASS;reads=2;writes=0;writeAuthorized=false") {
		t.Fatalf("real config consumer reads=%d err=%v output=%s", reads.Load(), err, output)
	}
}
