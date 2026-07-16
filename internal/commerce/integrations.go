package commerce

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
)

type PayVerifier interface {
	Settlement(context.Context, string) (SettlementEvidence, error)
}
type PayHandoff interface {
	CreateInvoice(context.Context, Order, string) (PayInvoiceHandoff, error)
}

type PayInvoiceHandoff struct {
	IntentID, InvoiceID, DeepLink, Merchant, PayoutAddress string
}

type HTTPPayVerifier struct {
	BaseURL, APIKey, MerchantID, PayoutAddress string
	Client                                     *http.Client
}

func (v HTTPPayVerifier) CreateInvoice(ctx context.Context, o Order, idempotencyKey string) (PayInvoiceHandoff, error) {
	if strings.TrimSpace(v.BaseURL) == "" || strings.TrimSpace(v.APIKey) == "" || strings.TrimSpace(v.MerchantID) == "" || strings.TrimSpace(v.PayoutAddress) == "" {
		return PayInvoiceHandoff{}, fmt.Errorf("%w: Pay merchant contract is not configured", ErrUnavailable)
	}
	base, err := secureServiceBase(v.BaseURL, "Pay")
	if err != nil {
		return PayInvoiceHandoff{}, err
	}
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	call := func(path string, input any, out any) error {
		body, _ := json.Marshal(input)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+path, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("X-YNX-Pay-Key", v.APIKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("%w: Pay handoff request failed", ErrUnavailable)
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("%w: Pay handoff returned %d", ErrUnavailable, resp.StatusCode)
		}
		return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
	}
	var intent struct {
		ID string `json:"id"`
	}
	if err := call("/pay/intents", map[string]any{"merchant": v.MerchantID, "payoutAddress": v.PayoutAddress, "amount": o.TotalYNXT, "currency": NativeSymbol, "callbackUrl": "ynxshop://orders/" + o.ID, "idempotencyKey": "shop-intent-" + idempotencyKey}, &intent); err != nil {
		return PayInvoiceHandoff{}, err
	}
	if intent.ID == "" {
		return PayInvoiceHandoff{}, errors.New("Pay returned no intent id")
	}
	var invoice struct {
		ID string `json:"id"`
	}
	if err := call("/pay/invoices", map[string]any{"intentId": intent.ID, "dueInHours": 1, "idempotencyKey": "shop-invoice-" + idempotencyKey}, &invoice); err != nil {
		return PayInvoiceHandoff{}, err
	}
	if invoice.ID == "" {
		return PayInvoiceHandoff{}, errors.New("Pay returned no invoice id")
	}
	return PayInvoiceHandoff{IntentID: intent.ID, InvoiceID: invoice.ID, DeepLink: "ynxpay://invoice/" + invoice.ID, Merchant: v.MerchantID, PayoutAddress: v.PayoutAddress}, nil
}
func (v HTTPPayVerifier) Settlement(ctx context.Context, invoiceID string) (SettlementEvidence, error) {
	if strings.TrimSpace(v.BaseURL) == "" || strings.TrimSpace(v.APIKey) == "" {
		return SettlementEvidence{}, fmt.Errorf("%w: Pay verifier is not configured", ErrUnavailable)
	}
	base, err := secureServiceBase(v.BaseURL, "Pay")
	if err != nil {
		return SettlementEvidence{}, err
	}
	if _, err := url.PathUnescape(invoiceID); err != nil || strings.Contains(invoiceID, "/") {
		return SettlementEvidence{}, errors.New("invalid invoice id")
	}
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/pay/invoices/"+url.PathEscape(invoiceID)+"/settlement", nil)
	if err != nil {
		return SettlementEvidence{}, err
	}
	req.Header.Set("X-YNX-Pay-Key", v.APIKey)
	resp, err := client.Do(req)
	if err != nil {
		return SettlementEvidence{}, fmt.Errorf("%w: Pay verifier request failed", ErrUnavailable)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusConflict {
		return SettlementEvidence{}, fmt.Errorf("%w: settlement is not committed", ErrInvalidState)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return SettlementEvidence{}, fmt.Errorf("%w: Pay verifier returned %d", ErrUnavailable, resp.StatusCode)
	}
	var raw struct {
		InvoiceID, IntentID, Merchant, PayoutAddress, TransactionHash, Status, Payer, Currency, AuditHash string
		Amount, AmountYNXT                                                                                int64
		BlockHeight, BlockNumber                                                                          uint64
		ConfirmedAt, CreatedAt                                                                            time.Time
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&raw); err != nil {
		return SettlementEvidence{}, fmt.Errorf("invalid Pay settlement response: %w", err)
	}
	amount := raw.AmountYNXT
	if amount == 0 {
		amount = raw.Amount
	}
	at := raw.ConfirmedAt
	if at.IsZero() {
		at = raw.CreatedAt
	}
	height := raw.BlockHeight
	if height == 0 {
		height = raw.BlockNumber
	}
	return SettlementEvidence{InvoiceID: raw.InvoiceID, IntentID: raw.IntentID, Merchant: raw.Merchant, PayoutAddress: raw.PayoutAddress, TransactionHash: raw.TransactionHash, Status: raw.Status, Payer: raw.Payer, Currency: raw.Currency, AuditHash: raw.AuditHash, AmountYNXT: amount, BlockHeight: height, ConfirmedAt: at}, nil
}

func (v HTTPPayVerifier) CreateRefund(ctx context.Context, o Order, idempotencyKey string) (RefundEvidence, error) {
	if strings.TrimSpace(v.BaseURL) == "" || strings.TrimSpace(v.APIKey) == "" || strings.TrimSpace(v.MerchantID) == "" {
		return RefundEvidence{}, fmt.Errorf("%w: Pay refund contract is not configured", ErrUnavailable)
	}
	base, err := secureServiceBase(v.BaseURL, "Pay")
	if err != nil {
		return RefundEvidence{}, err
	}
	if o.PayIntentID == "" || o.PayMerchant != v.MerchantID || o.TotalYNXT <= 0 || len(idempotencyKey) < 8 {
		return RefundEvidence{}, ErrInvalidState
	}
	reason := "approved YNX Shop order refund"
	if o.Resolution != nil && strings.TrimSpace(o.Resolution.Reason) != "" {
		reason = strings.TrimSpace(o.Resolution.Reason)
	}
	body, _ := json.Marshal(map[string]any{"intentId": o.PayIntentID, "amount": o.TotalYNXT, "reason": reason, "idempotencyKey": "shop-refund-" + idempotencyKey})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/pay/refunds", bytes.NewReader(body))
	if err != nil {
		return RefundEvidence{}, err
	}
	req.Header.Set("X-YNX-Pay-Key", v.APIKey)
	req.Header.Set("Content-Type", "application/json")
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return RefundEvidence{}, fmt.Errorf("%w: Pay refund request failed", ErrUnavailable)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusConflict {
		return RefundEvidence{}, ErrConflict
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return RefundEvidence{}, fmt.Errorf("%w: Pay refund returned %d", ErrUnavailable, resp.StatusCode)
	}
	var raw struct {
		ID, Signer, Merchant, IntentID, Currency, Reason, Status, IdempotencyKey, RequestHash, TxHash, AuditHash string
		Amount                                                                                                   int64
		BlockHeight                                                                                              int64
		CreatedAt                                                                                                time.Time
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&raw); err != nil {
		return RefundEvidence{}, fmt.Errorf("invalid Pay refund response: %w", err)
	}
	if raw.BlockHeight <= 0 {
		return RefundEvidence{}, errors.New("Pay refund response is not committed")
	}
	return RefundEvidence{ID: raw.ID, Signer: raw.Signer, Merchant: raw.Merchant, IntentID: raw.IntentID, Currency: raw.Currency, Reason: raw.Reason, Status: raw.Status, IdempotencyKey: raw.IdempotencyKey, RequestHash: raw.RequestHash, TransactionHash: raw.TxHash, AuditHash: raw.AuditHash, AmountYNXT: raw.Amount, BlockHeight: uint64(raw.BlockHeight), RecordedAt: raw.CreatedAt}, nil
}

type AIGateway interface {
	Generate(context.Context, AIJob) (string, error)
}
type HTTPAIGateway struct {
	BaseURL, APIKey string
	Client          *http.Client
}

func (v HTTPAIGateway) Generate(ctx context.Context, job AIJob) (string, error) {
	if v.BaseURL == "" || v.APIKey == "" {
		return "", fmt.Errorf("%w: AI provider is not configured", ErrUnavailable)
	}
	base, err := secureServiceBase(v.BaseURL, "AI")
	if err != nil {
		return "", err
	}
	payload, _ := json.Marshal(map[string]any{"workflow": job.Workflow, "contextClasses": job.ContextClasses, "contextSummary": job.ContextSummary, "allowedActions": job.AllowedActions, "estimateUnits": job.EstimateUnits})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/ai/generate", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+v.APIKey)
	req.Header.Set("Content-Type", "application/json")
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: AI provider request failed", ErrUnavailable)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("%w: AI provider returned %d", ErrUnavailable, resp.StatusCode)
	}
	var out struct{ Result string }
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out) != nil || out.Result == "" {
		return "", errors.New("invalid AI provider response")
	}
	return out.Result, nil
}

