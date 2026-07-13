package resourcegateway

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestResourceSponsorRoutesProxyAuthoritativeAndStayUnclaimedInBFT(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]int{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_ = json.NewEncoder(w).Encode(map[string]any{"chainId": 6423, "height": 1, "network": "YNX Testnet", "nativeCurrencySymbol": "YNXT"})
			return
		}
		if r.Header.Get("X-YNX-Resource-Gateway-Upstream-Key") != testUpstreamKey {
			http.Error(w, "missing upstream key", http.StatusUnauthorized)
			return
		}
		mu.Lock()
		seen[r.Method+" "+r.URL.Path]++
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusCreated)
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()
	service, err := New(Config{ChainURL: upstream.URL, APIKey: testAPIKey, UpstreamKey: testUpstreamKey, AuditLog: t.TempDir() + "/audit.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()
	for _, route := range []struct {
		method string
		path   string
		status int
	}{
		{http.MethodPost, "/resource-market/pools", http.StatusCreated},
		{http.MethodGet, "/resource-market/pools", http.StatusOK},
		{http.MethodPost, "/resource-market/pools/rsp_1/fund", http.StatusCreated},
		{http.MethodPost, "/resource-market/pools/rsp_1/policy", http.StatusCreated},
		{http.MethodPost, "/resource-market/pools/rsp_1/status", http.StatusCreated},
		{http.MethodPost, "/resource-market/sponsorships", http.StatusCreated},
		{http.MethodGet, "/resource-market/sponsorships", http.StatusOK},
		{http.MethodGet, "/resource-market/sponsor-audit", http.StatusOK},
	} {
		doResourceJSON(t, route.method, server.URL+route.path, map[string]any{"test": true}, route.status, nil)
	}
	mu.Lock()
	if len(seen) != 8 {
		t.Fatalf("not all sponsor routes reached authoritative upstream: %+v", seen)
	}
	mu.Unlock()

	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 99))
	signer, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	bft, err := New(Config{ChainURL: upstream.URL, APIKey: testAPIKey, UpstreamMode: UpstreamBFT, SignerKey: hex.EncodeToString(key.Serialize()), SignerAddress: signer, ChainID: 6423, AuditLog: t.TempDir() + "/bft-audit.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := bft.Proxy(context.Background(), http.MethodPost, "/resource-market/pools", "", []byte(`{}`), "bft-unclaimed")
	if err != nil || result.Status != http.StatusNotImplemented || !strings.Contains(string(result.Body), "remains unclaimed") {
		t.Fatalf("BFT sponsor capability was not truthfully bounded: %+v %v", result, err)
	}
}
