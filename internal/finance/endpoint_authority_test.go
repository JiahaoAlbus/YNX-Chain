package finance

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type browserConfigFixture struct {
	payload []byte
	err     error
}

func (f browserConfigFixture) BrowserConfig(context.Context) ([]byte, error) { return f.payload, f.err }

func TestEndpointAuthorityBrowserConfigIsSameOriginPublicMetadataAndDegradesIndependently(t *testing.T) {
	payload := []byte(`{"schemaVersion":"ynx-finance-endpoint-authority-browser-config/v1"}`)
	server := &Server{cfg: ServerConfig{EndpointAuthority: browserConfigFixture{payload: payload}}}
	response := httptest.NewRecorder()
	server.endpointAuthorityBrowserConfig(response, httptest.NewRequest(http.MethodGet, "/api/endpoint-authority/v2/config", nil))
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || !strings.Contains(response.Header().Get("Content-Type"), "application/json") || strings.TrimSpace(response.Body.String()) != string(payload) {
		t.Fatalf("unexpected config response: %d %v %q", response.Code, response.Header(), response.Body.String())
	}
	server.cfg.EndpointAuthority = browserConfigFixture{err: errors.New("offline")}
	response = httptest.NewRecorder()
	server.endpointAuthorityBrowserConfig(response, httptest.NewRequest(http.MethodGet, "/api/endpoint-authority/v2/config", nil))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "private_service_degraded") {
		t.Fatalf("unexpected degraded response: %d %s", response.Code, response.Body.String())
	}
}

func TestNodeEndpointAuthorityRejectsMissingPartialAndRelativeConfiguration(t *testing.T) {
	gate, err := NewNodeEndpointAuthority(NodeEndpointAuthorityConfig{})
	if err != nil {
		t.Fatal(err)
	}
	err = gate.Authorize(context.Background())
	var rejected *productsessionv2.Error
	if !errors.As(err, &rejected) || rejected.Code != "FINANCE_AUTHORITY_V2_NOT_CONFIGURED" {
		t.Fatal(err)
	}
	if _, err = NewNodeEndpointAuthority(NodeEndpointAuthorityConfig{NodeBinary: "/bin/sh"}); err == nil {
		t.Fatal("partial config accepted")
	}
	if _, err = NewNodeEndpointAuthority(NodeEndpointAuthorityConfig{NodeBinary: "bin/sh", Script: "/tmp/script", TrustRootFile: "/tmp/root", ManifestFile: "/tmp/manifest", CheckpointFile: "/tmp/checkpoint", TrustedTimeFile: "/tmp/time"}); err == nil {
		t.Fatal("relative executable accepted")
	}
}

