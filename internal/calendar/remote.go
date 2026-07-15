package calendar

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
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(v.BaseURL, "/")+"/v1/calendar/verify", bytes.NewReader(body))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	resp, e := client.Do(req)
	if e != nil {
		return e
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("wallet verification rejected with status %d", resp.StatusCode)
	}
	return nil
}

type RemoteAI struct {
	BaseURL, Token string
	Client         *http.Client
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
	if e := a.do(ctx, "/v1/status", map[string]string{"product": ProductID}, &out); e != nil {
		return "", "", "", e
	}
	if out.Provider == "" || out.Model == "" {
		return "", "", "", errors.New("AI provider reports no active model")
	}
	return out.Provider, out.Model, out.CostEstimate, nil
}
func (a RemoteAI) Generate(ctx context.Context, kind string, events []Event) (string, error) {
	selected := make([]map[string]any, 0, len(events))
	for _, e := range events {
		selected = append(selected, map[string]any{"id": e.ID, "title": e.Title, "start_utc": e.StartUTC, "end_utc": e.EndUTC, "time_zone": e.TimeZone})
	}
	var out struct {
		Result string `json:"result"`
	}
	if e := a.do(ctx, "/v1/product-workflows", map[string]any{"product": ProductID, "workflow": kind, "selected_events": selected}, &out); e != nil {
		return "", e
	}
	if strings.TrimSpace(out.Result) == "" {
		return "", errors.New("AI Gateway returned an empty result")
	}
	return out.Result, nil
}
func (a RemoteAI) do(ctx context.Context, path string, in, out any) error {
	body, _ := json.Marshal(in)
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.BaseURL, "/")+path, bytes.NewReader(body))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	if a.Token != "" {
		req.Header.Set("Authorization", "Bearer "+a.Token)
	}
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, e := client.Do(req)
	if e != nil {
		return e
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("AI Gateway returned status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
