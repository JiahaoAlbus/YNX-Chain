package aigateway

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// Opt-in local integration: real Ollama inference, controlled chain status,
// loopback Gateway and a disposable access key. This is not wallet admission,
// public deployment, a tool effect or proof of incremental upstream streaming.
func TestLocalOllamaGatewayOriginalResponse(t *testing.T) {
	if os.Getenv("YNX_AI_TEST_LOCAL_OLLAMA") != "1" {
		t.Skip("explicit local Ollama integration not requested")
	}
	chain := newChainServer(t)
	service, err := New(Config{ChainURL: chain.URL, ProviderURL: "http://127.0.0.1:11434/v1", ProviderAuth: ProviderAuthNoneLoopback, Model: "tinyllama:latest", AccessAPIKey: testAccessKey, UpstreamKey: testUpstreamKey, AuditLog: t.TempDir() + "/audit.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()
	req := newGatewayStreamRequest(t, server.URL, "PUBLIC-local-session", "Reply with the single word OK and nothing else.")
	req.Header.Set("X-YNX-AI-Key", testAccessKey)
	client := &http.Client{Timeout: 90 * time.Second}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		_, _ = io.Copy(io.Discard, response.Body)
		t.Fatalf("Gateway refused actual local provider: HTTP %d", response.StatusCode)
	}
	var metadata, tokens, done int
	var event string
	var answer strings.Builder
	scanner := bufio.NewScanner(io.LimitReader(response.Body, 2<<20))
	for scanner.Scan() {
		line := scanner.Text()
		switch line {
		case "event: metadata":
			event = "metadata"
			metadata++
		case "event: token":
			event = "token"
			tokens++
		case "event: done":
			event = "done"
			done++
		case "event: error":
			t.Fatal("Gateway returned an error event")
		default:
			if event == "token" && strings.HasPrefix(line, "data: ") {
				var value struct {
					Text string `json:"text"`
				}
				if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &value) != nil || value.Text == "" {
					t.Fatal("Gateway returned invalid token data")
				}
				answer.WriteString(value.Text)
			}
		}
	}
	if err := scanner.Err(); err != nil || metadata != 1 || tokens < 1 || done != 1 {
		t.Fatalf("invalid Gateway event lifecycle: metadata=%d tokens=%d done=%d err=%v", metadata, tokens, done, err)
	}
	lower := strings.ToLower(answer.String())
	if strings.TrimSpace(lower) == "" || strings.Contains(lower, "<think>") || strings.Contains(lower, "</think>") || strings.Contains(lower, "<analysis>") || strings.Contains(lower, "</analysis>") {
		t.Fatal("Gateway released an empty or reasoning-tagged answer")
	}
	t.Logf("actual local Ollama response reached normal Gateway; metadata=%d token events=%d done=%d (buffered SSE)", metadata, tokens, done)
}
