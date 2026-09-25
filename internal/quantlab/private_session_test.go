package quantlab

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type privateRoundTrip func(*http.Request) (*http.Response, error)

func (f privateRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// This owner HTTP-policy fixture is an explicit authority test double. The
// unchanged shared package separately verifies its real SDK-signed test vector.
// These disposable envelopes never leave this test or count as Wallet approval.
func quantProofFixture(t *testing.T, label string) (map[string]any, map[string]any) {
	t.Helper()
	now := time.Now().UTC().Add(-time.Second)
	stamp := func(v time.Time) string { return v.Format("2006-01-02T15:04:05.000Z") }
	policy := QuantPrivateSessionPolicy()
	digest := sha256.Sum256([]byte(`{"requiredScopes":["quant:account"]}`))
	identity := map[string]any{"version": "2", "sessionBinding": strings.Repeat(label, 64), "productId": policy.ProductID, "clientId": policy.ClientID, "applicationId": policy.ApplicationID, "bundleId": nil, "packageId": nil, "origin": policy.Origin, "callback": policy.Callback, "account": "ynx1" + strings.Repeat(label, 38), "deviceId": "fixture-device-" + label, "deviceKey": "fixture-public-key-" + label}
	proof, session := map[string]any{}, map[string]any{}
	for key, value := range identity {
		proof[key] = value
		session[key] = value
	}
	for key, value := range map[string]any{"method": "POST", "path": "/v2/product-sessions/introspect", "bodyDigest": hex.EncodeToString(digest[:]), "nonce": strings.Repeat(label, 32), "issuedAt": stamp(now), "expiresAt": stamp(now.Add(30 * time.Second)), "signature": "test-double-not-a-wallet-signature"} {
		proof[key] = value
	}
	for key, value := range map[string]any{"chainId": "ynx_6423-1", "platform": "web", "deviceAlgorithm": "p256-sha256", "deviceBinding": strings.Repeat(label, 64), "nonce": strings.Repeat(label, 32), "state": strings.Repeat(label, 32), "scopes": []string{"quant:account"}, "requestDigest": strings.Repeat(label, 64), "approvalDigest": strings.Repeat(label, 64), "issuedAt": stamp(now.Add(-time.Second)), "expiresAt": stamp(now.Add(180 * time.Second))} {
		session[key] = value
	}
	return proof, session
}
func quantProofHeader(t *testing.T, proof map[string]any) string {
	t.Helper()
	raw, err := json.Marshal(proof)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

func TestQuantPrivateAccountUsesSharedV2PerRequestAndKeepsTenantsSeparate(t *testing.T) {
	proofA, sessionA := quantProofFixture(t, "a")
	proofB, sessionB := quantProofFixture(t, "c")
	headA, headB := quantProofHeader(t, proofA), quantProofHeader(t, proofB)
	var mu sync.Mutex
	used := map[string]bool{}
	calls := 0
	client, err := productsessionv2.NewClient(QuantPrivateAuthority, QuantPrivateSessionPolicy(), privateRoundTrip(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		body, _ := io.ReadAll(r.Body)
		if r.URL.String() != QuantPrivateAuthority+"/v2/product-sessions/introspect" || r.Method != "POST" || string(body) != `{"requiredScopes":["quant:account"]}` || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Errorf("incorrect fixed introspection contract")
		}
		head := r.Header.Get(productsessionv2.ProofHeader)
		session := sessionA
		if head == headB {
			session = sessionB
		} else if head != headA {
			t.Errorf("unexpected fixture proof")
		}
		status := 200
		payload := map[string]any{"schemaVersion": 2, "requestId": r.Header.Get("X-Request-Id"), "ok": true, "result": map[string]any{"active": true, "session": session}}
		if used[head] {
			status = 400
			delete(payload, "result")
			payload["ok"] = false
			payload["error"] = map[string]any{"code": "PROOF_REPLAY", "message": "Consumed fixture proof"}
		}
		used[head] = true
		data, _ := json.Marshal(payload)
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}, "Cache-Control": []string{"no-store"}, "X-Request-Id": []string{r.Header.Get("X-Request-Id")}}, Body: io.NopCloser(strings.NewReader(string(data))), ContentLength: int64(len(data))}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewTenantServer(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), PrivateSession: client}, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	request := func(tenant, header, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "https://quant.ynxweb4.com/v1/wallet/private-account", strings.NewReader(body))
		r.Header.Set(TenantHeader, strings.Repeat(tenant, 64))
		r.Header.Set("Origin", "https://quant.ynxweb4.com")
		r.Header.Set(productsessionv2.ProofHeader, header)
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		return w
	}
	for _, row := range []struct{ tenant, header, account string }{{"a", headA, sessionA["account"].(string)}, {"b", headB, sessionB["account"].(string)}} {
		w := request(row.tenant, row.header, "{}")
		if w.Code != 200 {
			t.Fatalf("account: %d %s", w.Code, w.Body.String())
		}
		var response map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &response)
		if response["account"] != row.account || response["nativeExecutionEnabled"] != false || response["paperWorkspaceLinked"] != false {
			t.Fatalf("cross identity or inferred business permission: %v", response)
		}
	}
	if w := request("b", headA, "{}"); w.Code != 401 || !strings.Contains(w.Body.String(), "PROOF_REPLAY") {
		t.Fatalf("consumed proof replay: %d %s", w.Code, w.Body.String())
	}
	if calls != 3 {
		t.Fatalf("every attempt must independently introspect; calls=%d", calls)
	}
	if w := request("a", headA, `{"requiredScopes":["quant:mandate:execute"]}`); w.Code != 400 {
		t.Fatal("body supplied scopes accepted")
	}
	if calls != 3 {
		t.Fatal("invalid body reached authority")
	}
}

