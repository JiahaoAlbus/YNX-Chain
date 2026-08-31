package finance

import (
	"strings"
	"testing"
)

func TestFinanceServerRejectsProductionModeWithoutDistributedStores(t *testing.T) {
	store, err := OpenStore("")
	if err != nil {
		t.Fatal(err)
	}
	upstreams, err := NewUpstreams("http://127.0.0.1:1", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	auth, _ := testAuthenticator(t, "finance-multi-instance-required")
	_, err = NewServer(&Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}, auth, ServerConfig{CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey, RequireMultiInstance: true})
	if err == nil || !strings.Contains(err.Error(), "PostgreSQL multi-instance") {
		t.Fatalf("expected distributed-store production guard, got %v", err)
	}
}

func TestFinanceServerRateLimitHashesSessionMaterial(t *testing.T) {
	store, err := OpenStore("")
	if err != nil {
		t.Fatal(err)
	}
	upstreams, err := NewUpstreams("http://127.0.0.1:1", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	auth, _ := testAuthenticator(t, "finance-rate-hash")
	server, err := NewServer(&Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}, auth, ServerConfig{CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey})
	if err != nil {
		t.Fatal(err)
	}
	if allowed, err := server.allow("session-secret-value", "GET"); err != nil || !allowed {
		t.Fatalf("rate allowance allowed=%v err=%v", allowed, err)
	}
	store.rateMu.Lock()
	defer store.rateMu.Unlock()
	for key := range store.rate {
		if strings.Contains(key, "session-secret-value") || !strings.HasPrefix(key, "GET:") {
			t.Fatalf("rate store retained raw session material: %q", key)
		}
	}
}
