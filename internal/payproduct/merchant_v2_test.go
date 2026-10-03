//go:build commerce_v2

package payproduct

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type merchantQATransport func(*http.Request) (*http.Response, error)

func (f merchantQATransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// Controlled actor fixture + ACTUAL confidential private revalidation. It is
// deliberately NOT a production joint authority snapshot implementation.
type merchantQASnapshot struct {
	reader *v2.Revalidator
	active atomic.Bool
	reads  atomic.Int32
}

func (q *merchantQASnapshot) ReadMerchantAuthority(ctx context.Context, original v2.Session, scopes []string) (MerchantV2AuthoritySnapshot, error) {
	q.reads.Add(1)
	verified, err := q.reader.Revalidate(ctx, original, scopes)
	if err != nil {
		return MerchantV2AuthoritySnapshot{}, err
	}
	expiry, _ := time.Parse(time.RFC3339Nano, verified.ExpiresAt)
	return MerchantV2AuthoritySnapshot{Session: verified, ValidUntil: expiry, Current: func() error {
		if !q.active.Load() {
			return merchantDenied("CONTROLLED_ACTOR_REVOKED", 401)
		}
		return nil
	}}, nil
}
func TestMerchantActualSDKExactProofAndOriginalStore(t *testing.T) {
	if os.Getenv("YNX_QA_CENTRAL_SOURCE") == "" {
		t.Skip("requires frozen adopted SDK source; no mock-proof fallback")
	}
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKIXPublicKey(public)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "testdata/merchant-v2-node.mjs")
	directory := t.TempDir()
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	cmd.Env = append(os.Environ(), "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), "YNX_QA_STATE_PATH="+filepath.Join(directory, "authority"))
	var diagnostic merchantSafeDiagnostic
	cmd.Stderr = &diagnostic
	pipe, _ := cmd.StdoutPipe()
	input, _ := cmd.StdinPipe()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	scanner := bufio.NewScanner(pipe)
	scanner.Buffer(make([]byte, 4096), 65536)
	var ready struct{ URL, Account, Binding string }
	if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &ready) != nil {
		t.Fatal("SDK fixture startup", diagnostic.String())
	}
	local, err := url.Parse(ready.URL)
	if err != nil {
		t.Fatal(err)
	}
	transport := merchantQATransport(func(r *http.Request) (*http.Response, error) {
		copy := r.Clone(r.Context())
		u := *r.URL
		copy.URL = &u
		copy.URL.Scheme = local.Scheme
		copy.URL.Host = local.Host
		return http.DefaultTransport.RoundTrip(copy)
	})
	policy := v2.Policy{ProductID: MerchantProductID, ClientID: MerchantClientID, ApplicationID: MerchantBundleID + ".web", Platform: "web", Origin: "https://pay.ynxweb4.com", Callback: MerchantCallback, AllowedScopes: merchantConsoleScopes}
	client, err := v2.NewClient("https://wallet-auth.ynxweb4.com", policy, transport)
	if err != nil {
		t.Fatal(err)
	}
	private, err := v2.NewPrivateBusinessRevalidator(client, MerchantClientID+"-business-web-v1", "qa", key)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := &merchantQASnapshot{reader: private}
	snapshot.active.Store(true)
	service, m, _, _ := merchantBusinessQA(t)
	_ = service.store.Update(func(d *Snapshot) error {
		d.MerchantMembers[m.ID+":"+ready.Account] = MerchantMember{ID: "member-actual-sdk", MerchantID: m.ID, Account: ready.Account, Role: "owner", Status: "active"}
		return nil
	})
	server, err := NewMerchantV2Server(service, transport, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path, body, wire, token string, reuse bool) *httptest.ResponseRecorder {
		command, _ := json.Marshal(map[string]any{"method": method, "path": path, "body": body, "scopes": merchantConsoleScopes, "reuseAction": reuse})
		if _, err := input.Write(append(command, '\n')); err != nil {
			t.Fatal(err)
		}
		var headers struct{ Introspection, Action string }
		if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &headers) != nil {
			t.Fatal("SDK pipe", diagnostic.String())
		}
		r := httptest.NewRequest(method, path, bytes.NewBufferString(wire))
		r.Header.Set(v2.ProofHeader, headers.Introspection)
		r.Header.Set(v2.ActionProofHeader, headers.Action)
		r.Header.Set("Origin", "https://pay.ynxweb4.com")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	body := `{"merchantId":"` + m.ID + `"}`
	w := request("POST", "/v1/merchant/sessions", body, body, "", false)
	var carrier MerchantSessionResult
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &carrier) != nil || carrier.Account != ready.Account {
		t.Fatal("actual session proofs", w.Code, w.Body.String(), diagnostic.String())
	}
	w = request("POST", "/v1/merchant/sessions", body, body, "", true)
	if w.Code != 409 {
		t.Fatal("actual action replay", w.Code, w.Body.String())
	}
	before, _, _ := merchantCounts(t, service)
	w = request("POST", "/v1/merchant/sessions", body, `{"merchantId":"foreign-merchant"}`, "", false)
	after, _, _ := merchantCounts(t, service)
	if w.Code != 403 || after != before {
		t.Fatal("raw wire mismatch effect", w.Code, w.Body.String())
	}
	w = request("GET", "/v1/merchant/state", "", "", carrier.Token, false)
	if w.Code != 200 || !strings.Contains(w.Body.String(), m.DisplayName) {
		t.Fatal("actual signed original member read", w.Code, w.Body.String())
	}
	snapshot.active.Store(false)
	w = request("GET", "/v1/merchant/state", "", "", carrier.Token, false)
	if w.Code != 401 || strings.Contains(w.Body.String(), m.DisplayName) {
		t.Fatal("actor revocation leaked", w.Code, w.Body.String())
	}
	snapshot.active.Store(true)
	_, _ = input.Write([]byte("{\"revoke\":true}\n"))
	var receipt struct{ Revoked bool }
	if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &receipt) != nil || !receipt.Revoked {
		t.Fatal("actual private revoke", diagnostic.String())
	}
	w = request("GET", "/v1/merchant/state", "", "", carrier.Token, false)
	if w.Code != 401 || strings.Contains(w.Body.String(), m.DisplayName) {
		t.Fatal("private revocation leaked", w.Code, w.Body.String())
	}
	if snapshot.reads.Load() < 4 {
		t.Fatal("confidential revalidation not used")
	}
}

type merchantSafeDiagnostic struct {
	mu   sync.Mutex
	body bytes.Buffer
}

func (d *merchantSafeDiagnostic) Write(b []byte) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.body.Write(b)
}
func (d *merchantSafeDiagnostic) String() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.body.String()
}
