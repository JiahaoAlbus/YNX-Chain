package video

import (
	"bufio"
	"bytes"
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

func (g GatewayAI) Stream(ctx context.Context, in AIRequest, emit func(string) error) (AIResult, error) {
	if g.Endpoint == "" || g.Token == "" {
		return AIResult{}, errors.New("AI Gateway is not configured")
	}
	body, _ := json.Marshal(in)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(g.Endpoint, "/")+"/v1/video/stream", bytes.NewReader(body))
	if err != nil {
		return AIResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+g.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/x-ndjson")
	client := g.Client
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Minute}
	}
	res, err := client.Do(req)
	if err != nil {
		return AIResult{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return AIResult{}, fmt.Errorf("AI Gateway stream returned %s", res.Status)
	}
	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	var out AIResult
	var text strings.Builder
	for scanner.Scan() {
		var event struct {
			Delta, Provider, Model, Error string
			Units                         int64
			Done                          bool
		}
		if err = json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return AIResult{}, err
		}
		if event.Error != "" {
			return AIResult{}, errors.New(event.Error)
		}
		if event.Delta != "" {
			if text.Len()+len(event.Delta) > 200_000 {
				return AIResult{}, errors.New("AI stream exceeded result bound")
			}
			text.WriteString(event.Delta)
			if err = emit(event.Delta); err != nil {
				return AIResult{}, err
			}
		}
		if event.Provider != "" {
			out.Provider = event.Provider
		}
		if event.Model != "" {
			out.Model = event.Model
		}
		if event.Units > 0 {
			out.Units = event.Units
		}
	}
	if err = scanner.Err(); err != nil {
		return AIResult{}, err
	}
	out.Text = text.String()
	if out.Provider == "" || out.Model == "" || out.Text == "" {
		return AIResult{}, errors.New("AI Gateway stream ended without complete provenance or result")
	}
	return out, nil
}

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
	u := strings.TrimRight(p.Endpoint, "/") + "/pay/invoices/" + url.PathEscape(id) + "/settlement"
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
		ID, IntentID, InvoiceID, Merchant, PayoutAddress, Payer, Currency, TransactionHash, Status, AuditHash string
		Amount                                                                                                int64
		BlockNumber                                                                                           uint64
	}
	d := json.NewDecoder(io.LimitReader(res.Body, 2<<20))
	d.DisallowUnknownFields()
	if err = d.Decode(&x); err != nil {
		return err
	}
	if x.InvoiceID != id || x.PayoutAddress != owner || x.Amount != amount || x.Currency != "YNXT" || x.Status != "paid" || x.BlockNumber == 0 || len(x.TransactionHash) != 66 || !strings.HasPrefix(x.TransactionHash, "0x") || len(x.AuditHash) != 64 || x.IntentID == "" || x.ID == "" {
		return errors.New("authoritative Pay settlement evidence mismatch or not committed")
	}
	return nil
}
func (p PayClient) CreatePayoutIntent(ctx context.Context, owner string, amount int64, ref string) (string, error) {
	if p.Endpoint == "" || p.Token == "" {
		return "", errors.New("Pay service is not configured")
	}
	body, _ := json.Marshal(map[string]any{"merchant": "ynx-video", "payoutAddress": owner, "amount": amount, "idempotencyKey": ref})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(p.Endpoint, "/")+"/pay/intents", bytes.NewReader(body))
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
	var x struct {
		ID, Merchant, PayoutAddress, Status, Currency string
		Amount                                        int64
	}
	d := json.NewDecoder(io.LimitReader(res.Body, 2<<20))
	d.DisallowUnknownFields()
	if err = d.Decode(&x); err != nil {
		return "", err
	}
	if x.ID == "" || x.Merchant != "ynx-video" || x.PayoutAddress != owner || x.Amount != amount || x.Currency != "YNXT" || (x.Status != "created" && x.Status != "pending") {
		return "", errors.New("central Pay intent did not preserve creator payout binding")
	}
	return x.ID, nil
}
