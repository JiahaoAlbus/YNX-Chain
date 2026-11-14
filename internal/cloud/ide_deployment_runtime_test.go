package cloud

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

// PUBLIC current-policy/executor seams. The upstream and bridge transport are
// real local HTTP, not a genuine signed IDE deployment or registered ingress.
type publicIDERuntimeAuthority struct {
	publicIDEAuthority
	denyRuntime, denyOrigin bool
}

func (a *publicIDERuntimeAuthority) AssertProjectRuntimeOrigin(context.Context, string) error {
	if a.denyOrigin {
		return ErrDenied
	}
	return nil
}
func (a *publicIDERuntimeAuthority) AuthorizeProjectRuntime(_ context.Context, _ *http.Request, op IDEDeploymentOperation, _ string) error {
	if a.denyRuntime || op.Binding.ProjectID != "project-a" {
		return ErrDenied
	}
	return nil
}

type publicIDERuntimeExecutor struct {
	publicIDEExecutor
	origin     string
	upstream   *url.URL
	roundTrips int
}

func (e *publicIDERuntimeExecutor) ProjectRuntimeOrigin() string { return e.origin }
func (e *publicIDERuntimeExecutor) ApplyExisting(ctx context.Context, p IDEDeploymentPermit, r io.Reader, current func() error) (IDEDeploymentResult, error) {
	result, err := e.publicIDEExecutor.ApplyExisting(ctx, p, r, current)
	if err != nil {
		return result, err
	}
	result.RuntimeKind = "node-http-project"
	result.RuntimeURL = "https://h" + productHash([]byte(p.Principal+"\x00"+p.RequestID)) + ".runtime.separate-preview.test/"
	return result, nil
}
func (e *publicIDERuntimeExecutor) RoundTripProject(ctx context.Context, _ IDEDeploymentOperation, r *http.Request) (*http.Response, error) {
	e.roundTrips++
	forward := r.Clone(ctx)
	u := *r.URL
	u.Scheme = e.upstream.Scheme
	u.Host = e.upstream.Host
	forward.URL = &u
	forward.RequestURI = ""
	return http.DefaultTransport.RoundTrip(forward)
}

