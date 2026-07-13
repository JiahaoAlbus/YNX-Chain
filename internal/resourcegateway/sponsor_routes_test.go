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
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestResourceSponsorRoutesProxyAuthoritativeAndRelayClientSignedBFT(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]int{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_ = json.NewEncoder(w).Encode(map[string]any{"chainId": 6423, "height": 1, "network": "YNX Testnet", "nativeCurrencySymbol": "YNXT"})
			return
		}
		if r.Header.Get("X-YNX-Resource-Gateway-Upstream-Key") != testUpstreamKey {
			if r.Method == http.MethodPost && r.URL.Path == "/resource-market/pools" {
				var tx consensus.SignedApplicationAction
				if err := json.NewDecoder(r.Body).Decode(&tx); err != nil || tx.Verify(6423) != nil {
					http.Error(w, "invalid signed action", http.StatusBadRequest)
					return
				}
				raw, _ := consensus.EncodeSignedApplicationAction(tx)
				txHash := consensus.ApplicationActionHash(raw)
				pool := consensus.BFTResourcePool{ResourcePool: chain.ResourcePool{ID: "rsp_" + consensus.ApplicationActionRecordID("resource-pool", txHash), Owner: tx.Signer}, LastAction: tx.Action, LastSigner: tx.Signer, TxHash: txHash}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusCreated)
				_ = json.NewEncoder(w).Encode(map[string]any{"pool": pool, "transaction": chain.Transaction{Hash: txHash, Type: tx.Action, From: tx.Signer, Fee: tx.Fee}})
				return
			}
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

	serviceKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 99))
	serviceSigner, _ := consensus.NativeAddress(serviceKey.PubKey().SerializeCompressed())
	bft, err := New(Config{ChainURL: upstream.URL, APIKey: testAPIKey, UpstreamMode: UpstreamBFT, SignerKey: hex.EncodeToString(serviceKey.Serialize()), SignerAddress: serviceSigner, ChainID: 6423, AuditLog: t.TempDir() + "/bft-audit.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	userKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 100))
	user, _ := consensus.NativeAddress(userKey.PubKey().SerializeCompressed())
	payload := consensus.ResourcePoolCreatePayload{PoolType: "merchant", Name: "Client signed", Public: true, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: chain.ResourceUnits{Bandwidth: 1}, CumulativeAllowance: chain.ResourceUnits{Bandwidth: 2}, ExpiresAt: time.Now().UTC().Add(time.Hour), IdempotencyKey: "client-signed-pool"}
	tx, _ := consensus.NewSignedApplicationAction(userKey, 6423, consensus.ActionResourcePoolCreate, payload, 1)
	raw, _ := consensus.EncodeSignedApplicationAction(tx)
	result, err := bft.Proxy(context.Background(), http.MethodPost, "/resource-market/pools", "", raw, "bft-client-signed")
	if err != nil || result.Status != http.StatusCreated || !strings.Contains(string(result.Body), user) || strings.Contains(string(result.Body), serviceSigner) {
		t.Fatalf("BFT sponsor action was not relayed with the client signer: %+v %v", result, err)
	}
}