func TestQuantPrivateV2FailClosedBeforeAuthorityAndNativeAdapter(t *testing.T) {
	proof, _ := quantProofFixture(t, "a")
	calls := 0
	client, err := productsessionv2.NewClient(QuantPrivateAuthority, QuantPrivateSessionPolicy(), privateRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		return nil, fmt.Errorf("fixture authority unavailable")
	}))
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), PrivateSession: client})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	server := NewServer(s)
	for _, tc := range []struct {
		name, field string
		value       any
		status      int
	}{{"other product", "productId", "exchange", 403}, {"other callback", "callback", "https://attacker.example/cb", 403}, {"expired", "expiresAt", "2001-01-01T00:00:00.000Z", 401}, {"business-bound v1", "path", "/v1/quant-adapter/orders", 403}} {
		t.Run(tc.name, func(t *testing.T) {
			copy := map[string]any{}
			for k, v := range proof {
				copy[k] = v
			}
			copy[tc.field] = tc.value
			r := httptest.NewRequest("POST", "/v1/wallet/private-account", strings.NewReader("{}"))
			r.Header.Set(productsessionv2.ProofHeader, quantProofHeader(t, copy))
			w := httptest.NewRecorder()
			server.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
		})
	}
	for _, path := range []string{"/v1/testnet/mandates", "/v1/testnet/orders"} {
		r := httptest.NewRequest("POST", path, strings.NewReader("{}"))
		r.RemoteAddr = "127.0.0.1:8000"
		r.Header.Set("X-YNX-Preview-Mode", "local-paper")
		r.Header.Set(productsessionv2.ProofHeader, quantProofHeader(t, proof))
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != 503 || !strings.Contains(w.Body.String(), "native_exchange_v2_adapter_unavailable") {
			t.Fatalf("native flow accepted v2 login: %d", w.Code)
		}
	}
	if calls != 0 {
		t.Fatal("invalid routes/bindings reached authority")
	}
	r := httptest.NewRequest("POST", "/v1/wallet/private-account", strings.NewReader("{}"))
	r.Header.Set(productsessionv2.ProofHeader, quantProofHeader(t, proof))
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != 503 || calls != 1 {
		t.Fatalf("private degradation not isolated: %d %s", w.Code, w.Body.String())
	}
}
