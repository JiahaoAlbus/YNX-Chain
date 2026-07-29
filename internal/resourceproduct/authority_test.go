package resourceproduct

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/canonicalwallet"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCentralWalletQuoteIntentFailureRetrySettlementBoundary(t *testing.T) {
	now := time.Date(2026, 7, 16, 1, 0, 0, 0, time.UTC)
	binding := strings.Repeat("a", 64)
	devicePrivateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	device := base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(elliptic.P256(), devicePrivateKey.X, devicePrivateKey.Y))
	session := canonicalwallet.Session{VerifierVersion: "wallet-auth-v1", SessionBinding: binding, ChainID: canonicalwallet.ChainID, RequestingProduct: "resource-market", ProductClientID: "ynx-resource-market-v1", BundleID: "com.ynxweb4.resource", Callback: "ynxresource://wallet-auth/callback", ProductDeviceAlgorithm: "p256-sha256", ProductDeviceKey: device, DeviceBinding: strings.Repeat("b", 64), Account: "ynx1buyer", Scopes: []string{"account:read", "resource:analytics", "resource:capacity:read", "resource:dispute", "resource:history", "resource:intent", "resource:quote"}, Nonce: "nonce-resource", Purpose: "bounded resource request", RequestDigest: strings.Repeat("c", 64), ApprovalDigest: strings.Repeat("d", 64), IssuedAt: now.Add(-time.Minute), ExpiresAt: now.Add(5 * time.Minute)}
	var fail atomic.Bool
	seen := []string{}
	central := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path)
		if r.Header.Get("X-YNX-Client") != "ynx-resource-market-v1" {
			t.Errorf("client=%q", r.Header.Get("X-YNX-Client"))
		}
		switch r.URL.Path {
		case "/app/session/wallet-v1/challenge":
			writeJSON(w, 201, map[string]any{"version": "1", "challenge": strings.Repeat("z", 32), "requestDigest": strings.Repeat("c", 64), "productClientId": "ynx-resource-market-v1", "bundleId": "com.ynxweb4.resource", "productDeviceAlgorithm": "p256-sha256", "productDeviceKey": device, "account": "ynx1buyer", "scopes": session.Scopes, "issuedAt": now, "expiresAt": now.Add(2 * time.Minute)})
		case "/app/session/wallet-v1/complete":
			writeJSON(w, 201, session)
		case "/app/resource-market/quote":
			if r.URL.Query().Get("resourceType") != "compute" || r.URL.Query().Get("amount") != "25" {
				t.Errorf("quote query not forwarded: %s", r.URL.RawQuery)
			}
			if r.Header.Get(canonicalwallet.ProductSessionProofHeader) == "" {
				t.Error("quote Product Session proof missing")
			}
			if r.Header.Get("X-YNX-Product-Request-Path") != "/api/authority/quote" {
				t.Errorf("signed product path=%q", r.Header.Get("X-YNX-Product-Request-Path"))
			}
			writeJSON(w, 200, map[string]any{"resourceType": "compute", "amount": 25, "fee": 50, "currency": "YNXT", "source": "authoritative-policy"})
		case "/app/resource-market/rent":
			if fail.Load() {
				writeJSON(w, 503, map[string]string{"error": "authority temporarily unavailable"})
				return
			}
			writeJSON(w, 201, map[string]any{"rental": map[string]any{"id": "rental-authority-1", "status": "committed"}, "transaction": map[string]any{"hash": "0xauthoritytx"}})
		default:
			writeJSON(w, 404, map[string]string{"error": "not found"})
		}
	}))
	defer central.Close()
	path := filepath.Join(t.TempDir(), "state.json")
	svc, err := New(Config{StorePath: path, CentralGatewayURL: central.URL, CentralClientID: "ynx-resource-market-v1", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(svc.Handler(nil))
	defer ts.Close()
	proofHeader := func(method, path string, body []byte) string {
		nonce := make([]byte, 24)
		if _, err := rand.Read(nonce); err != nil {
			t.Fatal(err)
		}
		bodyDigest := sha256.Sum256(body)
		proof, err := canonicalwallet.SignProductSessionProof(canonicalwallet.ProductSessionProof{
			Version: "1", SessionBinding: binding, ProductClientID: session.ProductClientID,
			BundleID: session.BundleID, ProductDeviceKey: device, Method: method, Path: path,
			BodyDigest: hex.EncodeToString(bodyDigest[:]), Nonce: base64.RawURLEncoding.EncodeToString(nonce),
			IssuedAt:  now.Add(-time.Second).Format("2006-01-02T15:04:05.000Z"),
			ExpiresAt: now.Add(30 * time.Second).Format("2006-01-02T15:04:05.000Z"),
		}, devicePrivateKey)
		if err != nil {
			t.Fatal(err)
		}
		header, err := canonicalwallet.EncodeProductSessionProofHeader(proof)
		if err != nil {
			t.Fatal(err)
		}
		return header
	}
	post := func(path string, body any, auth bool) *http.Response {
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, ts.URL+path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		if auth {
			req.Header.Set(canonicalwallet.ProductSessionProofHeader, proofHeader(http.MethodPost, path, raw))
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	challengeResp := post("/api/auth/session/challenge", map[string]any{"authorizationRequest": map[string]any{}, "walletApproval": map[string]any{}}, false)
	if challengeResp.StatusCode != 201 {
		t.Fatalf("challenge=%d", challengeResp.StatusCode)
	}
	challengeResp.Body.Close()
	resp := post("/api/auth/session/complete", map[string]any{"registryEntry": map[string]any{}, "authorizationRequest": map[string]any{}, "walletApproval": map[string]any{}, "gatewayCompletion": map[string]any{}}, false)
	if resp.StatusCode != 201 {
		t.Fatalf("verify=%d", resp.StatusCode)
	}
	resp.Body.Close()
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/authority/quote?resourceType=compute&amount=25", nil)
	req.Header.Set(canonicalwallet.ProductSessionProofHeader, proofHeader(http.MethodGet, "/api/authority/quote", nil))
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 200 {
		t.Fatalf("quote=%d", resp.StatusCode)
	}
	resp.Body.Close()
	payload := json.RawMessage(`{"address":"ynx1buyer","resourceType":"compute","amount":25,"idempotencyKey":"signed-rent-1","signature":"wallet-signed-envelope"}`)
	input := map[string]any{"kind": "rental", "idempotencyKey": "intent-1", "payload": payload}
	fail.Store(true)
	resp = post("/api/authority/intents", input, true)
	var failed struct {
		Intent PurchaseIntent `json:"intent"`
	}
	json.NewDecoder(resp.Body).Decode(&failed)
	resp.Body.Close()
	if resp.StatusCode != 503 || failed.Intent.Status != "failed" || failed.Intent.FeeSettlement == "" {
		t.Fatalf("failed intent status=%d %+v", resp.StatusCode, failed.Intent)
	}
	fail.Store(false)
	resp = post("/api/authority/intents/"+failed.Intent.ID+"/retry", input, true)
	var recovered struct {
		Intent PurchaseIntent `json:"intent"`
	}
	json.NewDecoder(resp.Body).Decode(&recovered)
	resp.Body.Close()
	if resp.StatusCode != 200 || recovered.Intent.Status != "authority_confirmed_capacity" || recovered.Intent.TransactionHash != "0xauthoritytx" || recovered.Intent.AuthorityObjectID != "rental-authority-1" {
		t.Fatalf("recovered status=%d %+v", resp.StatusCode, recovered.Intent)
	}
	if !strings.Contains(recovered.Intent.FeeSettlement, "not proven") {
		t.Fatal("fee settlement was falsely asserted")
	}
	changed := map[string]any{"kind": "rental", "idempotencyKey": "intent-1", "payload": json.RawMessage(`{"amount":26}`)}
	resp = post("/api/authority/intents/"+failed.Intent.ID+"/retry", changed, true)
	if resp.StatusCode != 409 {
		t.Fatalf("tampered retry=%d", resp.StatusCode)
	}
	resp.Body.Close()
	raw, _ := os.ReadFile(path)
	if bytes.Contains(raw, []byte("wallet-signed-envelope")) {
		t.Fatal("signed intent payload persisted")
	}
	if !bytes.Contains(raw, []byte("requestHash")) || len(svc.data.AuthorityAudit) < 3 {
		t.Fatal("hash-only audit missing")
	}
	restarted, err := New(Config{StorePath: path, CentralGatewayURL: central.URL, CentralClientID: "ynx-resource-market-v1", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.authenticateCentral(binding, device); err != nil {
		t.Fatalf("restart session: %v", err)
	}
	stateReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/state", nil)
	stateReq.Header.Set(canonicalwallet.ProductSessionProofHeader, proofHeader(http.MethodGet, "/api/state", nil))
	stateResp, _ := http.DefaultClient.Do(stateReq)
	if stateResp.StatusCode != http.StatusOK {
		t.Fatalf("central session not accepted by local product read: %d", stateResp.StatusCode)
	}
	stateResp.Body.Close()
	if !strings.Contains(strings.Join(seen, "|"), "POST /app/resource-market/rent") {
		t.Fatalf("authority route missing: %v", seen)
	}
}

func TestResourceAuthorityUnavailableAndNoFakeSettlement(t *testing.T) {
	svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "s.json"), CentralGatewayURL: "http://127.0.0.1:1", CentralClientID: "ynx-resource-market-v1"})
	ts := httptest.NewServer(svc.Handler(nil))
	defer ts.Close()
	resp, err := http.Post(ts.URL+"/api/auth/session/complete", "application/json", strings.NewReader(`{"registryEntry":{},"authorizationRequest":{},"walletApproval":{},"gatewayCompletion":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 503 || !bytes.Contains(b, []byte(`"state":"unavailable"`)) {
		t.Fatalf("status=%d body=%s", resp.StatusCode, b)
	}
	if bytes.Contains(bytes.ToLower(b), []byte("settled")) {
		t.Fatalf("fake settlement response=%s", b)
	}
}