func secureServiceBase(raw, name string) (string, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || base.Host == "" || base.User != nil || (base.Scheme != "https" && base.Hostname() != "127.0.0.1" && base.Hostname() != "localhost") {
		return "", fmt.Errorf("%w: %s URL must use HTTPS", ErrUnavailable, name)
	}
	return base.String(), nil
}

type AIInput struct {
	Workflow          string
	ContextClasses    []string
	ContextSummary    string
	EstimateUnits     int64
	PermissionGranted bool
	IdempotencyKey    string
}

var aiWorkflows = map[string][]string{"catalog_creation": {"draft_catalog"}, "search_comparison": {"draft_comparison"}, "support_draft": {"draft_support"}, "fulfillment_triage": {"draft_triage"}, "return_explanation": {"draft_explanation"}}

func (s *Store) CreateAIJob(actor string, in AIInput) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	actions, ok := aiWorkflows[in.Workflow]
	if !ok {
		return AIJob{}, errors.New("unsupported AI workflow")
	}
	if !in.PermissionGranted || len(in.ContextClasses) == 0 || len(in.ContextClasses) > 4 || in.ContextSummary == "" || len(in.ContextSummary) > 2000 || in.EstimateUnits <= 0 || in.EstimateUnits > 1_000_000 {
		return AIJob{}, errors.New("bounded context preview, estimate and explicit permission required")
	}
	for _, c := range in.ContextClasses {
		if c != "public_catalog" && c != "owned_order" && c != "seller_catalog_draft" && c != "seller_fulfillment_queue" {
			return AIJob{}, errors.New("context class is not allowed")
		}
	}
	h, replay, err := s.idempotencyLocked(actor, "ai.create", in.IdempotencyKey, in)
	if err != nil {
		return AIJob{}, err
	}
	if replay {
		return s.s.AIJobs[h], nil
	}
	now := s.now()
	j := AIJob{ID: newID("ai"), Actor: actor, Workflow: in.Workflow, Status: "permission_granted", ProviderStatus: "pending", ContextClasses: in.ContextClasses, ContextSummary: in.ContextSummary, AllowedActions: actions, EstimateUnits: in.EstimateUnits, PermissionGranted: true, CreatedAt: now, UpdatedAt: now}
	s.s.AIJobs[j.ID] = j
	s.recordIdempotencyLocked(actor, "ai.create", in.IdempotencyKey, h, j.ID)
	s.auditLocked(actor, "user", "ai_permission_granted", "ai_job", j.ID, "pending", strings.Join(in.ContextClasses, ","))
	if err := s.persistLocked(); err != nil {
		return AIJob{}, err
	}
	return j, nil
}
func (s *Store) RunAIJob(ctx context.Context, actor, id string, g AIGateway) (AIJob, error) {
	s.mu.Lock()
	j, ok := s.s.AIJobs[id]
	if !ok || j.Actor != actor {
		s.mu.Unlock()
		return AIJob{}, ErrNotFound
	}
	if j.Status != "permission_granted" && j.Status != "failed" {
		s.mu.Unlock()
		return AIJob{}, ErrInvalidState
	}
	j.Status = "running"
	j.ProviderStatus = "connecting"
	j.Failure = ""
	j.UpdatedAt = s.now()
	s.s.AIJobs[id] = j
	_ = s.persistLocked()
	s.mu.Unlock()
	result, err := g.Generate(ctx, j)
	s.mu.Lock()
	defer s.mu.Unlock()
	j = s.s.AIJobs[id]
	if j.Cancelled {
		s.auditLocked(actor, "user", "ai_generation_discarded", "ai_job", id, "cancelled", "provider result discarded after cancellation")
		if perr := s.persistLocked(); perr != nil {
			return AIJob{}, perr
		}
		return j, ErrInvalidState
	}
	if err != nil {
		j.Status = "failed"
		j.ProviderStatus = "unavailable"
		j.Failure = err.Error()
	} else {
		j.Status = "review_required"
		j.ProviderStatus = "available"
		j.Result = result
	}
	j.UpdatedAt = s.now()
	s.s.AIJobs[id] = j
	s.auditLocked(actor, "user", "ai_generation", "ai_job", id, j.Status, j.ProviderStatus)
	if perr := s.persistLocked(); perr != nil {
		return AIJob{}, perr
	}
	return j, err
}

