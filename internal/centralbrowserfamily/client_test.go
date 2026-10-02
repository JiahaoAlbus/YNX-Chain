package centralbrowserfamily

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type fixture struct {
	t                               *testing.T
	client                          *Client
	cfg                             Config
	now                             atomic.Int64
	server                          *httptest.Server
	mu                              sync.Mutex
	families                        map[string]wireGrant
	tokens                          map[string]wireGrant
	retries                         map[string]wireGrant
	renewCount, introspectCount     int
	unavailable, revoked, dropRenew bool
	blockPath                       string
	entered, release                chan struct{}
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{t: t, families: map[string]wireGrant{}, tokens: map[string]wireGrant{}, retries: map[string]wireGrant{}}
	f.now.Store(time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC).UnixMilli())
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal(err)
	}
	keyPath := filepath.Join(dir, "backend-key.pem")
	if err = os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	sealPath := filepath.Join(dir, "seal-key")
	seal := make([]byte, 32)
	if _, err = rand.Read(seal); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(sealPath, seal, 0600); err != nil {
		t.Fatal(err)
	}
	f.server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { f.handle(w, r, public) }))
	target, _ := url.Parse(f.server.URL)
	base := f.server.Client().Transport
	httpClient := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Scheme != "https" || r.URL.Host != "wallet-auth.ynxweb4.com" {
			t.Errorf("incorrect issuer")
		}
		copy := r.Clone(r.Context())
		u := *r.URL
		u.Scheme, u.Host = target.Scheme, target.Host
		copy.URL = &u
		return base.RoundTrip(copy)
	})}
	f.cfg = Config{Issuer: issuer, ClientID: "ynx-finance-v1-sso-v1", Origin: "https://finance.ynxweb4.com", RedirectURI: "https://finance.ynxweb4.com/sso/callback", Audience: "ynx:finance:identity", KeyID: "isolated-test", PrivateKeyPath: keyPath, SealKeyPath: sealPath, StorePath: filepath.Join(dir, "family.db"), HTTPClient: httpClient, Now: func() time.Time { return time.UnixMilli(f.now.Load()).UTC() }}
	f.client, err = NewClient(f.cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.client.Close(); f.server.Close() })
	return f
}
func (f *fixture) advance(d time.Duration) { f.now.Add(d.Milliseconds()) }
func (f *fixture) fail(w http.ResponseWriter, code string) {
	w.WriteHeader(401)
	json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": map[string]string{"code": code}})
}
func (f *fixture) handle(w http.ResponseWriter, r *http.Request, public ed25519.PublicKey) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		f.t.Error(err)
		return
	}
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil {
		f.t.Error("bad JSON")
		return
	}
	proofBytes, err := base64.RawURLEncoding.DecodeString(r.Header.Get("X-YNX-Backend-Proof"))
	var proof map[string]any
	if err != nil || json.Unmarshal(proofBytes, &proof) != nil {
		f.t.Error("missing proof")
		return
	}
	signature, err := base64.RawURLEncoding.DecodeString(proof["signature"].(string))
	delete(proof, "signature")
	signed, _ := canonical(proof)
	sum := sha256.Sum256(raw)
	if err != nil || !ed25519.Verify(public, signed, signature) || proof["bodySha256"] != hex.EncodeToString(sum[:]) || proof["path"] != r.URL.Path || proof["method"] != "POST" || proof["issuer"] != issuer || proof["audience"] != issuer+"/v2/browser-sessions" || proof["clientId"] != f.cfg.ClientID || proof["keyId"] != "isolated-test" || !opaque.MatchString(proof["nonce"].(string)) {
		f.t.Error("invalid independent Ed25519 proof")
		f.fail(w, "SSO_BACKEND_AUTH_INVALID")
		return
	}
	if r.Header.Get("Origin") != "" || r.Header.Get("Cookie") != "" {
		f.t.Error("browser credential leaked")
	}
	f.mu.Lock()
	if f.unavailable {
		f.mu.Unlock()
		w.WriteHeader(503)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": map[string]string{"code": "SSO_SERVICE_UNAVAILABLE"}})
		return
	}
	path := r.URL.Path
	now := f.cfg.Now()
	var out any
	switch path {
	case "/v2/browser-sessions/token-family":
		if body["origin"] != f.cfg.Origin || body["redirectUri"] != f.cfg.RedirectURI {
			f.t.Error("tuple mismatch")
		}
		request := body["requestId"].(string)
		g, ok := f.retries[request]
		if !ok {
			g = wireGrant{GrantToken: randomToken(), Identity: Identity{Subject: "ynx1" + strings.Repeat("a", 38), Account: "ynx1" + strings.Repeat("a", 38), Generation: 1, ExpiresAt: now.Add(2 * time.Hour)}, Audience: f.cfg.Audience, Scopes: []string{"identity:read"}, ExpiresAt: now.Add(5 * time.Minute), FamilyID: randomToken(), FamilyEpoch: 0, RefreshHandle: randomToken(), AbsoluteExpiresAt: now.Add(2 * time.Hour), IdleExpiresAt: now.Add(30 * time.Minute), ApprovedProfile: 6, ApprovedClientsDigest: strings.Repeat("c", 64)}
			f.retries[request] = g
			f.families[g.FamilyID] = g
			f.tokens[g.GrantToken] = g
		}
		out = g
	case "/v2/browser-sessions/renew":
		request := body["requestId"].(string)
		g, ok := f.retries[request]
		if !ok {
			g = f.families[body["familyId"].(string)]
			if g.FamilyID == "" || f.revoked {
				f.mu.Unlock()
				f.fail(w, "SSO_FAMILY_INVALID")
				return
			}
			if g.RefreshHandle != body["refreshHandle"] || g.FamilyEpoch != int64(body["expectedFamilyEpoch"].(float64)) {
				f.mu.Unlock()
				f.fail(w, "SSO_FAMILY_CONFLICT")
				return
			}
			g.FamilyEpoch++
			g.GrantToken = randomToken()
			g.RefreshHandle = randomToken()
			g.ExpiresAt = now.Add(5 * time.Minute)
			if g.ExpiresAt.After(g.IdleExpiresAt) {
				g.ExpiresAt = g.IdleExpiresAt
			}
			f.retries[request] = g
			f.families[g.FamilyID] = g
			f.tokens[g.GrantToken] = g
			f.renewCount++
		}
		out = g
	case "/v2/browser-sessions/introspect":
		f.introspectCount++
		g := f.tokens[body["grantToken"].(string)]
		if g.FamilyID == "" || f.revoked || !g.ExpiresAt.After(now) {
			f.mu.Unlock()
			f.fail(w, "SSO_GRANT_INVALID")
			return
		}
		if _, ok := f.families[g.FamilyID]; !ok {
			f.mu.Unlock()
			f.fail(w, "SSO_LOGIN_REQUIRED")
			return
		}
		out = map[string]any{"identity": g.Identity, "audience": g.Audience, "scopes": g.Scopes, "expiresAt": g.ExpiresAt}
	case "/v2/browser-sessions/activity":
		g := f.families[body["familyId"].(string)]
		observed, err := time.Parse(time.RFC3339Nano, body["observedAt"].(string))
		if err != nil {
			f.t.Error(err)
		}
		g.IdleExpiresAt = observed.Add(30 * time.Minute)
		if g.IdleExpiresAt.After(g.AbsoluteExpiresAt) {
			g.IdleExpiresAt = g.AbsoluteExpiresAt
		}
		f.families[g.FamilyID] = g
		out = map[string]any{"identity": g.Identity, "absoluteExpiresAt": g.AbsoluteExpiresAt, "idleExpiresAt": g.IdleExpiresAt}
	case "/v2/browser-sessions/revoke-family":
		delete(f.families, body["familyId"].(string))
		out = map[string]bool{"revoked": true}
	default:
		f.t.Errorf("unknown route %s", path)
	}
	drop := path == "/v2/browser-sessions/renew" && f.dropRenew
	if drop {
		f.dropRenew = false
	}
	block := path == f.blockPath
	entered, release := f.entered, f.release
	f.mu.Unlock()
	if block {
		select {
		case entered <- struct{}{}:
		default:
		}
		<-release
	}
	if drop {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			f.t.Error(err)
		} else {
			conn.Close()
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}
func (f *fixture) login(previous string) (Grant, PKCEInput) {
	f.t.Helper()
	state := randomToken()
	id, err := f.client.Prepare(context.Background(), PrepareInput{State: state, PreviousFamilyID: previous})
	if err != nil {
		f.t.Fatal(err)
	}
	input := PKCEInput{Code: randomToken(), State: state, CodeVerifier: randomToken(), IntentID: id}
	g, err := f.client.Redeem(context.Background(), input)
	if err != nil {
		f.t.Fatal(err)
	}
	return g, input
}
func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("want %s got %v", code, err)
	}
}

