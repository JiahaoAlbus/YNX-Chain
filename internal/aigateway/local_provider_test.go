package aigateway

import (
	"context"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func p08LocalConfig(url string) Config {
	return Config{ChainURL: url, ProviderURL: url, ProviderAuth: ProviderAuthNoneLoopback, Model: "PUBLIC-local-function-model", AccessAPIKey: "PUBLIC-gateway-access", UpstreamKey: "PUBLIC-chain-upstream"}
}
func TestP08LocalModelExplicitAuthModeCannotEscapeLoopback(t *testing.T) {
	for _, raw := range []string{"https://remote.example/v1", "http://localhost:1234/v1", "http://192.168.1.1:1234/v1", "http://127.0.0.1:1234/v1?x=1", "http://user@127.0.0.1:1234/v1", "http://127.0.0.1:1234/v1?", "http://127.0.0.1:1234/v1#"} {
		cfg := p08LocalConfig(raw)
		if _, err := New(cfg); err == nil {
			t.Fatal("non-exact tokenless loopback accepted")
		}
	}
	cfg := p08LocalConfig("http://127.0.0.1:1234/v1")
	cfg.ProviderAPIKey = "PUBLIC-accidental-credential"
	if _, err := New(cfg); err == nil {
		t.Fatal("tokenless mode silently ignored a credential")
	}
	cfg.ProviderAPIKey = ""
	cfg.ProviderAuth = ""
	if _, err := New(cfg); err == nil {
		t.Fatal("default bearer mode no longer requires credential")
	}
}
func TestP08LocalModelActualToolLoopHasNoDummyBearer(t *testing.T) {
	var calls atomic.Int32
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_, _ = w.Write([]byte(`{"chainId":6423,"height":23,"network":"PUBLIC","nativeCurrencySymbol":"YNXT"}`))
			return
		}
		if r.Header.Get("Authorization") != "" || len(r.Header.Values("Authorization")) != 0 {
			t.Error("authless provider received a fake/bearer credential")
		}
		var input struct {
			Messages []struct {
				Role, Content string
				ToolCallID    string `json:"tool_call_id"`
			}
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			t.Error("actual request JSON missing")
		}
		round := calls.Add(1)
		if round == 1 {
			_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","tool_calls":[{"id":"PUBLIC-local-read","type":"function","function":{"name":"local_read","arguments":"{}"}}]}}]}`))
			return
		}
		last := input.Messages[len(input.Messages)-1]
		if last.Role != "tool" || !strings.Contains(last.Content, "PUBLIC actual tool bytes") {
			t.Error("local model never received actual tool result")
		}
		_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"PUBLIC local HTTP tool-loop result"}}]}`))
	}))
	defer peer.Close()
	service, err := New(p08LocalConfig(peer.URL))
	if err != nil {
		t.Fatal(err)
	}
	if !service.Health(context.Background(), buildinfo.Info{}).ProviderConfigured {
		t.Fatal("authless local model misreported unconfigured")
	}
	tools := []ToolDefinition{{Name: "local_read", Description: "PUBLIC controlled read", Parameters: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)}}
	executed := 0
	result, err := service.CompleteWithTools(context.Background(), "PUBLIC-session", "Read original controlled tool.", "PUBLIC-run", tools, toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
		executed++
		return ToolExecution{Status: ToolCompleted, Content: []byte("PUBLIC actual tool bytes")}, nil
	}), func(context.Context, string, string, []byte) error { return nil })
	if err != nil || result.Status != ToolCompleted || executed != 1 || calls.Load() != 2 {
		t.Fatalf("local actual tool loop: status=%s calls=%d err=%v", result.Status, calls.Load(), err)
	}
}

func TestP08LocalModelRedirectNeverReachesAnotherRecipient(t *testing.T) {
	var escaped atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { escaped.Add(1); w.WriteHeader(200) }))
	defer other.Close()
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_, _ = w.Write([]byte(`{"chainId":6423,"height":23,"network":"PUBLIC","nativeCurrencySymbol":"YNXT"}`))
			return
		}
		http.Redirect(w, r, other.URL, http.StatusTemporaryRedirect)
	}))
	defer peer.Close()
	service, err := New(p08LocalConfig(peer.URL))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Complete(context.Background(), "PUBLIC-session", "PUBLIC prompt", "PUBLIC-request"); err == nil || escaped.Load() != 0 {
		t.Fatal("local provider redirect escaped fixed recipient")
	}
}
