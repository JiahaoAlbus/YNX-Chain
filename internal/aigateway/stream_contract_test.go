package aigateway

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func newGatewayStreamRequest(t *testing.T, serverURL, session, prompt string) *http.Request {
	t.Helper()
	return newGatewayStreamRequestWithBody(t, serverURL, map[string]any{
		"session":         session,
		"prompt":          prompt,
		"outputLanguage":  "en",
		"includedContext": []string{"conversation"},
		"excludedContext": []string{"selected_files"},
		"attachments":     []any{},
		"continueFrom":    "",
	})
}

func newGatewayStreamRequestWithBody(t *testing.T, serverURL string, body map[string]any) *http.Request {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, serverURL+"/ai/stream", bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	return req
}

func TestGatewayStreamRejectsLegacyQueryAndUnknownFields(t *testing.T) {
	chainServer := newChainServer(t)
	provider := newProviderServer(t)
	service := newTestService(t, chainServer.URL, provider.URL, t.TempDir()+"/audit.jsonl", 20)
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()

	legacy, err := http.Get(server.URL + "/ai/stream?session=legacy&q=secret-prompt")
	if err != nil {
		t.Fatal(err)
	}
	_ = legacy.Body.Close()
	if legacy.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("legacy GET query route status=%d, want=%d", legacy.StatusCode, http.StatusMethodNotAllowed)
	}

	queryReq := newGatewayStreamRequest(t, server.URL, "query-session", "body prompt")
	queryReq.URL.RawQuery = "q=must-not-be-accepted"
	queryReq.Header.Set("X-YNX-AI-Key", testAccessKey)
	queryResp, err := http.DefaultClient.Do(queryReq)
	if err != nil {
		t.Fatal(err)
	}
	queryBody, _ := io.ReadAll(queryResp.Body)
	_ = queryResp.Body.Close()
	if queryResp.StatusCode != http.StatusBadRequest || !bytes.Contains(queryBody, []byte("query parameters are not allowed")) {
		t.Fatalf("query-bearing POST status=%d body=%s", queryResp.StatusCode, queryBody)
	}

	unknownReq := newGatewayStreamRequestWithBody(t, server.URL, map[string]any{
		"session":         "strict-session",
		"prompt":          "strict prompt",
		"outputLanguage":  "en",
		"includedContext": []string{"conversation"},
		"excludedContext": []string{"selected_files"},
		"attachments":     []any{},
		"continueFrom":    "",
		"unknown":         "must fail closed",
	})
	unknownReq.Header.Set("X-YNX-AI-Key", testAccessKey)
	unknownResp, err := http.DefaultClient.Do(unknownReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = unknownResp.Body.Close()
	if unknownResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown generation field status=%d, want=%d", unknownResp.StatusCode, http.StatusBadRequest)
	}
}

func TestGatewayStreamRequiresExplicitFileContextAndPreservesPromptPrivacy(t *testing.T) {
	chainServer := newChainServer(t)
	provider := newProviderServer(t)
	auditPath := t.TempDir() + "/audit.jsonl"
	service := newTestService(t, chainServer.URL, provider.URL, auditPath, 20)
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()

	implicitReq := newGatewayStreamRequestWithBody(t, server.URL, map[string]any{
		"session":         "implicit-file-session",
		"prompt":          "summarize my selected file",
		"outputLanguage":  "en",
		"includedContext": []string{"conversation"},
		"excludedContext": []string{"selected_files"},
		"attachments": []map[string]any{{
			"id": "file-1", "name": "notes.txt", "mimeType": "text/plain", "text": "private selected text",
		}},
		"continueFrom": "",
	})
	implicitReq.Header.Set("X-YNX-AI-Key", testAccessKey)
	implicitResp, err := http.DefaultClient.Do(implicitReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = implicitResp.Body.Close()
	if implicitResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("implicit attachment context status=%d, want=%d", implicitResp.StatusCode, http.StatusBadRequest)
	}

	prompt := "explain the selected evidence"
	validReq := newGatewayStreamRequestWithBody(t, server.URL, map[string]any{
		"session":         "explicit-file-session",
		"prompt":          prompt,
		"outputLanguage":  "pt",
		"includedContext": []string{"conversation", "selected_files"},
		"excludedContext": []string{"selected_chain_records"},
		"attachments": []map[string]any{{
			"id": "file-2", "name": "evidence.md", "mimeType": "text/markdown", "text": "selected attachment evidence",
		}},
		"continueFrom": "assistant-message-1",
	})
	validReq.Header.Set("X-YNX-AI-Key", testAccessKey)
	validResp, err := http.DefaultClient.Do(validReq)
	if err != nil {
		t.Fatal(err)
	}
	validBody, _ := io.ReadAll(validResp.Body)
	_ = validResp.Body.Close()
	if validResp.StatusCode != http.StatusOK {
		t.Fatalf("valid POST stream status=%d body=%s", validResp.StatusCode, validBody)
	}
	for _, expected := range []string{"event: metadata", "event: done"} {
		if !bytes.Contains(validBody, []byte(expected)) {
			t.Fatalf("valid POST stream missing %q: %s", expected, validBody)
		}
	}
	streamText := strings.Join(strings.Fields(collectGatewaySSEText(t, validBody)), " ")
	for _, expected := range []string{"Respond in language pt", prompt, "evidence.md", "selected attachment evidence"} {
		normalizedExpected := strings.Join(strings.Fields(expected), " ")
		if !strings.Contains(streamText, normalizedExpected) {
			t.Fatalf("reassembled POST stream missing %q: %s", normalizedExpected, streamText)
		}
	}

	audit, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(audit, []byte(prompt)) || bytes.Contains(audit, []byte("selected attachment evidence")) {
		t.Fatalf("audit stored raw prompt or attachment: %s", audit)
	}
	if !bytes.Contains(audit, []byte(PromptHash(prompt))) {
		t.Fatalf("audit missing original prompt hash: %s", audit)
	}
}

func collectGatewaySSEText(t *testing.T, body []byte) string {
	t.Helper()
	var result strings.Builder
	for _, block := range strings.Split(string(body), "\n\n") {
		if !strings.Contains(block, "event: token") {
			continue
		}
		for _, line := range strings.Split(block, "\n") {
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			var token struct {
				Text string `json:"text"`
			}
			if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &token); err != nil {
				t.Fatal(err)
			}
			result.WriteString(token.Text)
			result.WriteByte(' ')
		}
	}
	return result.String()
}
