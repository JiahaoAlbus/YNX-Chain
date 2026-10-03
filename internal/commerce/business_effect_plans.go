package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

func decodeBusinessBody(body []byte, out any) error {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return errors.New("single JSON object required")
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		return errors.New("single JSON object required")
	}
	return nil
}

type effectPayInput struct {
	Order                          Order
	Key, BaseURL, Merchant, Payout string
}

func invoiceEffectResponse(order Order, handoff PayInvoiceHandoff) any {
	return map[string]any{"order": order, "invoiceId": handoff.InvoiceID, "intentId": handoff.IntentID, "deepLink": handoff.DeepLink, "merchant": handoff.Merchant, "payoutAddress": handoff.PayoutAddress, "status": order.Status}
}

func (s *Server) payInvoiceEffect(target string, body []byte) (businessEffectPlan, error) {
	var in struct{ IdempotencyKey string }
	if err := decodeBusinessBody(body, &in); err != nil {
		return businessEffectPlan{}, err
	}
	if len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 {
		return businessEffectPlan{}, ErrInvalidState
	}
	pay := s.cfg.Pay
	pay.Client = guardedEffectHTTPClient(pay.Client, 10*time.Second)
	if pay.BaseURL == "" || pay.APIKey == "" || pay.MerchantID == "" || pay.PayoutAddress == "" {
		return businessEffectPlan{}, ErrUnavailable
	}
	plan := businessEffectPlan{kind: "pay.invoice", target: target, key: in.IdempotencyKey, status: 201}
	plan.prepare = func(tx *Store, actor string) (json.RawMessage, error) {
		order, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return nil, err
		}
		if order.InvoiceID != "" {
			return nil, ErrConflict
		}
		return encodeEffect(effectPayInput{Order: order, Key: in.IdempotencyKey, BaseURL: pay.BaseURL, Merchant: pay.MerchantID, Payout: pay.PayoutAddress})
	}
	plan.check = func(tx *Store, actor string, record BusinessEffect) error {
		var saved effectPayInput
		if err := decodeEffect(record.Input, &saved); err != nil {
			return err
		}
		current, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return err
		}
		if current.Status != "payment_pending" || !current.ReservationExpiresAt.After(tx.now()) || current.TotalYNXT != saved.Order.TotalYNXT || current.Currency != saved.Order.Currency || current.StoreID != saved.Order.StoreID || current.Buyer != saved.Order.Buyer {
			return ErrInvalidState
		}
		if current.InvoiceID != "" {
			return ErrConflict
		}
		if saved.BaseURL != pay.BaseURL || saved.Merchant != pay.MerchantID || saved.Payout != pay.PayoutAddress {
			return ErrConflict
		}
		return nil
	}
	plan.send = func(ctx context.Context, record BusinessEffect) (json.RawMessage, error) {
		var saved effectPayInput
		if err := decodeEffect(record.Input, &saved); err != nil {
			return nil, err
		}
		result, err := pay.CreateInvoice(ctx, saved.Order, saved.Key)
		if err != nil {
			return nil, err
		}
		return encodeEffect(result)
	}
	plan.finish = func(tx *Store, actor string, record BusinessEffect) (any, error) {
		var result PayInvoiceHandoff
		if err := decodeEffect(record.Result, &result); err != nil {
			return nil, err
		}
		order, err := tx.BindInvoice(actor, target, result)
		if err != nil {
			return nil, err
		}
		return invoiceEffectResponse(order, result), nil
	}
	plan.view = func(tx *Store, actor string, record BusinessEffect) (any, error) {
		var result PayInvoiceHandoff
		if err := decodeEffect(record.Result, &result); err != nil {
			return nil, err
		}
		order, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return nil, err
		}
		if order.InvoiceID != result.InvoiceID || order.PayIntentID != result.IntentID || order.PayMerchant != result.Merchant || order.PayPayoutAddress != result.PayoutAddress {
			return nil, ErrConflict
		}
		return invoiceEffectResponse(order, result), nil
	}
	return plan, nil
}