func publicIDERuntimeFixture(t *testing.T, upstream http.Handler) (*Server, *publicIDERuntimeAuthority, *publicIDERuntimeExecutor, http.Handler, string) {
	t.Helper()
	backend := httptest.NewServer(upstream)
	t.Cleanup(backend.Close)
	target, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	s := NewServer(testService(t, nil))
	a := &publicIDERuntimeAuthority{publicIDEAuthority: publicIDEAuthority{principal: "PUBLIC_TEST_ACCOUNT"}}
	e := &publicIDERuntimeExecutor{origin: "https://runtime.separate-preview.test", upstream: target}
	if err := s.EnableIDEDeployments(a, e); err != nil {
		t.Fatal(err)
	}
	body, manifest, _ := ideArtifactData(t)
	if out := publicIDESubmit(t, s.Handler(), body, manifest, "request_original_123456"); out.Code != 201 {
		t.Fatal(out.Body.String())
	}
	h := s.WrapIDEProjectRuntime(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(418)
		w.Write([]byte("ORIGINAL_HANDLER_UNCHANGED"))
	}))
	return s, a, e, h, "h" + productHash([]byte("PUBLIC_TEST_ACCOUNT\x00request_original_123456")) + ".runtime.separate-preview.test"
}
func TestIDEDeploymentRuntimeRealHTTPDoesNotForwardControlCredentials(t *testing.T) {
	var authorization, cookie, proof, path string
	_, _, executor, h, host := publicIDERuntimeFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		cookie = r.Header.Get("Cookie")
		proof = r.Header.Get("X-YNX-Proof")
		path = r.URL.RequestURI()
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Set-Cookie", "PUBLIC_TEST_COOKIE=not-authority")
		w.Write([]byte("<main>ACTUAL_LOCAL_HTTP_TRANSPORT_ONLY</main>"))
	}))
	r := httptest.NewRequest("GET", "https://"+host+"/assets/app?version=1", nil)
	r.Header.Set("Authorization", "PUBLIC_DO_NOT_FORWARD")
	r.Header.Set("Cookie", "PUBLIC_DO_NOT_FORWARD")
	r.Header.Set("X-YNX-Proof", "PUBLIC_DO_NOT_FORWARD")
	out := httptest.NewRecorder()
	h.ServeHTTP(out, r)
	if out.Code != 200 || authorization != "" || cookie != "" || proof != "" || path != "/assets/app?version=1" || executor.roundTrips != 1 || !strings.Contains(out.Body.String(), "ACTUAL_LOCAL_HTTP_TRANSPORT_ONLY") {
		t.Fatalf("proxy leaked/misrouted: %d %q %q %q %q", out.Code, authorization, cookie, proof, path)
	}
	if out.Header().Get("Set-Cookie") != "" || out.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("runtime response safety headers missing")
	}
}
func TestIDEDeploymentRuntimeRevocationAndUnregisteredHost(t *testing.T) {
	_, authority, executor, h, host := publicIDERuntimeFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("PUBLIC_TEST")) }))
	authority.denyRuntime = true
	out := httptest.NewRecorder()
	h.ServeHTTP(out, httptest.NewRequest("GET", "https://"+host+"/", nil))
	if out.Code != 403 || executor.roundTrips != 0 {
		t.Fatal("revoked runtime reached application")
	}
	out = httptest.NewRecorder()
	h.ServeHTTP(out, httptest.NewRequest("GET", "https://cloud.public-authority.test/", nil))
	if out.Code != 418 {
		t.Fatal("original Cloud host replaced")
	}
	out = httptest.NewRecorder()
	h.ServeHTTP(out, httptest.NewRequest("GET", "https://bad.runtime.separate-preview.test/", nil))
	if out.Code != 404 {
		t.Fatal("malformed runtime hostname admitted")
	}
}
func TestIDEDeploymentRuntimeOriginCannotShareAuthCookieSite(t *testing.T) {
	if validateIDEProjectOrigin("https://preview.ynxweb4.com", "https://web4.ynxweb4.com") == nil {
		t.Fatal("project HTML admitted to Auth cookie site")
	}
	if validateIDEProjectOrigin("https://runtime.separate-preview.test", "https://web4.ynxweb4.com") != nil {
		t.Fatal("isolated origin refused")
	}
	if validateIDEProjectOrigin("http://runtime.separate-preview.test", "https://web4.ynxweb4.com") == nil {
		t.Fatal("plaintext public runtime origin admitted")
	}
}
func TestIDEDeploymentRuntimeUnregisteredOriginCannotEnable(t *testing.T) {
	s := NewServer(testService(t, nil))
	authority := &publicIDERuntimeAuthority{denyOrigin: true}
	executor := &publicIDERuntimeExecutor{origin: "https://runtime.separate-preview.test"}
	if err := s.EnableIDEDeployments(authority, executor); err != ErrDenied {
		t.Fatalf("unregistered origin: %v", err)
	}
}

func TestIDEDeploymentRuntimeOriginRevocationIsFresh(t *testing.T) {
	_, authority, executor, h, host := publicIDERuntimeFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("PUBLIC_TEST")) }))
	authority.denyOrigin = true
	out := httptest.NewRecorder()
	h.ServeHTTP(out, httptest.NewRequest("GET", "https://"+host+"/", nil))
	if out.Code != 403 || executor.roundTrips != 0 {
		t.Fatal("revoked origin reached runtime")
	}
}
func TestIDEDeploymentRuntimeNodeBridgeActualHTTP(t *testing.T) {
	node := os.Getenv("YNX_IDE_TEST_NODE")
	if node == "" {
		t.Fatal("explicit cached test Node path required; no download/fallback")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("REAL_LOCAL_BRIDGE_ONLY:" + r.URL.Path))
	}))
	defer server.Close()
	u, _ := url.Parse(server.URL)
	_, portText, _ := net.SplitHostPort(u.Host)
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*1000000000)
	defer cancel()
	cmd := exec.CommandContext(ctx, node, "-e", ideNodeHTTPBridge(port))
	cmd.Env = []string{"PATH=/usr/bin:/bin"}
	cmd.Stdin = strings.NewReader("GET /project-entry HTTP/1.1\r\nHost: public-test.invalid\r\nConnection: close\r\n\r\n")
	raw, err := cmd.Output()
	if err != nil {
		t.Fatalf("actual bridge subprocess: %v", err)
	}
	if !bytes.Contains(raw, []byte("HTTP/1.1 200")) || !bytes.Contains(raw, []byte("REAL_LOCAL_BRIDGE_ONLY:/project-entry")) {
		t.Fatalf("actual bridge output: %s", raw)
	}
}
