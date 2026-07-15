package payproduct

import (
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

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type PayAPI interface {
	CreateIntent(context.Context, string, string, int64, string) (chain.PayIntent, error)
	CreateInvoice(context.Context, string, int64, string) (chain.Invoice, error)
	Invoice(context.Context, string) (chain.Invoice, error)
	Settle(context.Context, string, string, string, string) (chain.PaySettlement, error)
	Settlement(context.Context, string) (chain.PaySettlement, error)
	CreateRefund(context.Context, string, int64, string, string) (chain.RefundRecord, error)
}

type HTTPPayAPI struct {
	BaseURL, APIKey string
	Client          *http.Client
}

func NewHTTPPayAPI(baseURL, apiKey string) (*HTTPPayAPI, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, errors.New("central Pay API URL must be absolute")
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("central Pay API key is required")
	}
	return &HTTPPayAPI{BaseURL: u.String(), APIKey: apiKey, Client: &http.Client{Timeout: 15 * time.Second}}, nil
}
func (c *HTTPPayAPI) CreateIntent(ctx context.Context, merchant, payout string, amount int64, key string) (chain.PayIntent, error) {
	var out chain.PayIntent
	err := c.do(ctx, http.MethodPost, "/pay/intents", map[string]any{"merchant": merchant, "payoutAddress": payout, "amount": amount, "idempotencyKey": key}, &out)
	return out, err
}
func (c *HTTPPayAPI) CreateInvoice(ctx context.Context, intent string, hours int64, key string) (chain.Invoice, error) {
	var out chain.Invoice
	err := c.do(ctx, http.MethodPost, "/pay/invoices", map[string]any{"intentId": intent, "dueInHours": hours, "idempotencyKey": key}, &out)
	return out, err
}
func (c *HTTPPayAPI) Invoice(ctx context.Context, id string) (chain.Invoice, error) {
	var out chain.Invoice
	err := c.do(ctx, http.MethodGet, "/pay/invoices/"+url.PathEscape(id), nil, &out)
	return out, err
}
func (c *HTTPPayAPI) Settle(ctx context.Context, id, payer, tx, key string) (chain.PaySettlement, error) {
	var out chain.PaySettlement
	err := c.do(ctx, http.MethodPost, "/pay/invoices/"+url.PathEscape(id)+"/settle", map[string]any{"payer": payer, "transactionHash": tx, "idempotencyKey": key}, &out)
	return out, err
}
func (c *HTTPPayAPI) Settlement(ctx context.Context, id string) (chain.PaySettlement, error) {
	var out chain.PaySettlement
	err := c.do(ctx, http.MethodGet, "/pay/invoices/"+url.PathEscape(id)+"/settlement", nil, &out)
	return out, err
}
func (c *HTTPPayAPI) CreateRefund(ctx context.Context, intent string, amount int64, reason, key string) (chain.RefundRecord, error) {
	var out chain.RefundRecord
	err := c.do(ctx, http.MethodPost, "/pay/refunds", map[string]any{"intentId": intent, "amount": amount, "reason": reason, "idempotencyKey": key}, &out)
	return out, err
}
func (c *HTTPPayAPI) do(ctx context.Context, method, path string, body any, out any) error {
	var raw []byte
	var err error
	if body != nil {
		raw, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Client.Do(req)
	if err != nil {
		return fmt.Errorf("central Pay API unavailable: %w", err)
	}
	defer resp.Body.Close()
	response, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("central Pay API rejected request (%d): %s", resp.StatusCode, strings.TrimSpace(string(response)))
	}
	if err := strictJSON(response, out); err != nil {
		return fmt.Errorf("invalid central Pay API response: %w", err)
	}
	return nil
}