func TestNodeEndpointAuthorityUsesFixedNoArgumentProcessAndStrictResponse(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "authority.sh")
	body := "#!/bin/sh\n[ \"$#\" -eq 0 ] || exit 91\n[ -n \"$YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUST_ROOT_FILE\" ] || exit 92\nprintf '%s\\n' '{\"schemaVersion\":\"ynx-finance-endpoint-authority-runtime/v1\",\"status\":\"VERIFIED\",\"walletGateway\":\"https://wallet-auth.ynxweb4.com\",\"financeOrigin\":\"https://finance.ynxweb4.com\",\"manifestVersion\":\"2.0.0.1\",\"payloadSha256\":\"" + strings.Repeat("a", 64) + "\",\"officialSandboxVerified\":false,\"providerVerified\":false,\"productionApproved\":false}'\n"
	if err := os.WriteFile(script, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	config := NodeEndpointAuthorityConfig{NodeBinary: "/bin/sh", Script: script, TrustRootFile: filepath.Join(dir, "root"), ManifestFile: filepath.Join(dir, "manifest"), CheckpointFile: filepath.Join(dir, "checkpoint"), TrustedTimeFile: filepath.Join(dir, "time"), Timeout: time.Second}
	gate, err := NewNodeEndpointAuthority(config)
	if err != nil {
		t.Fatal(err)
	}
	for request := 1; request <= 2; request++ {
		if err = gate.Authorize(context.Background()); err != nil {
			t.Fatalf("protected request %d: %v", request, err)
		}
	}
	if err := os.WriteFile(script, []byte(body+"printf warning >&2\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	err = gate.Authorize(context.Background())
	var rejected *productsessionv2.Error
	if !errors.As(err, &rejected) || rejected.Code != "FINANCE_AUTHORITY_V2_INVALID_RESPONSE" || rejected.Status != http.StatusServiceUnavailable {
		t.Fatal(err)
	}
}

type browserHistoryFixture struct {
	browserConfigFixture
	after EndpointAuthorityHistoryCheckpoint
}

func (f *browserHistoryFixture) BrowserHistory(_ context.Context, after EndpointAuthorityHistoryCheckpoint) ([]byte, error) {
	f.after = after
	return []byte(`{"schemaVersion":"ynx-finance-endpoint-authority-history/v1","after":{},"manifests":[]}`), nil
}
func TestEndpointAuthorityHistoryStrictQueryAndNoStore(t *testing.T) {
	fixture := &browserHistoryFixture{}
	server := &Server{cfg: ServerConfig{EndpointAuthority: fixture}}
	good := "/api/endpoint-authority/v2/history?rootVersion=1&sequence=7&payloadSha256=" + strings.Repeat("a", 64)
	response := httptest.NewRecorder()
	server.endpointAuthorityBrowserHistory(response, httptest.NewRequest(http.MethodGet, good, nil))
	if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" || fixture.after.Sequence != 7 {
		t.Fatal("bounded history unavailable", response.Code)
	}
	for _, query := range []string{"", "?rootVersion=1&sequence=7", "?rootVersion=1&sequence=7&payloadSha256=" + strings.Repeat("a", 64) + "&extra=x", "?rootVersion=1&rootVersion=2&sequence=7&payloadSha256=" + strings.Repeat("a", 64), "?rootVersion=1&sequence=-1&payloadSha256=" + strings.Repeat("a", 64), "?rootVersion=1&sequence=7&payloadSha256=" + strings.Repeat("z", 64)} {
		response = httptest.NewRecorder()
		server.endpointAuthorityBrowserHistory(response, httptest.NewRequest(http.MethodGet, "/api/endpoint-authority/v2/history"+query, nil))
		if response.Code != 400 {
			t.Fatal("invalid query accepted", response.Code)
		}
	}
	server.cfg.EndpointAuthority = browserConfigFixture{}
	response = httptest.NewRecorder()
	server.endpointAuthorityBrowserHistory(response, httptest.NewRequest(http.MethodGet, good, nil))
	if response.Code != 503 {
		t.Fatal("missing history provider accepted")
	}
}

func TestNodeEndpointAuthorityHistoryUsesOnlyValidatedCheckpointArgument(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "history.sh")
	body := "#!/bin/sh\n[ \"$#\" -eq 1 ] || exit 91\n[ \"$YNX_FINANCE_ENDPOINT_AUTHORITY_V2_OUTPUT_MODE\" = browser-history ] || exit 92\n[ -z \"$YNX_HISTORY_SECRET_TEST\" ] || exit 93\nprintf '{\"schemaVersion\":\"ynx-finance-endpoint-authority-history/v1\",\"after\":%s,\"manifests\":[{}]}' \"$1\"\n"
	if err := os.WriteFile(script, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("YNX_HISTORY_SECRET_TEST", "must-not-inherit")
	gate, err := NewNodeEndpointAuthority(NodeEndpointAuthorityConfig{NodeBinary: "/bin/sh", Script: script, TrustRootFile: filepath.Join(dir, "root"), ManifestFile: filepath.Join(dir, "manifest"), CheckpointFile: filepath.Join(dir, "checkpoint"), TrustedTimeFile: filepath.Join(dir, "time"), Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	history := gate.(EndpointAuthorityBrowserHistoryProvider)
	after := EndpointAuthorityHistoryCheckpoint{RootVersion: 1, Sequence: 7, PayloadSHA256: strings.Repeat("a", 64)}
	if _, err = history.BrowserHistory(context.Background(), after); err != nil {
		t.Fatal(err)
	}
	after.PayloadSHA256 = "invalid"
	if _, err = history.BrowserHistory(context.Background(), after); err == nil {
		t.Fatal("invalid checkpoint passed")
	}
	body = "#!/bin/sh\nprintf '%s' '{\"schemaVersion\":\"ynx-finance-endpoint-authority-history/v1\",\"after\":{},\"manifests\":[{},{},{}],\"privateKey\":\"not-allowed\"}'\n"
	if err = os.WriteFile(script, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
	after.PayloadSHA256 = strings.Repeat("a", 64)
	if _, err = history.BrowserHistory(context.Background(), after); err == nil {
		t.Fatal("extra fields/unbounded response accepted")
	}
}

type browserRootAnchorFixture struct {
	browserConfigFixture
	after EndpointAuthorityHistoryCheckpoint
}

func (f *browserRootAnchorFixture) BrowserRootAnchor(_ context.Context, after EndpointAuthorityHistoryCheckpoint) ([]byte, error) {
	f.after = after
	return []byte(`{"schemaVersion":"ynx-finance-endpoint-authority-root-anchor/v1","after":{},"manifest":{}}`), nil
}
func TestEndpointAuthorityRootAnchorStrictQueryAndNoStore(t *testing.T) {
	fixture := &browserRootAnchorFixture{}
	server := &Server{cfg: ServerConfig{EndpointAuthority: fixture}}
	good := "/api/endpoint-authority/v2/root-anchor?rootVersion=1&sequence=7&payloadSha256=" + strings.Repeat("a", 64)
	response := httptest.NewRecorder()
	server.endpointAuthorityBrowserRootAnchor(response, httptest.NewRequest(http.MethodGet, good, nil))
	if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" || fixture.after.Sequence != 7 {
		t.Fatal("bounded history unavailable", response.Code)
	}
	for _, query := range []string{"", "?rootVersion=1&sequence=7", "?rootVersion=1&sequence=7&payloadSha256=" + strings.Repeat("a", 64) + "&extra=x", "?rootVersion=1&rootVersion=2&sequence=7&payloadSha256=" + strings.Repeat("a", 64), "?rootVersion=1&sequence=-1&payloadSha256=" + strings.Repeat("a", 64), "?rootVersion=1&sequence=7&payloadSha256=" + strings.Repeat("z", 64)} {
		response = httptest.NewRecorder()
		server.endpointAuthorityBrowserRootAnchor(response, httptest.NewRequest(http.MethodGet, "/api/endpoint-authority/v2/root-anchor"+query, nil))
		if response.Code != 400 {
			t.Fatal("invalid query accepted", response.Code)
		}
	}
	server.cfg.EndpointAuthority = browserConfigFixture{}
	response = httptest.NewRecorder()
	server.endpointAuthorityBrowserRootAnchor(response, httptest.NewRequest(http.MethodGet, good, nil))
	if response.Code != 503 {
		t.Fatal("missing history provider accepted")
	}
}

func TestNodeEndpointAuthorityRootAnchorUsesOnlyValidatedCheckpointArgument(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "history.sh")
	body := "#!/bin/sh\n[ \"$#\" -eq 1 ] || exit 91\n[ \"$YNX_FINANCE_ENDPOINT_AUTHORITY_V2_OUTPUT_MODE\" = browser-root-anchor ] || exit 92\n[ -z \"$YNX_HISTORY_SECRET_TEST\" ] || exit 93\nprintf '{\"schemaVersion\":\"ynx-finance-endpoint-authority-root-anchor/v1\",\"after\":%s,\"manifest\":{}}' \"$1\"\n"
	if err := os.WriteFile(script, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("YNX_HISTORY_SECRET_TEST", "must-not-inherit")
	gate, err := NewNodeEndpointAuthority(NodeEndpointAuthorityConfig{NodeBinary: "/bin/sh", Script: script, TrustRootFile: filepath.Join(dir, "root"), ManifestFile: filepath.Join(dir, "manifest"), CheckpointFile: filepath.Join(dir, "checkpoint"), TrustedTimeFile: filepath.Join(dir, "time"), Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	history := gate.(EndpointAuthorityBrowserRootAnchorProvider)
	after := EndpointAuthorityHistoryCheckpoint{RootVersion: 1, Sequence: 7, PayloadSHA256: strings.Repeat("a", 64)}
	if _, err = history.BrowserRootAnchor(context.Background(), after); err != nil {
		t.Fatal(err)
	}
	after.PayloadSHA256 = "invalid"
	if _, err = history.BrowserRootAnchor(context.Background(), after); err == nil {
		t.Fatal("invalid checkpoint passed")
	}
	body = "#!/bin/sh\nprintf '%s' '{\"schemaVersion\":\"ynx-finance-endpoint-authority-root-anchor/v1\",\"after\":{},\"manifests\":[{},{},{}],\"privateKey\":\"not-allowed\"}'\n"
	if err = os.WriteFile(script, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
	after.PayloadSHA256 = strings.Repeat("a", 64)
	if _, err = history.BrowserRootAnchor(context.Background(), after); err == nil {
		t.Fatal("extra fields/unbounded response accepted")
	}
}