func (s *Store) beginEffectAI(actor, id string) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.s.AIJobs[id]
	if !ok || job.Actor != actor {
		return AIJob{}, ErrNotFound
	}
	if !job.PermissionGranted || job.Cancelled || (job.Status != "permission_granted" && job.Status != "failed") {
		return AIJob{}, ErrInvalidState
	}
	job.RunAttemptID = newID("ai_run")
	job.Status = "running"
	job.ProviderStatus = "connecting"
	job.Failure = ""
	job.UpdatedAt = s.now()
	s.s.AIJobs[id] = job
	return job, nil
}
func (s *Server) aiGenerationEffect(target string, body []byte) (businessEffectPlan, error) {
	var empty struct{}
	if err := decodeBusinessBody(body, &empty); err != nil {
		return businessEffectPlan{}, err
	}
	if s.cfg.AI.BaseURL == "" || s.cfg.AI.APIKey == "" {
		return businessEffectPlan{}, ErrUnavailable
	}
	gateway := s.cfg.AI
	gateway.Client = guardedEffectHTTPClient(gateway.Client, 30*time.Second)
	plan := businessEffectPlan{kind: "ai.generate", target: target, key: target, status: 200}
	plan.prepare = func(tx *Store, actor string) (json.RawMessage, error) {
		job, err := tx.beginEffectAI(actor, target)
		if err != nil {
			return nil, err
		}
		return encodeEffect(struct {
			Job     AIJob
			BaseURL string
		}{job, gateway.BaseURL})
	}
	plan.check = func(tx *Store, actor string, record BusinessEffect) error {
		var saved struct {
			Job     AIJob
			BaseURL string
		}
		if err := decodeEffect(record.Input, &saved); err != nil {
			return err
		}
		job, err := tx.AIJob(actor, target)
		if err != nil {
			return err
		}
		if saved.BaseURL != gateway.BaseURL || job.Status != "running" || job.Cancelled || !job.PermissionGranted || job.RunAttemptID != saved.Job.RunAttemptID {
			return ErrInvalidState
		}
		return nil
	}
	plan.send = func(ctx context.Context, record BusinessEffect) (json.RawMessage, error) {
		var saved struct {
			Job     AIJob
			BaseURL string
		}
		if err := decodeEffect(record.Input, &saved); err != nil {
			return nil, err
		}
		result, err := gateway.Generate(ctx, saved.Job)
		if err != nil {
			return nil, err
		}
		return encodeEffect(struct{ Result string }{result})
	}
	plan.finish = func(tx *Store, actor string, record BusinessEffect) (any, error) {
		var result struct{ Result string }
		if err := decodeEffect(record.Result, &result); err != nil {
			return nil, err
		}
		if result.Result == "" {
			return nil, ErrInvalidState
		}
		tx.mu.Lock()
		defer tx.mu.Unlock()
		job, ok := tx.s.AIJobs[target]
		if !ok || job.Actor != actor || job.Status != "running" || job.Cancelled {
			return nil, ErrInvalidState
		}
		job.Result = result.Result
		job.Status = "review_required"
		job.ProviderStatus = "available"
		job.UpdatedAt = tx.now()
		tx.s.AIJobs[target] = job
		tx.auditLocked(actor, "user", "ai_generation", "ai_job", target, job.Status, job.ProviderStatus)
		return job, nil
	}
	plan.view = func(tx *Store, actor string, record BusinessEffect) (any, error) { return tx.AIJob(actor, target) }
	return plan, nil
}

func (s *Server) serveBusinessExternal(w http.ResponseWriter, r *http.Request, pattern string, body []byte, verified *verifiedBusinessRequest) {
	var plan businessEffectPlan
	var err error
	switch pattern {
	case "POST /api/orders/{id}/pay-handoff":
		plan, err = s.payInvoiceEffect(r.PathValue("id"), body)
	case "POST /api/orders/{id}/confirm-payment":
		plan, err = s.settlementEffect(r.PathValue("id"), body, verified.proof)
	case "POST /api/orders/{id}/transition":
		response, err := s.runBusinessOrderTransition(r.Context(), verified, r.PathValue("id"), body)
		if err != nil {
			failBusiness(w, err)
			return
		}
		if err := verified.current(r.Context()); err != nil {
			failBusiness(w, err)
			return
		}
		write(w, 200, response)
		return
	case "POST /api/ai/jobs/{id}/run":
		plan, err = s.aiGenerationEffect(r.PathValue("id"), body)
	default:
		failBusiness(w, &businessHTTPError{"BUSINESS_EXTERNAL_ADMISSION_REQUIRED", 503})
		return
	}
	if err != nil {
		failBusiness(w, err)
		return
	}
	response, code, err := s.runBusinessEffect(r.Context(), verified, body, plan)
	if err != nil {
		failBusiness(w, err)
		return
	}
	if err := verified.current(r.Context()); err != nil {
		failBusiness(w, err)
		return
	}
	write(w, code, response)
}
