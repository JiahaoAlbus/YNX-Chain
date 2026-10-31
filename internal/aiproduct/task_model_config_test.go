package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func p08TaskModelConfig(chainURL, providerURL string) TaskModelConfig {
	return TaskModelConfig{ChainURL: chainURL, ProviderURL: providerURL, ProviderAPIKey: "PUBLIC-explicit-provider-key", Model: "PUBLIC-fixed-model", AccessAPIKey: "PUBLIC-explicit-gateway-key", UpstreamKey: "PUBLIC-explicit-upstream-key"}
}

type p08ModelConfigNoToolFixture struct{ t *testing.T }

func (e p08ModelConfigNoToolFixture) ExecuteTool(context.Context, aigateway.ToolCall) (aigateway.ToolExecution, error) {
	e.t.Error("constructor test unexpectedly executed a tool")
	return aigateway.ToolExecution{Status: aigateway.ToolStopped}, errors.New("PUBLIC no-tool fixture")
}

func TestP08TaskModelConfigOriginalServiceHTTPAndAuthority(t *testing.T) {
	// PUBLIC loopback peers exercise original HTTP methods, not a production
	// provider, Chain admission, protected Source or signature authority.
	var chainCalls, providerCalls, upstreamCalls atomic.Int32
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/chain/status":
			chainCalls.Add(1)
			_, _ = w.Write([]byte(`{"chainId":6423,"height":97,"network":"PUBLIC-original-chain-peer","nativeCurrencySymbol":"YNXT"}`))
		case "/provider/v1/chat/completions":
			providerCalls.Add(1)
			if r.Header.Get("Authorization") != "Bearer PUBLIC-explicit-provider-key" || r.Header.Get("X-Request-ID") != "PUBLIC-config-request" {
				t.Error("original provider credentials/request header mapping changed")
			}
			var body struct {
				Model    string
				Messages []struct{ Content string }
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
				return
			}
			if body.Model != "PUBLIC-fixed-model" {
				t.Error("constructor changed configured model")
			}
			if len(body.Messages) < 3 || !strings.Contains(body.Messages[1].Content, "PUBLIC-original-chain-peer") || !strings.Contains(body.Messages[1].Content, "height 97") {
				t.Error("model did not receive actual configured Chain response")
			}
			_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"Actual original Service HTTP provider answer."}}]}`))
		case "/chain/owned-resource":
			upstreamCalls.Add(1)
			if r.Method != http.MethodGet || r.Header.Get("X-YNX-AI-Gateway-Upstream-Key") != "PUBLIC-explicit-upstream-key" {
				t.Error("authoritative upstream credential/method mapping changed")
			}
			_, _ = w.Write([]byte(`{"fixture":"original-authority-read"}`))
		default:
			http.Error(w, "unexpected PUBLIC fixture path", http.StatusNotFound)
		}
	}))
	defer peer.Close()
	cfg := p08TaskModelConfig(" "+peer.URL+"/chain/ ", peer.URL+"/provider/v1/")
	cfg.Window, cfg.MaxRequests = 2*time.Second, 1
	cfg.AuditLog = filepath.Join(t.TempDir(), "never-created", "audit.jsonl")
	service, err := NewTaskModelService(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if chainCalls.Load() != 0 || providerCalls.Load() != 0 || upstreamCalls.Load() != 0 {
		t.Fatal("constructor contacted network peers")
	}
	if _, err := os.Stat(filepath.Dir(cfg.AuditLog)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("constructor created audit files")
	}
	if !service.Authorized(cfg.AccessAPIKey) || service.Authorized("PUBLIC-wrong-gateway-key") {
		t.Fatal("original access-key validation was not preserved")
	}
	// Config is a value snapshot; no mutable provider catalog or setter exists.
	cfg.Model, cfg.ProviderURL, cfg.UpstreamKey = "PUBLIC-other-model", "https://other.invalid", "PUBLIC-other-upstream"
	admissions := 0
	admit := func(_ context.Context, destination, model string, body []byte) error {
		admissions++
		if destination != peer.URL+"/provider/v1" || model != "PUBLIC-fixed-model" || !json.Valid(body) || bytes.Contains(body, []byte("PUBLIC-explicit-provider-key")) {
			t.Error("original disclosure operands/config pins changed or exposed credential")
		}
		return nil // Explicit PUBLIC per-call fixture, not an admitted Source.
	}
	result, err := service.CompleteWithTools(context.Background(), "PUBLIC-session", "Use actual configured peers", "PUBLIC-config-request", taskModelTools()[:1], p08ModelConfigNoToolFixture{t}, admit)
	if err != nil || result.Status != aigateway.ToolCompleted || result.Content != "Actual original Service HTTP provider answer." || admissions != 1 || providerCalls.Load() != 1 || chainCalls.Load() != 1 {
		t.Fatalf("original Service transport not reused: %+v %v", result, err)
	}
	response, err := service.Proxy(context.Background(), http.MethodGet, "/owned-resource", "", http.NoBody, "PUBLIC-authority-request")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || !bytes.Contains(raw, []byte("original-authority-read")) || upstreamCalls.Load() != 1 {
		t.Fatalf("configured original upstream not used: %v", err)
	}
	health := service.Health(context.Background(), buildinfo.Info{})
	if health.UpstreamMode != aigateway.UpstreamAuthoritative || health.SignerAddress != "" || health.Model != "PUBLIC-fixed-model" {
		t.Fatal("constructor installed BFT signer or changed original model")
	}
	now := time.Now()
	if !service.Allow("127.0.0.1:1234", "PUBLIC-rate-key", now) || service.Allow("127.0.0.1:1234", "PUBLIC-rate-key", now) || !service.Allow("127.0.0.1:1234", "PUBLIC-rate-key", now.Add(3*time.Second)) {
		t.Fatal("original rate configuration not preserved")
	}
}

func TestP08TaskModelConfigExplicitMissingAndNoSigner(t *testing.T) {
	// Synthetic env values must never fill an omitted explicit config field or
	// make this task constructor read a BFT signer file.
	t.Setenv("OPENAI_API_KEY", "PUBLIC-env-provider-key")
	t.Setenv("AI_MODEL_NAME", "PUBLIC-env-model")
	t.Setenv("YNX_AI_GATEWAY_UPSTREAM_MODE", "bft")
	t.Setenv("YNX_AI_GATEWAY_SIGNER_PRIVATE_KEY_FILE", filepath.Join(t.TempDir(), "not-a-real-signer"))
	base := p08TaskModelConfig("http://127.0.0.1:6420", "https://provider.invalid/v1")
	for _, field := range []string{"chain", "provider", "model", "provider_key", "access_key", "upstream_key", "bft", "unknown_mode"} {
		t.Run(field, func(t *testing.T) {
			cfg := base
			switch field {
			case "chain":
				cfg.ChainURL = ""
			case "provider":
				cfg.ProviderURL = ""
			case "model":
				cfg.Model = " \t"
			case "provider_key":
				cfg.ProviderAPIKey = ""
			case "access_key":
				cfg.AccessAPIKey = ""
			case "upstream_key":
				cfg.UpstreamKey = ""
			case "bft":
				cfg.UpstreamMode = " bFt "
			case "unknown_mode":
				cfg.UpstreamMode = "caller-mode"
			}
			service, err := NewTaskModelService(cfg)
			if err == nil || service != nil {
				t.Fatalf("missing/unsupported explicit field accepted: %s", field)
			}
			for _, secret := range []string{base.ProviderAPIKey, base.AccessAPIKey, base.UpstreamKey} {
				if strings.Contains(err.Error(), secret) {
					t.Fatal("constructor error disclosed configured credential")
				}
			}
		})
	}
	if service, err := NewTaskModelService(base); err != nil || service == nil {
		t.Fatalf("synthetic BFT env affected explicit authoritative construction: %v", err)
	}
	encoded, err := json.Marshal(base)
	if err != nil || bytes.Contains(encoded, []byte(base.ProviderAPIKey)) || bytes.Contains(encoded, []byte(base.AccessAPIKey)) || bytes.Contains(encoded, []byte(base.UpstreamKey)) {
		t.Fatal("config JSON exposed credentials")
	}
}

func TestP08TaskModelConfigDestinationAndDisclosureRemainClosed(t *testing.T) {
	base := p08TaskModelConfig("http://127.0.0.1:6420", "https://provider.invalid/v1")
	for _, endpoint := range []string{"relative/path", "http://provider.invalid/v1", "https://user:PUBLIC-password@provider.invalid/v1", "https://provider.invalid/v1?token=PUBLIC-query-secret", "https://provider.invalid/v1#fragment", "https://provider.invalid/v1?"} {
		cfg := base
		cfg.ProviderURL = endpoint
		if service, err := NewTaskModelService(cfg); err == nil || service != nil {
			t.Fatalf("invalid/ambiguous provider base accepted: %s", endpoint)
		}
	}
	var providerCalls atomic.Int32
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_, _ = w.Write([]byte(`{"chainId":6423,"height":3,"network":"PUBLIC","nativeCurrencySymbol":"YNXT"}`))
			return
		}
		providerCalls.Add(1)
		t.Error("denied disclosure reached provider")
	}))
	defer peer.Close()
	service, err := NewTaskModelService(p08TaskModelConfig(peer.URL, peer.URL))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareOriginalTaskRuntime(context.Background(), service, nil); !errors.Is(err, errTaskEffectSourceUnavailable) {
		t.Fatal("model constructor installed/minted protected runtime authority")
	}
	cause := errors.New("PUBLIC exact model disclosure denied")
	deny := func(context.Context, string, string, []byte) error { return cause }
	result, err := service.CompleteWithTools(context.Background(), "PUBLIC-session", "Private prompt", "PUBLIC-denied", taskModelTools()[:1], p08ModelConfigNoToolFixture{t}, deny)
	if !errors.Is(err, cause) || result.Content != "" || providerCalls.Load() != 0 {
		t.Fatalf("configured Service bypassed existing per-call disclosure: %+v %v", result, err)
	}
	if result, err := service.CompleteWithTools(context.Background(), "PUBLIC-session", "Private prompt", "PUBLIC-no-disclosure", taskModelTools()[:1], p08ModelConfigNoToolFixture{t}, nil); err == nil || result.Content != "" || providerCalls.Load() != 0 {
		t.Fatal("nil disclosure admitted by constructor")
	}
}

func TestP08TaskModelConfigActualChainFailureNoFallback(t *testing.T) {
	var providerCalls atomic.Int32
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_, _ = w.Write([]byte(`{"chainId":0,"height":97,"network":"unconfirmed","nativeCurrencySymbol":"OTHER"}`))
			return
		}
		providerCalls.Add(1)
	}))
	defer peer.Close()
	service, err := NewTaskModelService(p08TaskModelConfig(peer.URL, peer.URL))
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.CompleteWithTools(context.Background(), "PUBLIC-session", "Read actual chain", "PUBLIC-chain-error", taskModelTools()[:1], p08ModelConfigNoToolFixture{t}, func(context.Context, string, string, []byte) error {
		t.Error("invalid Chain response reached model disclosure")
		return nil
	})
	if err == nil || result.Content != "" || providerCalls.Load() != 0 {
		t.Fatalf("constructor/original Service fabricated chain context: %+v %v", result, err)
	}
}
