package finance

import (
	"bufio"
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
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/centralbrowserfamily"
)

type finiteInteropTransport func(*http.Request) (*http.Response, error)

func (f finiteInteropTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// Real Finance handlers and shared encrypted Go store talk to actual Central
// Node routes. Synthetic accounts and loopback transport are engineering QA.
func TestFinanceFiniteActualCentralHandlerInterop(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key, _ := x509.MarshalPKCS8PrivateKey(private)
	pub, _ := x509.MarshalPKIXPublicKey(private.Public())
	seal := make([]byte, 32)
	if _, err = rand.Read(seal); err != nil {
		t.Fatal(err)
	}
	write := func(name string, data []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("private.pem", pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}))
	write("public.pem", pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}))
	write("seal", seal)
	clock := func() { write("clock", []byte(strconv.FormatInt(now.UnixMilli(), 10))) }
	clock()
	cmd := exec.Command("node", "../centralbrowserfamily/testdata/central-http-fixture.mjs", dir)
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := os.OpenFile(filepath.Join(dir, "node-stderr"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer stderr.Close()
	cmd.Stderr = stderr
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Signal(syscall.SIGTERM); _ = cmd.Wait() })
	ready := make(chan int, 1)
	go func() {
		scanner := bufio.NewScanner(pipe)
		port := 0
		if scanner.Scan() {
			var value struct{ Port int }
			if json.Unmarshal(scanner.Bytes(), &value) == nil {
				port = value.Port
			}
		}
		ready <- port
	}()
	var port int
	select {
	case port = <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("Node fixture startup deadline")
	}
	if port == 0 {
		raw, _ := os.ReadFile(filepath.Join(dir, "node-stderr"))
		t.Fatalf("Node fixture failed: %s", raw)
	}
	base := "http://127.0.0.1:" + strconv.Itoa(port)
	target, _ := url.Parse(base)
	cfg := centralbrowserfamily.Config{Issuer: BrowserWalletAuthority, ClientID: financeSSOClient, Origin: BrowserFinanceOrigin, RedirectURI: BrowserFinanceOrigin + "/sso/callback", Audience: "ynx:finance:identity", KeyID: "isolated-test", PrivateKeyPath: filepath.Join(dir, "private.pem"), SealKeyPath: filepath.Join(dir, "seal"), StorePath: filepath.Join(dir, "family.db"), Now: func() time.Time { return now }, HTTPClient: &http.Client{Transport: finiteInteropTransport(func(r *http.Request) (*http.Response, error) {
		copy := r.Clone(r.Context())
		u := *r.URL
		u.Host, u.Scheme = target.Host, target.Scheme
		copy.URL = &u
		return http.DefaultTransport.RoundTrip(copy)
	})}}
	backend, err := centralbrowserfamily.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { backend.Close() }()
	s := &Server{cfg: ServerConfig{CentralBrowserSSO: true, CentralBrowserFamily: backend, WalletGatewayURL: BrowserWalletAuthority, CursorSigningKey: testCursorKey}, now: func() time.Time { return now }}
	login := func(index int) *http.Cookie {
		t.Helper()
		start := httptest.NewRecorder()
		s.ssoStart(start, httptest.NewRequest("GET", BrowserFinanceOrigin+"/sso/start?target=planning", nil))
		if start.Code != 303 {
			t.Fatal("start", start.Code)
		}
		location, _ := url.Parse(start.Header().Get("Location"))
		q := location.Query()
		q.Set("qaSession", strconv.Itoa(index))
		response, err := http.Get(base + "/qa/authorize?" + q.Encode())
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			RedirectURI string `json:"redirectUri"`
		}
		err = json.NewDecoder(response.Body).Decode(&result)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 || result.RedirectURI == "" {
			t.Fatal("actual authorization failed", response.StatusCode, err)
		}
		callback := httptest.NewRequest("GET", result.RedirectURI, nil)
		for _, c := range start.Result().Cookies() {
			callback.AddCookie(c)
		}
		w := httptest.NewRecorder()
		s.ssoCallback(w, callback)
		if w.Code != 303 {
			t.Fatal("callback", w.Code)
		}
		for _, c := range w.Result().Cookies() {
			if c.Name == financeSSOCookieName {
				return c
			}
		}
		t.Fatal("opaque family cookie missing")
		return nil
	}
	first, second := login(0), login(1)
	account := func(cookie *http.Cookie) map[string]any {
		t.Helper()
		w := finiteSSOAccount(s, cookie)
		if w.Code != 200 {
			t.Fatal("verified account", w.Code, w.Body.String())
		}
		var body map[string]any
		if json.Unmarshal(w.Body.Bytes(), &body) != nil {
			t.Fatal("account JSON")
		}
		if body["privateWorkspaceAuthorized"] != false {
			t.Fatal("identity expanded private scope")
		}
		return body
	}
	a, b := account(first), account(second)
	if a["account"] == b["account"] {
		t.Fatal("independent identities merged")
	}
	response, err := http.Post(base+"/qa/drop-next-renew-result", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("drop-result control")
	}
	now = now.Add(301 * time.Second)
	clock()
	if finiteSSOAccount(s, first).Code != 503 {
		t.Fatal("lost response must remain recoverable, fail closed")
	}
	backend.Close()
	backend, err = centralbrowserfamily.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.CentralBrowserFamily = backend
	if account(first)["account"] != a["account"] {
		t.Fatal("renew/restart changed identity")
	}
	ref := finiteSSOReference(t, s, first)
	request := httptest.NewRequest("POST", BrowserFinanceOrigin+"/api/sso/logout", strings.NewReader("{}"))
	request.AddCookie(first)
	request.Header.Set("Origin", BrowserFinanceOrigin)
	request.Header.Set("X-YNX-SSO-CSRF", ref.CSRF)
	w := httptest.NewRecorder()
	s.ssoLogout(w, request)
	if w.Code != 200 {
		t.Fatal("logout", w.Code, w.Body.String())
	}
	if finiteSSOAccount(s, first).Code != 401 {
		t.Fatal("old family survived logout")
	}
	if account(second)["account"] != b["account"] {
		t.Fatal("logout harmed independent browser")
	}
}
