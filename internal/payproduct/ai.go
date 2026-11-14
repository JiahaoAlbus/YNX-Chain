package payproduct

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

var aiWorkflows = map[string][]string{"invoice_extraction": {"invoice"}, "merchant_support_draft": {"invoice", "refund", "dispute"}, "reconciliation_explanation": {"invoice", "settlement", "webhook"}, "anomaly_review": {"invoice", "settlement", "webhook", "dispute"}}

type AIRunInput struct {
	Workflow       string   `json:"workflow"`
	ContextIDs     []string `json:"contextIds"`
	Permission     string   `json:"permission"`
	OutputLanguage string   `json:"outputLanguage"`
}

var aiOutputLanguages = map[string]string{"en": "English", "zh-Hans": "Simplified Chinese", "zh-Hant": "Traditional Chinese", "ja": "Japanese", "ko": "Korean", "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese", "ru": "Russian", "ar": "Arabic", "id": "Bahasa Indonesia"}

func (s *Service) StartAI(ctx context.Context, merchant Merchant, input AIRunInput) (AIRun, error) {
	if ctx == nil {
		return AIRun{}, errors.New("AI request context is required")
	}
	if err := ctx.Err(); err != nil {
		return AIRun{}, err
	}
	input.ContextIDs = slices.Clone(input.ContextIDs)
	classes, ok := aiWorkflows[input.Workflow]
	if !ok {
		return AIRun{}, errors.New("unsupported Pay AI workflow")
	}
	if input.Permission != "allow-once" {
		return AIRun{}, errors.New("AI requires explicit allow-once permission")
	}
	language, ok := aiOutputLanguages[input.OutputLanguage]
	if !ok {
		return AIRun{}, errors.New("AI output language is unsupported")
	}
	if len(input.ContextIDs) == 0 || len(input.ContextIDs) > 20 {
		return AIRun{}, errors.New("AI context must contain 1 to 20 authorized record IDs")
	}
	seen := make(map[string]bool, len(input.ContextIDs))
	for _, id := range input.ContextIDs {
		if id == "" || strings.TrimSpace(id) != id || seen[id] {
			return AIRun{}, errors.New("AI context requires distinct original record IDs")
		}
		seen[id] = true
	}
	records := []any{}
	err := s.store.View(func(data Snapshot) error {
		for _, id := range input.ContextIDs {
			class := ""
			switch {
			case strings.HasPrefix(id, "inv_"):
				class = "invoice"
			case strings.HasPrefix(id, "rfr_"):
				class = "refund"
			case strings.HasPrefix(id, "dsp_"):
				class = "dispute"
			case strings.HasPrefix(id, "whd_"):
				class = "webhook"
			}
			if !slices.Contains(classes, class) {
				return errors.New("AI context type is not allowed for this workflow")
			}
			switch {
			case strings.HasPrefix(id, "inv_"):
				v, ok := data.Invoices[id]
				if !ok || v.MerchantID != merchant.ID {
					return errors.New("AI context is not authorized")
				}
				records = append(records, v)
			case strings.HasPrefix(id, "rfr_"):
				v, ok := data.Refunds[id]
				if !ok || v.MerchantID != merchant.ID {
					return errors.New("AI context is not authorized")
				}
				records = append(records, v)
			case strings.HasPrefix(id, "dsp_"):
				v, ok := data.Disputes[id]
				if !ok || v.MerchantID != merchant.ID {
					return errors.New("AI context is not authorized")
				}
				records = append(records, v)
			case strings.HasPrefix(id, "whd_"):
				v, ok := data.Deliveries[id]
				if !ok || v.MerchantID != merchant.ID {
					return errors.New("AI context is not authorized")
				}
				records = append(records, v)
			default:
				return errors.New("AI context type is not allowed")
			}
		}
		return nil
	})
	if err != nil {
		return AIRun{}, err
	}
	now := s.now()
	run := AIRun{ID: "air_" + randomToken(12), MerchantID: merchant.ID, Workflow: input.Workflow, ContextIDs: append([]string(nil), input.ContextIDs...), ContextClasses: classes, Provider: "YNX AI Gateway", Status: "running", Permission: "allow-once", EstimatedUnits: int64(len(records)) * 250, OutputLanguage: input.OutputLanguage, CreatedAt: now, UpdatedAt: now}
	err = s.store.Update(func(data *Snapshot) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		data.AIRuns[run.ID] = run
		appendAudit(data, merchant.ID, merchant.ID, "ai."+input.Workflow, run.ID, "authorized", "bounded records only", now)
		return nil
	})
	if err != nil {
		return AIRun{}, err
	}
	if s.ai == nil {
		run.Status = "provider_unavailable"
		run.UpdatedAt = s.now()
		return run, s.saveAIRun(run, "provider_unavailable")
	}
	recordJSON, _ := json.Marshal(records)
	prompt := fmt.Sprintf("You are the YNX Pay %s workflow. Analyze only the supplied authorized JSON records. Never sign, pay, refund, redirect funds, approve disputes, or modify secrets. Return a factual draft in %s with record IDs and uncertainty. Records: %s", input.Workflow, language, recordJSON)
	providerContext, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	worker := s
	if s.merchantAction != nil {
		// The response ends its HTTP context. Keep the original admission and
		// finite authority, but revalidate under the worker's bounded context.
		// Never copy data into a second Store or bypass its authorization fence.
		base := *s
		base.store = s.store.parent
		worker = base.merchantScope(providerContext, s.merchantAction, "ai-run")
	}
	s.aiMu.Lock()
	s.aiCancels[run.ID] = cancel
	s.aiMu.Unlock()
	go func() {
		defer cancel()
		worker.completeAI(providerContext, run, prompt)
	}()
	return run, nil
}
func (s *Service) completeAI(ctx context.Context, run AIRun, prompt string) {
	defer func() {
		s.aiMu.Lock()
		delete(s.aiCancels, run.ID)
		s.aiMu.Unlock()
	}()
	if err := s.store.View(func(data Snapshot) error {
		current, ok := data.AIRuns[run.ID]
		if !ok || current.Status != "running" || current.MerchantID != run.MerchantID || current.Workflow != run.Workflow || !slices.Equal(current.ContextIDs, run.ContextIDs) {
			return errors.New("original AI run is no longer active")
		}
		return ctx.Err()
	}); err != nil {
		return
	}
	provider, model, result, units, err := s.ai.Complete(ctx, run.ID, prompt)
	run.Provider, run.Model, run.Result, run.EstimatedUnits, run.UpdatedAt = provider, model, result, units, s.now()
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			run.Status = "cancelled"
		} else {
			run.Status = "provider_failed"
		}
	} else {
		run.Status = "review"
	}
	_ = s.store.Update(func(data *Snapshot) error {
		current, ok := data.AIRuns[run.ID]
		if !ok || current.Status != "running" || current.MerchantID != run.MerchantID || current.Workflow != run.Workflow || !slices.Equal(current.ContextIDs, run.ContextIDs) {
			return nil
		}
		data.AIRuns[run.ID] = run
		appendAudit(data, run.MerchantID, "system", "ai.result", run.ID, run.Status, "", s.now())
		return nil
	})
}
func (s *Service) ReviewAI(merchant Merchant, id, decision string) (AIRun, error) {
	if decision != "applied" && decision != "rejected" && decision != "cancelled" {
		return AIRun{}, errors.New("AI decision must be applied, rejected, or cancelled")
	}
	var run AIRun
	err := s.store.Update(func(data *Snapshot) error {
		var ok bool
		run, ok = data.AIRuns[id]
		if !ok || run.MerchantID != merchant.ID {
			return errors.New("AI run not found")
		}
		if run.Status != "review" && !(decision == "cancelled" && run.Status == "running") {
			return errors.New("AI run is not reviewable")
		}
		run.Decision = decision
		run.Status = decision
		run.UpdatedAt = s.now()
		data.AIRuns[id] = run
		appendAudit(data, merchant.ID, merchant.ID, "ai.review", id, decision, "result does not execute financial action", s.now())
		return nil
	})
	if err == nil && decision == "cancelled" {
		s.aiMu.Lock()
		cancel := s.aiCancels[id]
		s.aiMu.Unlock()
		if cancel != nil {
			cancel()
		}
	}
	return run, err
}
func (s *Service) saveAIRun(run AIRun, outcome string) error {
	return s.store.Update(func(data *Snapshot) error {
		data.AIRuns[run.ID] = run
		appendAudit(data, run.MerchantID, "system", "ai.result", run.ID, outcome, "", s.now())
		return nil
	})
}

