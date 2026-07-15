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
	CreateInvoice(context.Context, Order, string) (string, string, error)
}

type HTTPPayVerifier struct {
	BaseURL, APIKey string
	Client          *http.Client
}

func (v HTTPPayVerifier) CreateInvoice(ctx context.Context, o Order, idempotencyKey string) (string, string, error) {
	if strings.TrimSpace(v.BaseURL) == "" || strings.TrimSpace(v.APIKey) == "" {
		return "", "", fmt.Errorf("%w: Pay handoff is not configured", ErrUnavailable)
	}
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	call := func(path string, input any, out any) error {
		body, _ := json.Marshal(input)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(v.BaseURL, "/")+path, bytes.NewReader(body))
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
	if err := call("/pay/intents", map[string]any{"amount": o.TotalYNXT, "currency": NativeSymbol, "callbackUrl": "ynxshop://orders/" + o.ID, "idempotencyKey": "shop-intent-" + idempotencyKey}, &intent); err != nil {
		return "", "", err
	}
	if intent.ID == "" {
		return "", "", errors.New("Pay returned no intent id")
	}
	var invoice struct {
		ID string `json:"id"`
	}
	if err := call("/pay/invoices", map[string]any{"intentId": intent.ID, "dueInHours": 1, "idempotencyKey": "shop-invoice-" + idempotencyKey}, &invoice); err != nil {
		return "", "", err
	}
	if invoice.ID == "" {
		return "", "", errors.New("Pay returned no invoice id")
	}
	return invoice.ID, "ynxpay://invoice/" + invoice.ID, nil
}
func (v HTTPPayVerifier) Settlement(ctx context.Context, invoiceID string) (SettlementEvidence, error) {
	if strings.TrimSpace(v.BaseURL) == "" || strings.TrimSpace(v.APIKey) == "" {
		return SettlementEvidence{}, fmt.Errorf("%w: Pay verifier is not configured", ErrUnavailable)
	}
	if _, err := url.PathUnescape(invoiceID); err != nil || strings.Contains(invoiceID, "/") {
		return SettlementEvidence{}, errors.New("invalid invoice id")
	}
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(v.BaseURL, "/")+"/pay/invoices/"+url.PathEscape(invoiceID)+"/settlement", nil)
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
		InvoiceID, TransactionHash, Status, Payer string
		Amount, AmountYNXT                        int64
		BlockHeight                               uint64
		ConfirmedAt, CreatedAt                    time.Time
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
	return SettlementEvidence{InvoiceID: raw.InvoiceID, TransactionHash: raw.TransactionHash, Status: raw.Status, Payer: raw.Payer, AmountYNXT: amount, BlockHeight: raw.BlockHeight, ConfirmedAt: at}, nil
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
	payload, _ := json.Marshal(map[string]any{"workflow": job.Workflow, "contextClasses": job.ContextClasses, "contextSummary": job.ContextSummary, "allowedActions": job.AllowedActions, "estimateUnits": job.EstimateUnits})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(v.BaseURL, "/")+"/ai/generate", bytes.NewReader(payload))
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
	if !in.PermissionGranted || len(in.ContextClasses) == 0 || in.ContextSummary == "" || in.EstimateUnits <= 0 {
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
