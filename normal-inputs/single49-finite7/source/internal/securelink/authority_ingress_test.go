//go:build linux || darwin

package securelink

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func authorityTestRoute() AuthorityIngressRoute {
	return AuthorityIngressRoute{Method: http.MethodPost, Path: "/settle", MaxRequestBytes: 1024, MaxResponseBytes: 1024, Timeout: 2 * time.Second}
}

func TestAuthorityIngressPlainRequestsAndRegistrationCannotMint(t *testing.T) {
	path, _ := localTestSocket(t)
	cfg := AuthorityIPCIngressConfig{Service: "auth-node", SocketPath: path, PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []AuthorityIngressRoute{authorityTestRoute()}}
	i, err := NewAuthorityIPCIngress(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer i.Close()
	for _, header := range []string{"", "X-Caller-PID", "X-TLS-Peer", "X-YNX-Peer-SAN"} {
		r := httptest.NewRequest(http.MethodPost, "https://adapter.ynx.test/settle", bytes.NewBufferString("original"))
		r.Header.Set("Content-Type", "application/json")
		if header != "" {
			r.Header.Set(header, "123")
		}
		w := httptest.NewRecorder()
		i.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatal("plain/header request minted ingress", w.Code)
		}
	}
	for name, mutate := range map[string]func(*AuthorityIPCIngressConfig){
		"zero uid":           func(c *AuthorityIPCIngressConfig) { c.PeerUID = 0 },
		"zero pid":           func(c *AuthorityIPCIngressConfig) { c.PeerPID = 0 },
		"arbitrary method":   func(c *AuthorityIPCIngressConfig) { c.Routes[0].Method = http.MethodGet },
		"unbounded request":  func(c *AuthorityIPCIngressConfig) { c.Routes[0].MaxRequestBytes = 0 },
		"unbounded response": func(c *AuthorityIPCIngressConfig) { c.Routes[0].MaxResponseBytes = 0 },
		"unbounded timeout":  func(c *AuthorityIPCIngressConfig) { c.Routes[0].Timeout = 0 },
		"query path":         func(c *AuthorityIPCIngressConfig) { c.Routes[0].Path = "/settle?override=1" },
		"third route":        func(c *AuthorityIPCIngressConfig) { c.Routes = append(c.Routes, c.Routes[0], c.Routes[0]) },
	} {
		t.Run(name, func(t *testing.T) {
			c := cfg
			c.Routes = append([]AuthorityIngressRoute(nil), cfg.Routes...)
			mutate(&c)
			if got, e := NewAuthorityIPCIngress(c); e == nil {
				_ = got.Close()
				t.Fatal("invalid ingress registration accepted")
			}
		})
	}
	if err = i.Retire(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err = i.Join(ctx); err != nil {
		t.Fatal(err)
	}
}