func TestResolveVerifiesCentralOnEveryReadAndRecoversNetwork(t *testing.T) {
	f := newFixture(t)
	g, _ := f.login("")
	if _, err := f.client.Resolve(context.Background(), g.FamilyID); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.unavailable = true
	f.mu.Unlock()
	_, err := f.client.Resolve(context.Background(), g.FamilyID)
	requireCode(t, err, "SSO_SERVICE_UNAVAILABLE")
	f.mu.Lock()
	f.unavailable = false
	f.mu.Unlock()
	if _, err = f.client.Resolve(context.Background(), g.FamilyID); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.revoked = true
	f.mu.Unlock()
	_, err = f.client.Resolve(context.Background(), g.FamilyID)
	requireCode(t, err, "SSO_GRANT_INVALID")
}
func TestLogoutLateRedemptionAndOtherBrowserIsolation(t *testing.T) {
	f := newFixture(t)
	other, _ := f.login("")
	state := randomToken()
	id, err := f.client.Prepare(context.Background(), PrepareInput{State: state})
	if err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.blockPath = "/v2/browser-sessions/token-family"
	f.entered = make(chan struct{}, 1)
	f.release = make(chan struct{})
	f.mu.Unlock()
	done := make(chan error, 1)
	go func() {
		_, e := f.client.Redeem(context.Background(), PKCEInput{Code: randomToken(), State: state, CodeVerifier: randomToken(), IntentID: id})
		done <- e
	}()
	<-f.entered
	if err = f.client.Logout(context.Background(), LogoutInput{IntentID: id}); err != nil {
		t.Fatal(err)
	}
	close(f.release)
	requireCode(t, <-done, CodeFenced)
	if _, err = f.client.Resolve(context.Background(), other.FamilyID); err != nil {
		t.Fatal("unrelated browser affected", err)
	}
	f.mu.Lock()
	remaining := len(f.families)
	f.mu.Unlock()
	if remaining != 1 {
		t.Fatalf("late family survived: %d", remaining)
	}
}
func TestLogoutDuringIntrospectionNeverInstallsLateIdentity(t *testing.T) {
	f := newFixture(t)
	g, _ := f.login("")
	f.mu.Lock()
	f.blockPath = "/v2/browser-sessions/introspect"
	f.entered = make(chan struct{}, 1)
	f.release = make(chan struct{})
	f.mu.Unlock()
	done := make(chan error, 1)
	go func() { _, e := f.client.Resolve(context.Background(), g.FamilyID); done <- e }()
	<-f.entered
	if err := f.client.Logout(context.Background(), LogoutInput{FamilyID: g.FamilyID}); err != nil {
		t.Fatal(err)
	}
	close(f.release)
	requireCode(t, <-done, CodeFenced)
}
func TestRenewLostResponsePersistsExactRequestAcrossRestart(t *testing.T) {
	f := newFixture(t)
	g, _ := f.login("")
	f.advance(241 * time.Second)
	f.mu.Lock()
	f.dropRenew = true
	f.mu.Unlock()
	_, err := f.client.Resolve(context.Background(), g.FamilyID)
	requireCode(t, err, CodeUnavailable)
	if err = f.client.Close(); err != nil {
		t.Fatal(err)
	}
	f.client, err = NewClient(f.cfg)
	if err != nil {
		t.Fatal(err)
	}
	next, err := f.client.Resolve(context.Background(), g.FamilyID)
	if err != nil {
		t.Fatal(err)
	}
	if next.GrantToken == g.GrantToken || !next.AbsoluteExpiresAt.Equal(g.AbsoluteExpiresAt) || !next.IdleExpiresAt.Equal(g.IdleExpiresAt) {
		t.Fatal("renewal identity/lease changed")
	}
	f.mu.Lock()
	count := f.renewCount
	f.mu.Unlock()
	if count != 1 {
		t.Fatalf("renew committed %d times", count)
	}
}
func TestPassiveReadsDoNotMoveIdleAndActivityCannotExtendAbsolute(t *testing.T) {
	f := newFixture(t)
	g, _ := f.login("")
	for i := 0; i < 6; i++ {
		f.advance(241 * time.Second)
		next, err := f.client.Resolve(context.Background(), g.FamilyID)
		if err != nil {
			t.Fatal(err)
		}
		if !next.IdleExpiresAt.Equal(g.IdleExpiresAt) {
			t.Fatal("passive read moved idle")
		}
	}
	if err := f.client.Activity(context.Background(), g.FamilyID, randomToken(), f.cfg.Now()); err != nil {
		t.Fatal(err)
	}
	r, err := f.client.readFamily(g.FamilyID)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Grant.AbsoluteExpiresAt.Equal(g.AbsoluteExpiresAt) || !r.Grant.IdleExpiresAt.After(g.IdleExpiresAt) {
		t.Fatal("bad activity deadline")
	}
	f.advance(31 * time.Minute)
	_, err = f.client.Resolve(context.Background(), g.FamilyID)
	requireCode(t, err, CodeLoginRequired)
}
func TestUncertainLogoutStaysFencedAndCanRetry(t *testing.T) {
	f := newFixture(t)
	g, _ := f.login("")
	f.mu.Lock()
	f.unavailable = true
	f.mu.Unlock()
	err := f.client.Logout(context.Background(), LogoutInput{FamilyID: g.FamilyID})
	var typed *Error
	if !errors.As(err, &typed) || !typed.LocallyFenced || !typed.RevocationPending {
		t.Fatal("missing durable pending logout")
	}
	_, err = f.client.Resolve(context.Background(), g.FamilyID)
	requireCode(t, err, CodeFenced)
	f.mu.Lock()
	f.unavailable = false
	f.mu.Unlock()
	if err = f.client.Logout(context.Background(), LogoutInput{FamilyID: g.FamilyID}); err != nil {
		t.Fatal(err)
	}
}
func TestStoreReadDoesNotWriteAndExpiredCapacityIsCollected(t *testing.T) {
	f := newFixture(t)
	g, _ := f.login("")
	before, err := os.ReadFile(f.cfg.StorePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.client.readFamily(g.FamilyID); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(f.cfg.StorePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytesEqual(before, after) {
		t.Fatal("read changed database")
	}
	err = f.client.store.update(func(s *durableState) error {
		for len(s.Intents) < 4096 {
			s.Intents[randomToken()] = &loginIntent{State: randomToken(), Deadline: f.cfg.Now().Add(-2 * time.Minute)}
		}
		s.Families[randomToken()] = &familyRecord{Grant: Grant{AbsoluteExpiresAt: f.cfg.Now().Add(time.Hour), IdleExpiresAt: f.cfg.Now().Add(-time.Hour)}, PendingRevoke: randomToken()}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.client.Prepare(context.Background(), PrepareInput{State: randomToken()}); err != nil {
		t.Fatal(err)
	}
	err = f.client.store.view(func(s *durableState) error {
		if len(s.Intents) != 2 {
			t.Fatalf("old intents retained: %d", len(s.Intents))
		}
		if len(s.Families) != 2 {
			t.Fatal("pending revoke incorrectly collected")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(f.cfg.StorePath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), g.GrantToken) || strings.Contains(string(raw), g.Identity.Account) {
		t.Fatal("plaintext credential on disk")
	}
}
func bytesEqual(a, b []byte) bool { return string(a) == string(b) }

func TestActualCentralRoutesProofRotationRevocationAndSchema2Fallback(t *testing.T) {
	f := newFixture(t)
	directory := filepath.Dir(f.cfg.StorePath)
	keyRaw, err := os.ReadFile(f.cfg.PrivateKeyPath)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(keyRaw)
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(parsed.(ed25519.PrivateKey).Public())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(directory, "public.pem"), pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	clock := filepath.Join(directory, "clock")
	if err = os.WriteFile(clock, []byte(strconv.FormatInt(f.now.Load(), 10)), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("node", "testdata/central-http-fixture.mjs", directory)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cmd.Process.Signal(os.Interrupt); cmd.Wait() })
	var ready struct {
		Port   int         `json:"port"`
		Inputs []PKCEInput `json:"inputs"`
	}
	if err = json.NewDecoder(stdout).Decode(&ready); err != nil {
		t.Fatalf("actual routes fixture: %v %s", err, stderr.String())
	}
	if ready.Port == 0 || len(ready.Inputs) != 2 {
		t.Fatal("missing isolated inputs")
	}
	base := "http://127.0.0.1:" + strconv.Itoa(ready.Port)
	target, _ := url.Parse(base)
	f.client.Close()
	f.cfg.HTTPClient = &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		if err := os.WriteFile(clock, []byte(strconv.FormatInt(f.now.Load(), 10)), 0600); err != nil {
			return nil, err
		}
		copy := r.Clone(r.Context())
		u := *r.URL
		u.Host, u.Scheme = target.Host, target.Scheme
		copy.URL = &u
		return http.DefaultTransport.RoundTrip(copy)
	})}
	f.client, err = NewClient(f.cfg)
	if err != nil {
		t.Fatal(err)
	}
	grants := []Grant{}
	for _, input := range ready.Inputs {
		id, err := f.client.Prepare(context.Background(), PrepareInput{State: input.State})
		if err != nil {
			t.Fatal(err)
		}
		input.IntentID = id
		g, err := f.client.Redeem(context.Background(), input)
		if err != nil {
			t.Fatal("real route redemption", err)
		}
		grants = append(grants, g)
	}
	if grants[0].ApprovedProfile != "6" || grants[0].ApprovedClientsDigest == "" || grants[0].Identity.Account == grants[1].Identity.Account {
		t.Fatal("actual approved roster/identity not retained")
	}
	control := func(path string) {
		response, err := http.Post(base+path, "application/json", strings.NewReader("{}"))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatalf("isolated control: %d", response.StatusCode)
		}
	}
	control("/qa/drop-next-renew-result")
	f.advance(241 * time.Second)
	_, err = f.client.Resolve(context.Background(), grants[0].FamilyID)
	requireCode(t, err, CodeUnavailable)
	f.client.Close()
	f.client, err = NewClient(f.cfg)
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := f.client.Resolve(context.Background(), grants[0].FamilyID)
	if err != nil {
		t.Fatal("actual proof renewal retry", err)
	}
	if rotated.GrantToken == grants[0].GrantToken || rotated.ApprovedClientsDigest != grants[0].ApprovedClientsDigest {
		t.Fatal("rotation changed signed roster")
	}
	response, err := http.Get(base + "/qa/facts")
	if err != nil {
		t.Fatal(err)
	}
	var facts struct {
		SchemaVersion int
		Epochs        []int
	}
	err = json.NewDecoder(response.Body).Decode(&facts)
	response.Body.Close()
	if err != nil || facts.SchemaVersion != 2 || len(facts.Epochs) != 2 || facts.Epochs[0] != 1 || facts.Epochs[1] != 0 {
		t.Fatal("real lost response minted duplicate family/epoch", err)
	}
	control("/qa/guarded-fallback")
	if _, err = f.client.Resolve(context.Background(), grants[0].FamilyID); err != nil {
		t.Fatal("schema2 guarded fallback cannot introspect", err)
	}
	control("/qa/logout-first")
	_, err = f.client.Resolve(context.Background(), grants[0].FamilyID)
	requireCode(t, err, "SSO_LOGIN_REQUIRED")
	// The second independent central session survives the first one's logout.
	// Access is still within its original five-minute lifetime.
	if _, err = f.client.Resolve(context.Background(), grants[1].FamilyID); err == nil {
		t.Fatal("renew on disabled fallback unexpectedly available")
	} else {
		requireCode(t, err, "SSO_BACKEND_NOT_CONFIGURED")
	}
	// Verify the actual second grant directly: the failed renewal did not revoke it.
	var out struct {
		Identity Identity `json:"identity"`
	}
	if err = f.client.call(context.Background(), "/v2/browser-sessions/introspect", map[string]any{"clientId": f.cfg.ClientID, "grantToken": grants[1].GrantToken}, &out); err != nil {
		t.Fatal("other actual browser revoked", err)
	}
}

func TestExplicitNewIntentAfterExpiredOrConfirmedLogout(t *testing.T) {
	f := newFixture(t)
	old, input := f.login("")
	if err := f.client.Logout(context.Background(), LogoutInput{FamilyID: old.FamilyID, IntentID: input.IntentID}); err != nil {
		t.Fatal(err)
	}
	_, err := f.client.Prepare(context.Background(), PrepareInput{State: randomToken(), PreviousFamilyID: old.FamilyID})
	requireCode(t, err, CodeFenced)
	next, _ := f.login("")
	if next.FamilyID == old.FamilyID {
		t.Fatal("explicit login revived old family")
	}
	_, err = f.client.Redeem(context.Background(), input)
	requireCode(t, err, CodeFenced)
	f.advance(31 * time.Minute)
	_, err = f.client.Resolve(context.Background(), next.FamilyID)
	requireCode(t, err, CodeLoginRequired)
	fresh, _ := f.login("")
	if fresh.FamilyID == next.FamilyID {
		t.Fatal("expired family revived")
	}
}

func TestLogoutTraversesOnlyItsCommittedReplacementLineage(t *testing.T) {
	f := newFixture(t)
	old, _ := f.login("")
	replacement, _ := f.login(old.FamilyID)
	independent, _ := f.login("")
	if err := f.client.Logout(context.Background(), LogoutInput{FamilyID: old.FamilyID}); err != nil {
		t.Fatal(err)
	}
	_, err := f.client.Resolve(context.Background(), replacement.FamilyID)
	requireCode(t, err, CodeFenced)
	if _, err = f.client.Resolve(context.Background(), independent.FamilyID); err != nil {
		t.Fatal("unrelated browser fenced", err)
	}
	fresh, _ := f.login("")
	if err = f.client.Logout(context.Background(), LogoutInput{FamilyID: old.FamilyID}); err != nil {
		t.Fatal(err)
	}
	if _, err = f.client.Resolve(context.Background(), fresh.FamilyID); err != nil {
		t.Fatal("confirmed old logout affected explicit new intent", err)
	}
}