type HTTPAIProvider struct {
	BaseURL, APIKey, Model string
	Client                 *http.Client
}

func (p *HTTPAIProvider) Complete(ctx context.Context, session, prompt string) (string, string, string, int64, error) {
	if p.Client == nil {
		p.Client = &http.Client{Timeout: 60 * time.Second}
	}
	u := strings.TrimRight(p.BaseURL, "/") + "/ai/stream?session=" + url.QueryEscape(session) + "&q=" + url.QueryEscape(prompt)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "YNX AI Gateway", p.Model, "", 0, err
	}
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	applyCorrelationHeaders(req)
	resp, err := p.Client.Do(req)
	if err != nil {
		return "YNX AI Gateway", p.Model, "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "YNX AI Gateway", p.Model, "", 0, fmt.Errorf("YNX AI Gateway returned %d", resp.StatusCode)
	}
	var b strings.Builder
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024), 2<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var event map[string]string
		if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event) == nil {
			b.WriteString(event["text"])
		}
	}
	if err := scanner.Err(); err != nil {
		return "YNX AI Gateway", p.Model, "", 0, err
	}
	result := strings.TrimSpace(b.String())
	if result == "" {
		return "YNX AI Gateway", p.Model, "", 0, errors.New("YNX AI Gateway returned no provider-backed result")
	}
	return "YNX AI Gateway", p.Model, result, int64(len(prompt)+len(result)) / 4, nil
}
