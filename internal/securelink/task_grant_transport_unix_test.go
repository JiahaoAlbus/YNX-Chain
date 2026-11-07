//go:build linux || darwin

package securelink

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
)

func desktopTaskGrantTestConfig(t *testing.T) AuthorityIPCIngressConfig {
	t.Helper()
	root := t.TempDir()
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	uid := uint32(os.Geteuid())
	if uid == 0 {
		t.Fatal("closed ingress control requires a nonzero actual OS principal; root is deliberately refused")
	}
	paths := []string{"issue", "effect", "query", "effect-query", "effect-reconcile", "revoke", "management"}
	cfg := AuthorityIPCIngressConfig{Service: "task-grant-test", SocketPath: filepath.Join(root, "s"), PeerUID: uid, PeerPID: os.Getpid()}
	for _, path := range paths {
		cfg.Routes = append(cfg.Routes, AuthorityIngressRoute{Method: http.MethodPost, Path: "/internal/auth/task-grants/" + path, MaxRequestBytes: 1 << 20, MaxResponseBytes: 1 << 20, Timeout: time.Second})
	}
	return cfg
}

func TestDesktopTaskGrantIPCIngressClosedRegistration(t *testing.T) {
	cfg := desktopTaskGrantTestConfig(t)
	i, err := NewDesktopTaskGrantIPCIngress(cfg)
	if err != nil || i == nil {
		t.Fatalf("closed seven-route registration: %v", err)
	}
	if len(i.routes) != 7 {
		t.Fatal("incomplete route inventory")
	}
	for _, route := range cfg.Routes {
		// A valid route never turns an ordinary HTTP request into a native
		// withServiceChannel request, even with identity-looking headers.
		for _, identityHeader := range []bool{false, true} {
			r := httptest.NewRequest(route.Method, route.Path, strings.NewReader("{}"))
			r.Host = "task-grant-test"
			r.Header.Set("Content-Type", "application/json")
			if identityHeader {
				r.Header.Set("X-Peer-Uid", "1")
			}
			w := httptest.NewRecorder()
			i.ServeHTTP(w, r)
			if w.Code != http.StatusForbidden || len(i.active) != 0 {
				t.Fatalf("ordinary %s was admitted: status %d", route.Path, w.Code)
			}
		}
	}
	// The original constructor's cardinality remains unchanged.
	if _, err := NewAuthorityIPCIngress(cfg); !errors.Is(err, ErrDenied) {
		t.Fatalf("legacy constructor widened: %v", err)
	}
	cfg.Routes[0].Path = "/changed-after-registration"
	if _, found := i.routes["POST /internal/auth/task-grants/issue"]; !found {
		t.Fatal("registered route aliased caller storage")
	}
	if err := i.Retire(); err != nil {
		t.Fatal(err)
	}
	if err := i.Join(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := i.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopTaskGrantIPCIngressRejectsRouteExpansion(t *testing.T) {
	for _, change := range []struct {
		name string
		edit func(*AuthorityIPCIngressConfig)
	}{
		{"missing", func(c *AuthorityIPCIngressConfig) { c.Routes = c.Routes[:6] }},
		{"legacy-two", func(c *AuthorityIPCIngressConfig) { c.Routes = c.Routes[1:3] }},
		{"duplicate", func(c *AuthorityIPCIngressConfig) { c.Routes[0] = c.Routes[1] }},
		{"get", func(c *AuthorityIPCIngressConfig) { c.Routes[0].Method = http.MethodGet }},
		{"unknown", func(c *AuthorityIPCIngressConfig) { c.Routes[0].Path += "-extra" }},
		{"query", func(c *AuthorityIPCIngressConfig) { c.Routes[0].Path += "?action=issue" }},
		{"encoded", func(c *AuthorityIPCIngressConfig) { c.Routes[0].Path = "/internal/auth/task-grants/%69ssue" }},
		{"oversize", func(c *AuthorityIPCIngressConfig) { c.Routes[0].MaxRequestBytes++ }},
		{"empty", func(c *AuthorityIPCIngressConfig) { c.Routes[0].MaxRequestBytes = 0 }},
	} {
		t.Run(change.name, func(t *testing.T) {
			cfg := desktopTaskGrantTestConfig(t)
			change.edit(&cfg)
			if i, err := NewDesktopTaskGrantIPCIngress(cfg); err == nil || i != nil {
				t.Fatal("invalid closed route registration admitted")
			}
		})
	}
}