func (s *Store) AIJob(actor, id string) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.s.AIJobs[id]
	if !ok || j.Actor != actor {
		return AIJob{}, ErrNotFound
	}
	return j, nil
}
func (s *Store) DeleteAIJob(actor, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.s.AIJobs[id]
	if !ok || j.Actor != actor {
		return ErrNotFound
	}
	if j.Status == "running" {
		return ErrInvalidState
	}
	delete(s.s.AIJobs, id)
	s.auditLocked(actor, "user", "ai_job_deleted", "ai_job", id, "deleted", "result and selected context removed")
	return s.persistLocked()
}
func (s *Store) DecideAIJob(actor, id, decision string) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.s.AIJobs[id]
	if !ok || j.Actor != actor {
		return AIJob{}, ErrNotFound
	}
	if j.Status != "review_required" {
		return AIJob{}, ErrInvalidState
	}
	switch decision {
	case "apply":
		j.Applied = true
		j.Status = "applied_draft"
	case "reject":
		j.Rejected = true
		j.Status = "rejected"
	default:
		return AIJob{}, errors.New("decision must be apply or reject")
	}
	j.UpdatedAt = s.now()
	s.s.AIJobs[id] = j
	s.auditLocked(actor, "user", "ai_result_"+decision, "ai_job", id, j.Status, "AI output remains a draft; protected actions are not executable")
	if err := s.persistLocked(); err != nil {
		return AIJob{}, err
	}
	return j, nil
}
func (s *Store) CancelAIJob(actor, id string) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.s.AIJobs[id]
	if !ok || j.Actor != actor {
		return AIJob{}, ErrNotFound
	}
	if j.Status != "permission_granted" && j.Status != "running" {
		return AIJob{}, ErrInvalidState
	}
	j.Cancelled = true
	j.Status = "cancelled"
	j.UpdatedAt = s.now()
	s.s.AIJobs[id] = j
	s.auditLocked(actor, "user", "ai_cancelled", "ai_job", id, "cancelled", "")
	if err := s.persistLocked(); err != nil {
		return AIJob{}, err
	}
	return j, nil
}
