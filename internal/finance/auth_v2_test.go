package finance

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type financeRoundTrip func(*http.Request) (*http.Response, error)

func (f financeRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// These cases execute the unchanged shared verifier, not a Finance reimplementation.
// Invalid proof mutations are deliberately unsigned local test inputs. The shared
// package separately executes its genuine SDK-generated signature/replay vector.
func TestBrowserV2RejectsLegacyOriginScopeExpiredAndEVMBeforeNetwork(t *testing.T) {
	raw, err := os.ReadFile("../productsessionv2/testdata/finance-v2.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector struct{ Proof map[string]any }
	if err := json.Unmarshal(raw, &vector); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, code string
		status     int
		alter      func(map[string]any, *http.Request)
	}{
		{"expired", "PROOF_EXPIRED", 401, func(p map[string]any, _ *http.Request) {
			p["issuedAt"] = "2000-01-01T00:00:00.000Z"
			p["expiresAt"] = "2000-01-01T00:00:30.000Z"
		}},
		{"old_origin", "CROSS_PRODUCT_SESSION", 403, func(p map[string]any, _ *http.Request) { p["origin"] = "https://api.ynxweb4.com" }},
		{"request_origin", "ORIGIN_MISMATCH", 403, func(_ map[string]any, r *http.Request) { r.Header.Set("Origin", "https://foreign.invalid") }},
		{"wrong_product", "CROSS_PRODUCT_SESSION", 403, func(p map[string]any, _ *http.Request) { p["productId"] = "quant" }},
		{"wrong_scope", "INTROSPECTION_BINDING_MISMATCH", 403, func(p map[string]any, _ *http.Request) { p["bodyDigest"] = strings.Repeat("a", 64) }},
		{"evm_is_not_native_identity", "INVALID_PROOF", 401, func(p map[string]any, _ *http.Request) { p["account"] = "0x" + strings.Repeat("a", 40) }},
		{"legacy", "LEGACY_AUTHORITY_PROOF_REJECTED", 401, func(_ map[string]any, r *http.Request) {
			r.Header.Set("X-YNX-Product-Session-Proof", "isolated-old-proof")
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			auth, err := newBrowserV2Authenticator(financeRoundTrip(func(*http.Request) (*http.Response, error) { calls++; return nil, errors.New("test forbids network") }))
			if err != nil {
				t.Fatal(err)
			}
			p := map[string]any{}
			for k, v := range vector.Proof {
				p[k] = v
			}
			now := time.Now().UTC()
			p["issuedAt"] = now.Add(-time.Second).Format("2006-01-02T15:04:05.000Z")
			p["expiresAt"] = now.Add(30 * time.Second).Format("2006-01-02T15:04:05.000Z")
			digest := sha256.Sum256([]byte(`{"requiredScopes":["finance.portfolio.read"]}`))
			p["bodyDigest"] = hex.EncodeToString(digest[:])
			r := httptest.NewRequest("GET", BrowserFinanceOrigin+"/api/profile", nil)
			tc.alter(p, r)
			encoded, _ := json.Marshal(p)
			r.Header.Set(productsessionv2.ProofHeader, base64.RawURLEncoding.EncodeToString(encoded))
			_, err = auth.VerifyRequest(r, "finance.portfolio.read")
			var rejection *productsessionv2.Error
			if !errors.As(err, &rejection) || rejection.Code != tc.code || rejection.Status != tc.status {
				t.Fatalf("expected %s/%d, got %v", tc.code, tc.status, err)
			}
			if calls != 0 {
				t.Fatal("invalid input contacted authority")
			}
		})
	}
}

// Route/tenant fixtures replace only the authority decision interface; they are
// not fabricated signatures, deployed sessions, or cryptographic acceptance.
type financeDecisionFixture struct {
	mu          sync.Mutex
	account     string
	calls       int
	scopes      []string
	used        map[string]bool
	unavailable bool
}

func (f *financeDecisionFixture) Authorize(_ context.Context, r *http.Request, scopes []string) (productsessionv2.Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.scopes = append([]string(nil), scopes...)
	if f.unavailable {
		return productsessionv2.Session{}, &productsessionv2.Error{Code: "AUTHORITY_UNAVAILABLE", Status: 503}
	}
	key := r.Header.Get(productsessionv2.ProofHeader)
	if f.used[key] {
		return productsessionv2.Session{}, &productsessionv2.Error{Code: "REPLAY", Status: 401}
	}
	f.used[key] = true
	account := testAccount
	if strings.HasPrefix(key, "B-") {
		account = f.account
	}
	return productsessionv2.Session{Account: account, SessionBinding: "local-test-" + account, ClientID: "ynx-finance-v1", ApplicationID: "com.ynxweb4.finance.web", Scopes: scopes, ExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)}, nil
}

