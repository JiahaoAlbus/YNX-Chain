package social

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type AIStreamRequest struct {
	JobID          string
	Kind           string
	Provider       string
	Model          string
	OutputLanguage string
	ContextText    string
}

type AIUsage struct{ Tokens int }

type AIStreamer interface {
	Stream(context.Context, AIStreamRequest, func(string) error) (AIUsage, error)
}

type AIGatewayClient struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func NewAIGatewayClient(baseURL, apiKey string) (*AIGatewayClient, error) {
	baseURL, apiKey = strings.TrimRight(strings.TrimSpace(baseURL), "/"), strings.TrimSpace(apiKey)
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost"))) {
		return nil, errors.New("Social AI Gateway URL must use HTTPS or loopback HTTP")
	}
	if len(apiKey) < 16 {
		return nil, errors.New("Social AI Gateway server key must contain at least 16 characters")
	}
	return &AIGatewayClient{baseURL: baseURL, apiKey: apiKey, client: &http.Client{Timeout: 45 * time.Second}}, nil
}

func (c *AIGatewayClient) Stream(ctx context.Context, in AIStreamRequest, emit func(string) error) (AIUsage, error) {
	prompt := socialAIPrompt(in)
	if len(prompt) > 8000 {
		return AIUsage{}, errors.New("Social AI request exceeds Gateway prompt limit")
	}
	query := url.Values{"session": {in.JobID}, "q": {prompt}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/ai/stream?"+query.Encode(), nil)
	if err != nil {
		return AIUsage{}, err
	}
	req.Header.Set("X-YNX-AI-Key", c.apiKey)
	req.Header.Set("Accept", "text/event-stream")
	resp, err := c.client.Do(req)
	if err != nil {
		return AIUsage{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return AIUsage{}, fmt.Errorf("AI Gateway returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, 2*1024*1024))
	scanner.Buffer(make([]byte, 4096), 128*1024)
	event, tokens := "", 0
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event:") {
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if event != "token" || !strings.HasPrefix(line, "data:") {
			continue
		}
		var payload struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &payload); err != nil || payload.Text == "" {
			return AIUsage{}, errors.New("AI Gateway emitted malformed token event")
		}
		if err := emit(payload.Text); err != nil {
			return AIUsage{}, err
		}
		tokens += (len([]rune(payload.Text)) + 3) / 4
	}
	if err := scanner.Err(); err != nil {
		return AIUsage{}, err
	}
	if tokens == 0 {
		return AIUsage{}, errors.New("AI Gateway returned no output")
	}
	return AIUsage{Tokens: tokens}, nil
}

func socialAIPrompt(in AIStreamRequest) string {
	instruction := map[string]string{
		"reply_draft":            "Draft one reply for user review. Do not send it.",
		"conversation_summary":   "Summarize the selected conversation accurately and note uncertainty.",
		"translation":            "Translate the selected text while preserving meaning and tone.",
		"inbox_classification":   "Classify the selected inbox thread and explain the category.",
		"moderation_explanation": "Explain the selected moderation outcome and available appeal path without changing the outcome.",
	}[in.Kind]
	return strings.Join([]string{"YNX Social user-approved task.", instruction, "Write the reviewable output in locale: " + in.OutputLanguage + ".", "Never send, publish, follow, block, report, or punish. Return reviewable text only.", "Provider label: " + in.Provider + ". Model label: " + in.Model + ".", "Selected context:", in.ContextText}, "\n")
}
