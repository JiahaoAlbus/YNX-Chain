package faucet

import (
	"context"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWebsitePolicyAllowsSameOriginClaimAndExternalAssets(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	up := httptest.NewServer(api.NewServer(d))
	defer up.Close()
	s := openTestFaucet(t, admissionTestConfig(t, up.URL))
	h := NewServer(s).Handler()
	for _, p := range []string{"/", "/faucet-assets/app.js", "/faucet-assets/client.js", "/faucet-assets/style.css"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", p, nil))
		if w.Code != 200 {
			t.Fatalf("%s: %d", p, w.Code)
		}
		if p == "/" {
			if !strings.Contains(w.Header().Get("Content-Security-Policy"), "connect-src 'self'") || !strings.Contains(w.Body.String(), "/faucet-assets/app.js") {
				t.Fatal("page cannot load its own assets and funding request")
			}
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	var body Health
	if json.Unmarshal(w.Body.Bytes(), &body) != nil || !body.FundingReady || !body.IdempotentRequests || body.RequestPath != "/request" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("funding readiness unavailable")
	}
}
func TestCoreAuthorityTokenPrivateFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "token")
	token := strings.Repeat("a", 64)
	if err := os.WriteFile(p, []byte(token+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := loadCoreAuthToken(p)
	if err != nil || got != token {
		t.Fatal("valid token rejected")
	}
	os.Chmod(p, 0644)
	if _, err = loadCoreAuthToken(p); err == nil {
		t.Fatal("public token accepted")
	}
	os.Chmod(p, 0600)
	link := p + "-link"
	os.Symlink(p, link)
	if _, err = loadCoreAuthToken(link); err == nil {
		t.Fatal("symlink accepted")
	}
}
func TestHealthClearsHistoricalUpstreamFailureAndRejectsWrongNetwork(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	up := httptest.NewServer(api.NewServer(d))
	defer up.Close()
	s := openTestFaucet(t, admissionTestConfig(t, up.URL))
	s.lastError = "historical outage"
	if !s.CheckHealth(context.Background()).FundingReady {
		t.Fatal("healthy service remained stuck on an old error")
	}
	s.cfg.ChainID = 1
	if s.CheckHealth(context.Background()).FundingReady {
		t.Fatal("wrong chain accepted")
	}
}
