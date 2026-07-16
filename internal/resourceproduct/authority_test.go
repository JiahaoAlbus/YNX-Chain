package resourceproduct

import (
	"bytes"
	"encoding/json"
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
	token, device := "resource-central-session", "resource-device-1"
	var fail atomic.Bool
	seen := []string{}
	central := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path)
		if r.Header.Get("X-YNX-Client") != "ynx-resource-market-v1" {
			t.Errorf("client=%q", r.Header.Get("X-YNX-Client"))
		}
		switch r.URL.Path {
		case "/app/session/challenges":
			writeJSON(w, 201, map[string]any{"challengeId": "challenge-1", "walletUrl": "ynxwallet://authorize?request=test"})
		case "/app/session/challenges/challenge-1/verify":
			writeJSON(w, 201, map[string]any{"sessionId": "session-1", "token": token, "account": "ynx1buyer", "deviceId": device, "scopes": []string{"resource:read", "resource:quote", "resource:intent"}, "expiresAt": now.Add(time.Hour)})
		case "/app/resource-market/quote":
			if r.URL.Query().Get("resourceType") != "compute" || r.URL.Query().Get("amount") != "25" {
				t.Errorf("quote query not forwarded: %s", r.URL.RawQuery)
			}
			if r.Header.Get("X-YNX-App-Session") != token {
				t.Error("quote session missing")
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
	post := func(path string, body any, auth bool) *http.Response {
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, ts.URL+path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		if auth {
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("X-YNX-Device-ID", device)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	resp := post("/api/auth/challenges", map[string]string{"account": "ynx1buyer", "deviceId": device}, false)
	resp.Body.Close()
	resp = post("/api/auth/challenges/challenge-1/verify", map[string]string{"walletApproval": "signed", "deviceSignature": "signed"}, false)
	if resp.StatusCode != 201 {
		t.Fatalf("verify=%d", resp.StatusCode)
	}
	resp.Body.Close()
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/authority/quote?resourceType=compute&amount=25", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-YNX-Device-ID", device)
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
	if bytes.Contains(raw, []byte(token)) || bytes.Contains(raw, []byte("wallet-signed-envelope")) {
		t.Fatal("session token or signed intent payload persisted")
	}
	if !bytes.Contains(raw, []byte("requestHash")) || len(svc.data.AuthorityAudit) < 3 {
		t.Fatal("hash-only audit missing")
	}
	restarted, err := New(Config{StorePath: path, CentralGatewayURL: central.URL, CentralClientID: "ynx-resource-market-v1", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.authenticateCentral(token, device); err != nil {
		t.Fatalf("restart session: %v", err)
	}
	stateReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/state", nil)
	stateReq.Header.Set("Authorization", "Bearer "+token)
	stateReq.Header.Set("X-YNX-Device-ID", device)
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
	resp, err := http.Post(ts.URL+"/api/auth/challenges", "application/json", strings.NewReader(`{"account":"ynx1x"}`))
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
