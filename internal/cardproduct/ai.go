package cardproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type HTTPAIProvider struct {
	BaseURL, APIKey, Model string
	Client                 *http.Client
}

func (p *HTTPAIProvider) Complete(ctx context.Context, workflow, prompt string) (string, string, string, int64, error) {
	if p == nil || strings.TrimSpace(p.BaseURL) == "" || strings.TrimSpace(p.APIKey) == "" || strings.TrimSpace(p.Model) == "" {
		return "", "", "", 0, errors.New("AI provider unavailable")
	}
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	body, _ := json.Marshal(map[string]any{"model": p.Model, "workflow": workflow, "prompt": prompt, "permission": "review_only"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(p.BaseURL, "/")+"/v1/complete", bytes.NewReader(body))
	if err != nil {
		return "", "", "", 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	resp, err := client.Do(req)
	if err != nil {
		return "YNX AI Gateway", p.Model, "", 0, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, MaxBodyBytes+1))
	if err != nil {
		return "YNX AI Gateway", p.Model, "", 0, err
	}
	if len(raw) > MaxBodyBytes {
		return "YNX AI Gateway", p.Model, "", 0, errors.New("AI response too large")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "YNX AI Gateway", p.Model, "", 0, fmt.Errorf("AI provider returned %d", resp.StatusCode)
	}
	var out struct {
		Provider string `json:"provider"`
		Model    string `json:"model"`
		Result   string `json:"result"`
		Units    int64  `json:"units"`
	}
	if err := decodeStrict(raw, &out); err != nil {
		return "YNX AI Gateway", p.Model, "", 0, err
	}
	if strings.TrimSpace(out.Provider) == "" {
		out.Provider = "YNX AI Gateway"
	}
	if strings.TrimSpace(out.Model) == "" {
		out.Model = p.Model
	}
	return out.Provider, out.Model, out.Result, out.Units, nil
}
