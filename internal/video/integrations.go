package video

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type GatewayAI struct {
	Endpoint, Token string
	Client          *http.Client
}

func (g GatewayAI) Generate(ctx context.Context, in AIRequest) (AIResult, error) {
	if g.Endpoint == "" || g.Token == "" {
		return AIResult{}, errors.New("AI Gateway is not configured")
	}
	body, _ := json.Marshal(in)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(g.Endpoint, "/")+"/v1/video/generate", bytes.NewReader(body))
	if err != nil {
		return AIResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+g.Token)
	req.Header.Set("Content-Type", "application/json")
	client := g.Client
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return AIResult{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return AIResult{}, fmt.Errorf("AI Gateway returned %s", res.Status)
	}
	var out AIResult
	d := json.NewDecoder(res.Body)
	d.DisallowUnknownFields()
	if err = d.Decode(&out); err != nil {
		return AIResult{}, err
	}
	if out.Provider == "" || out.Model == "" || out.Text == "" || out.Units < 0 {
		return AIResult{}, errors.New("AI Gateway response is incomplete")
	}
	return out, nil
}

type PayClient struct {
	Endpoint, Token string
	Client          *http.Client
}

func (p PayClient) client() *http.Client {
	if p.Client != nil {
		return p.Client
	}
	return &http.Client{Timeout: 15 * time.Second}
}
func (p PayClient) VerifyReceipt(ctx context.Context, id, owner string, amount int64) error {
	if p.Endpoint == "" || p.Token == "" {
		return errors.New("Pay verifier is not configured")
	}
	u := strings.TrimRight(p.Endpoint, "/") + "/v1/receipts/" + url.PathEscape(id)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.Token)
	res, err := p.client().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("Pay receipt returned %s", res.Status)
	}
	var x struct {
		Owner, State string
		AmountYNXT   int64 `json:"amount_ynxt"`
	}
	if err = json.NewDecoder(res.Body).Decode(&x); err != nil {
		return err
	}
	if x.Owner != owner || x.AmountYNXT != amount || x.State != "committed" {
		return errors.New("Pay receipt evidence mismatch or not committed")
	}
	return nil
}
func (p PayClient) CreatePayoutIntent(ctx context.Context, owner string, amount int64, ref string) (string, error) {
	if p.Endpoint == "" || p.Token == "" {
		return "", errors.New("Pay service is not configured")
	}
	body, _ := json.Marshal(map[string]any{"recipient": owner, "amount_ynxt": amount, "reference": ref, "requires_wallet_confirmation": true})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(p.Endpoint, "/")+"/v1/payout-intents", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+p.Token)
	req.Header.Set("Content-Type", "application/json")
	res, err := p.client().Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("Pay intent returned %s", res.Status)
	}
	var x struct{ ID, State string }
	if err = json.NewDecoder(res.Body).Decode(&x); err != nil {
		return "", err
	}
	if x.ID == "" || x.State != "awaiting_wallet_confirmation" {
		return "", errors.New("Pay intent did not preserve Wallet confirmation boundary")
	}
	return x.ID, nil
}
