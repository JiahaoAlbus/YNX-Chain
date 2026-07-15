package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type RemoteWalletVerifier struct {
	BaseURL string
	Client  *http.Client
}

func (v RemoteWalletVerifier) Verify(ctx context.Context, proof WalletProof) error {
	if strings.TrimSpace(v.BaseURL) == "" {
		return errors.New("YNX Wallet verification endpoint is not configured")
	}
	body, _ := json.Marshal(proof)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(v.BaseURL, "/")+"/v1/mail/verify", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("wallet verification rejected with status %d", resp.StatusCode)
	}
	return nil
}

type RemoteAI struct {
	BaseURL string
	Token   string
	Client  *http.Client
}

func (a RemoteAI) Status(ctx context.Context) (string, string, string, error) {
	if a.BaseURL == "" {
		return "", "", "", errors.New("YNX AI Gateway endpoint is not configured")
	}
	var out struct {
		Provider     string `json:"provider"`
		Model        string `json:"model"`
		CostEstimate string `json:"cost_estimate"`
	}
	if err := a.do(ctx, "/v1/status", map[string]string{"product": ProductID}, &out); err != nil {
		return "", "", "", err
	}
	if out.Provider == "" || out.Model == "" {
		return "", "", "", errors.New("AI provider reports no active model")
	}
	return out.Provider, out.Model, out.CostEstimate, nil
}
func (a RemoteAI) Generate(ctx context.Context, kind string, messages []Message) (string, error) {
	var out struct {
		Result string `json:"result"`
	}
	selected := make([]map[string]string, 0, len(messages))
	for _, m := range messages {
		selected = append(selected, map[string]string{"id": m.ID, "subject": m.Subject, "body": m.Body, "sender": m.SenderHandle})
	}
	if err := a.do(ctx, "/v1/product-workflows", map[string]any{"product": ProductID, "workflow": kind, "selected_messages": selected}, &out); err != nil {
		return "", err
	}
	if strings.TrimSpace(out.Result) == "" {
		return "", errors.New("AI Gateway returned an empty result")
	}
	return out.Result, nil
}
func (a RemoteAI) do(ctx context.Context, path string, in, out any) error {
	body, _ := json.Marshal(in)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.BaseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if a.Token != "" {
		req.Header.Set("Authorization", "Bearer "+a.Token)
	}
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("AI Gateway returned status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
