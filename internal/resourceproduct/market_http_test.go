package resourceproduct

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func marketPOST(t *testing.T, url, token string, body any) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, url+"/api/market/actions", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status=%d body=%v", resp.StatusCode, out)
	}
	return out
}

func TestMarketHTTPProviderOfferQuoteAndScopedState(t *testing.T) {
	now := time.Now().UTC()
	svc, err := New(Config{StorePath: filepath.Join(t.TempDir(), "product.json"), MarketStorePath: filepath.Join(t.TempDir(), "market.json"), Sessions: map[string]Actor{"provider-token": {ID: "provider-wallet", Role: "user"}, "verifier-token": {ID: "verifier", Role: "resource_verifier"}, "buyer-token": {ID: "buyer-wallet", Role: "user"}, "auction-token": {ID: "auction-operator", Role: "auction_operator"}, "retention-token": {ID: "retention-operator", Role: "retention_operator"}}})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(svc.Handler(http.NotFoundHandler()))
	defer ts.Close()
	source := map[string]any{"kind": "provider_attestation", "uri": "ynx-evidence://provider/1", "asOf": now, "version": "1", "status": "available"}
	registered := marketPOST(t, ts.URL, "provider-token", map[string]any{"type": "register_provider", "provider": map[string]any{"wallet": "provider-wallet", "name": "Provider One", "region": "cn-east", "hardware": []string{"cpu-worker"}, "securityBond": 100, "source": source}})
	p := registered["result"].(map[string]any)
	providerID := p["id"].(string)
	if p["status"] != "pending_verification" {
		t.Fatalf("provider=%v", p)
	}
	if _, legacy := p["ID"]; legacy {
		t.Fatal("market API leaked non-canonical JSON field names")
	}
	marketPOST(t, ts.URL, "verifier-token", map[string]any{"type": "verify_provider", "providerId": providerID, "provider": map[string]any{"evidence": []string{"independent-attestation"}}})
	public, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	worker := marketPOST(t, ts.URL, "provider-token", map[string]any{"type": "register_worker_key", "providerId": providerID, "keyId": "http-worker-1", "publicKey": base64.RawURLEncoding.EncodeToString(public), "expiresAt": now.Add(time.Hour), "source": source})["result"].(map[string]any)
	if worker["status"] != "active" || worker["algorithm"] != "Ed25519" {
		t.Fatalf("worker=%v", worker)
	}
	expires := now.Add(time.Hour)
	offerOut := marketPOST(t, ts.URL, "provider-token", map[string]any{"type": "publish_offer", "offer": map[string]any{"providerId": providerID, "resource": "cpu_compute", "unit": "vcpu-second", "pricing": "fixed", "currency": "YNXT-testnet", "unitPrice": 2, "capacity": 1000, "minUnits": 1, "maxUnits": 500, "source": source, "expiresAt": expires}})
	offerID := offerOut["result"].(map[string]any)["id"].(string)
	quoteOut := marketPOST(t, ts.URL, "buyer-token", map[string]any{"type": "create_quote", "offerId": offerID, "units": 100, "protocolFee": 5})
	q := quoteOut["result"].(map[string]any)
	if q["status"] != "quote" || q["grossCost"].(float64) != 205 {
		t.Fatalf("quote=%v", q)
	}
	auctionOffer := marketPOST(t, ts.URL, "provider-token", map[string]any{"type": "publish_offer", "offer": map[string]any{"providerId": providerID, "resource": "cpu_compute", "unit": "vcpu-second", "pricing": "reverse_auction", "currency": "YNXT-testnet", "unitPrice": 3, "capacity": 1000, "minUnits": 1, "maxUnits": 500, "source": source, "expiresAt": now.Add(2 * time.Hour)}})["result"].(map[string]any)
	auction := marketPOST(t, ts.URL, "buyer-token", map[string]any{"type": "create_auction", "mode": "reverse_auction", "resource": "cpu_compute", "currency": "YNXT-testnet", "units": 100, "maxUnitPrice": 3, "protocolFeeBps": 100, "closesAt": now.Add(time.Hour), "source": source})["result"].(map[string]any)
	marketPOST(t, ts.URL, "provider-token", map[string]any{"type": "submit_auction_bid", "auctionId": auction["id"], "offerId": auctionOffer["id"], "units": 100, "unitPrice": 2, "source": source})
	marketPOST(t, ts.URL, "buyer-token", map[string]any{"type": "request_erasure", "reason": "privacy lifecycle API test", "source": source})
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/market/state", nil)
	req.Header.Set("Authorization", "Bearer buyer-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var state map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&state)
	if resp.StatusCode != 200 || len(state["quotes"].([]any)) != 1 || len(state["orders"].([]any)) != 0 || len(state["auctions"].([]any)) != 1 || len(state["auctionBids"].([]any)) != 0 || len(state["erasureRequests"].([]any)) != 1 {
		t.Fatalf("state=%v", state)
	}
	providerStateReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/market/state", nil)
	providerStateReq.Header.Set("Authorization", "Bearer provider-token")
	providerStateResp, err := http.DefaultClient.Do(providerStateReq)
	if err != nil {
		t.Fatal(err)
	}
	defer providerStateResp.Body.Close()
	var providerState map[string]any
	_ = json.NewDecoder(providerStateResp.Body).Decode(&providerState)
	if len(providerState["auctionBids"].([]any)) != 1 {
		t.Fatalf("provider sealed bid visibility=%v", providerState)
	}
	exportReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/market/export", nil)
	exportReq.Header.Set("Authorization", "Bearer buyer-token")
	exportResp, err := http.DefaultClient.Do(exportReq)
	if err != nil {
		t.Fatal(err)
	}
	defer exportResp.Body.Close()
	var exported map[string]any
	_ = json.NewDecoder(exportResp.Body).Decode(&exported)
	if exportResp.StatusCode != 200 || exportResp.Header.Get("X-YNX-Export-Scope") != "authenticated-actor" || len(exported["quotes"].([]any)) != 1 {
		t.Fatalf("export headers=%v payload=%v", exportResp.Header, exported)
	}
	unauth, _ := http.Get(ts.URL + "/api/market/state")
	if unauth.StatusCode != 401 {
		t.Fatalf("unauthenticated state=%d", unauth.StatusCode)
	}
	if unauth.Header.Get("X-Request-ID") == "" || unauth.Header.Get("X-Trace-ID") == "" || unauth.Header.Get("X-Error-ID") == "" {
		t.Fatalf("correlation headers missing: %v", unauth.Header)
	}
	_ = unauth.Body.Close()
	metricsResp, err := http.Get(ts.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer metricsResp.Body.Close()
	if metricsResp.Header.Get("X-Request-ID") == "" {
		t.Fatal("request ID missing")
	}
	if metricsResp.Header.Get("X-Trace-ID") == "" {
		t.Fatal("trace ID missing")
	}
	var metrics map[string]any
	_ = json.NewDecoder(metricsResp.Body).Decode(&metrics)
	if metrics["requestsTotal"].(float64) < 1 || metrics["source"] != "in-process counters" {
		t.Fatalf("metrics=%v", metrics)
	}
	statusResp, err := http.Get(ts.URL + "/status")
	if err != nil {
		t.Fatal(err)
	}
	defer statusResp.Body.Close()
	var operational map[string]any
	_ = json.NewDecoder(statusResp.Body).Decode(&operational)
	if operational["status"] != "operational" || operational["coverage"] == "" {
		t.Fatalf("operational status=%v", operational)
	}
	versionResp, err := http.Get(ts.URL + "/version")
	if err != nil {
		t.Fatal(err)
	}
	defer versionResp.Body.Close()
	var version map[string]any
	_ = json.NewDecoder(versionResp.Body).Decode(&version)
	if version["releaseClass"] != "unreleased-local-candidate" || version["marketSchemaVersion"].(float64) != 5 {
		t.Fatalf("version=%v", version)
	}
}
