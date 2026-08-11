package payproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
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
func (c *HTTPPayAPI) Health(ctx context.Context) error {
	client := c.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/health", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	applyCorrelationHeaders(req)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("central Pay API health unavailable: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("central Pay API health returned %d", resp.StatusCode)
	}
	return nil
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
func (c *HTTPPayAPI) CreateAuthorizedRefund(ctx context.Context, input AuthorizedRefundSubmission) (chain.RefundRecord, error) {
	if input.CentralRefundID == "" {
		return chain.RefundRecord{}, errors.New("central refund authority must be created before the merchant transaction")
	}
	var completed chain.RefundRecord
	err := c.do(ctx, http.MethodPost, "/pay/refunds/"+url.PathEscape(input.CentralRefundID)+"/complete", map[string]any{"transactionHash": input.TransactionHash, "idempotencyKey": refundCompletionIdempotencyKey(input.IdempotencyKey, input.TransactionHash)}, &completed)
	return completed, err
}

func refundCompletionIdempotencyKey(submissionKey, transactionHash string) string {
	digest := sha256.Sum256([]byte("YNX_PAY_REFUND_COMPLETION_V1\n" + submissionKey + "\n" + transactionHash))
	return fmt.Sprintf("refund-complete-%x", digest[:16])
}
func (c *HTTPPayAPI) RefundEvidence(ctx context.Context, id string, expected AuthorizedRefundSubmission) (AuthoritativeRefundEvidence, error) {
	var record chain.RefundRecord
	if err := c.do(ctx, http.MethodGet, "/pay/refunds/"+url.PathEscape(id), nil, &record); err != nil {
		return AuthoritativeRefundEvidence{}, err
	}
	if record.ID != id || record.Status != "completed" || record.IntentID != expected.IntentID || record.InvoiceID != expected.InvoiceID || record.Merchant != expected.MerchantID || record.PayoutAddress != expected.MerchantAccount || record.Payer != expected.Payer || record.Amount != expected.Amount || record.Currency != expected.Asset || strings.ToLower(record.TransactionHash) != strings.ToLower(expected.TransactionHash) || record.BlockNumber == 0 || record.CompletedAt == nil || record.CompletedAt.IsZero() || len(record.AuditHash) != 64 {
		return AuthoritativeRefundEvidence{}, errors.New("central Pay refund completion is incomplete or mismatched")
	}
	now := time.Now().UTC()
	return AuthoritativeRefundEvidence{ID: record.ID, RequestID: expected.RequestID, InvoiceID: record.InvoiceID, IntentID: record.IntentID, ChainID: ChainID, MerchantID: record.Merchant, MerchantAccount: record.PayoutAddress, Payer: record.Payer, Amount: record.Amount, Asset: record.Currency, TransactionHash: strings.ToLower(record.TransactionHash), BlockNumber: record.BlockNumber, Finality: "committed", Status: "refunded", ReceiptID: record.ID, AuditHash: record.AuditHash, CommittedAt: *record.CompletedAt, Source: "authoritative-central-pay-api", SourceAsOf: now, SourceVersion: 1, Confidence: "authoritative"}, nil
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
	applyCorrelationHeaders(req)
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