func TestBrowserV2HTTPRouteTenantPersistenceReplayAndPrivateDegradation(t *testing.T) {
	accountB, _ := accountaddress.Encode(strings.Repeat("2", 40))
	authority := &financeDecisionFixture{account: accountB, used: map[string]bool{}}
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "local fixture upstream unavailable", 503) }))
	defer explorer.Close()
	upstreams, err := NewUpstreams(explorer.URL, "", "", "https://support.invalid/disputes")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "finance.json")
	open := func() *Server {
		store, e := OpenStore(path)
		if e != nil {
			t.Fatal(e)
		}
		server, e := NewServer(&Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.invalid/help", PrivacyURL: "https://support.invalid/privacy", DisputeURL: "https://support.invalid/disputes"}}, &Authenticator{v2: authority}, ServerConfig{AllowedOrigins: []string{BrowserFinanceOrigin}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey})
		if e != nil {
			t.Fatal(e)
		}
		return server
	}
	server := open()
	request := func(method, path, key, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Origin", BrowserFinanceOrigin)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set(productsessionv2.ProofHeader, key)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	created := request("POST", "/api/categories", "A-write-1", `{"idempotencyKey":"11111111-1111-4111-8111-111111111111","name":"A private planning","color":"#002FA7"}`)
	if created.Code != 201 && created.Code != 200 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	if strings.Join(authority.scopes, ",") != "finance.profile.write" {
		t.Fatal("write scope not route selected")
	}
	a := request("GET", "/api/profile?account="+accountB, "A-read-1", "")
	b := request("GET", "/api/profile?account="+testAccount, "B-read-1", "")
	if a.Code != 200 || b.Code != 200 || !strings.Contains(a.Body.String(), "A private planning") || strings.Contains(b.Body.String(), "A private planning") {
		t.Fatal("tenant ownership confused by request account")
	}
	server = open()
	a = request("GET", "/api/profile", "A-read-2", "")
	if !strings.Contains(a.Body.String(), "A private planning") {
		t.Fatal("profile lost after reopen")
	}
	replayed := request("GET", "/api/profile", "A-read-2", "")
	if replayed.Code != 401 || !strings.Contains(replayed.Body.String(), "REPLAY") {
		t.Fatal("stale authorization decision cached")
	}
	count := authority.calls
	request("GET", "/api/profile", "A-read-3", "")
	if authority.calls != count+1 {
		t.Fatal("fresh proof did not contact authority")
	}
	legacy := request("POST", "/wallet-gateway/v1/wallet/sessions/complete", "A-unused", "{}")
	if legacy.Code != 410 {
		t.Fatal("legacy authority was not isolated")
	}
	logout := request("POST", "/api/auth/logout", "A-logout", "")
	if logout.Code != 409 {
		t.Fatal("API falsely claimed remote revocation")
	}
	authority.unavailable = true
	failed := request("GET", "/api/profile", "A-read-4", "")
	if failed.Code != 503 || !strings.Contains(failed.Body.String(), "Standard Wallet is unchanged") || strings.Contains(failed.Body.String(), "A-read-4") {
		t.Fatal("private failure status or secret-safe boundary failed")
	}
	guest := request("GET", "/health", "", " ")
	if guest.Code != 200 {
		t.Fatal("private outage broke guest health")
	}
}

func TestBrowserV2FixedAuthorityUnavailableIsNotUnauthorized(t *testing.T) {
	// Invalid empty headers are rejected before any network even while offline.
	auth, err := newBrowserV2Authenticator(financeRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "wallet-auth.ynxweb4.com" {
			t.Fatal("authority was injected")
		}
		return &http.Response{StatusCode: 503, Body: io.NopCloser(bytes.NewReader(nil)), Header: http.Header{}}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	_, err = auth.VerifyRequest(httptest.NewRequest("GET", BrowserFinanceOrigin+"/api/profile", nil), "finance.portfolio.read")
	var rejected *productsessionv2.Error
	if !errors.As(err, &rejected) || rejected.Code != "PROOF_REQUIRED" {
		t.Fatal(err)
	}
}
