package finance

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type AIRequest struct {
	Kind           string         `json:"kind"`
	Account        string         `json:"account"`
	RecordIDs      []string       `json:"recordIds"`
	ContextClasses []string       `json:"contextClasses"`
	Context        map[string]any `json:"context"`
	Permission     string         `json:"permission"`
}

type AIProvider interface {
	Status(context.Context) (provider, model string, available bool, err error)
	Estimate(context.Context, AIRequest) (string, error)
	Stream(context.Context, AIRequest, func(string)) (map[string]any, error)
}

type HTTPAIProvider struct {
	URL    string
	APIKey string
	Client *http.Client
}

func (p *HTTPAIProvider) Status(ctx context.Context) (string, string, bool, error) {
	if strings.TrimSpace(p.URL) == "" {
		return "YNX AI Gateway", "", false, errors.New("YNX AI Gateway is not configured")
	}
	var status struct {
		Provider  string `json:"provider"`
		Model     string `json:"model"`
		Available bool   `json:"available"`
	}
	if err := p.get(ctx, "/v1/status", &status); err != nil {
		return "YNX AI Gateway", "", false, err
	}
	return status.Provider, status.Model, status.Available, nil
}

func (p *HTTPAIProvider) Estimate(ctx context.Context, request AIRequest) (string, error) {
	var out struct {
		Estimate string `json:"estimate"`
	}
	if err := p.post(ctx, "/v1/finance/estimate", request, &out); err != nil {
		return "", err
	}
	if out.Estimate == "" {
		return "", errors.New("AI Gateway returned no resource or cost estimate")
	}
	return out.Estimate, nil
}

func (p *HTTPAIProvider) Stream(ctx context.Context, request AIRequest, emit func(string)) (map[string]any, error) {
	raw, _ := json.Marshal(request)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(p.URL, "/")+"/v1/finance/drafts:stream", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.APIKey)
	}
	resp, err := p.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("AI Gateway returned HTTP %d", resp.StatusCode)
	}
	var result map[string]any
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), 256*1024)
	for scanner.Scan() {
		var event struct {
			Delta  string         `json:"delta"`
			Result map[string]any `json:"result"`
			Error  string         `json:"error"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return nil, errors.New("AI Gateway stream contained invalid JSON")
		}
		if event.Error != "" {
			return nil, errors.New(event.Error)
		}
		if event.Delta != "" {
			emit(event.Delta)
		}
		if event.Result != nil {
			result = event.Result
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if result == nil {
		return nil, errors.New("AI Gateway stream ended without a reviewable result")
	}
	return result, nil
}

func (p *HTTPAIProvider) get(ctx context.Context, path string, out any) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(p.URL, "/")+path, nil)
	if p.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.APIKey)
	}
	resp, err := p.client().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("AI Gateway returned HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (p *HTTPAIProvider) post(ctx context.Context, path string, input, out any) error {
	raw, _ := json.Marshal(input)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(p.URL, "/")+path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if p.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.APIKey)
	}
	resp, err := p.client().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("AI Gateway returned HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (p *HTTPAIProvider) client() *http.Client {
	if p.Client != nil {
		return p.Client
	}
	return &http.Client{Timeout: 30 * time.Second}
}

func (s *Service) StartAI(ctx context.Context, account, kind string, recordIDs, classes []string, consent bool, portfolio Portfolio) (AIJob, error) {
	if !consent || (kind != "categorize" && kind != "explain_fees" && kind != "draft_budget" && kind != "detect_anomalies" && kind != "explain_recurring") {
		return AIJob{}, errors.New("supported AI workflow and explicit context permission are required")
	}
	state := s.Store.Account(account)
	if !state.Privacy.AllowAIActivityContext {
		return AIJob{}, errors.New("AI activity context is disabled in privacy settings")
	}
	owned := map[string]Activity{}
	for _, activity := range portfolio.Activity {
		owned[activity.ID] = activity
	}
	selected := []Activity{}
	for _, id := range recordIDs {
		activity, ok := owned[id]
		if !ok {
			return AIJob{}, errors.New("AI context contains a record not owned by this account")
		}
		selected = append(selected, activity)
	}
	if len(selected) == 0 || len(selected) > 50 {
		return AIJob{}, errors.New("select between one and 50 owned records")
	}
	if len(classes) != 1 || classes[0] != "owned_activity" {
		return AIJob{}, errors.New("Finance AI only accepts the owned_activity context class")
	}
	request := AIRequest{Kind: kind, Account: account, RecordIDs: recordIDs, ContextClasses: classes, Context: map[string]any{"activity": selected, "categories": state.Categories, "budgets": state.Budgets}, Permission: "draft-only; no transaction, transfer, trade, borrow, lend, stake, freeze, or account-control authority"}
	provider, model, available, err := s.AI.Status(ctx)
	if err != nil || !available {
		if err == nil {
			err = errors.New("AI provider reports unavailable")
		}
		return AIJob{}, err
	}
	estimate, err := s.AI.Estimate(ctx, request)
	if err != nil {
		return AIJob{}, err
	}
	now := time.Now().UTC()
	job := AIJob{ID: newID("ai"), Account: account, Kind: kind, RecordIDs: append([]string(nil), recordIDs...), ContextClasses: append([]string(nil), classes...), Provider: provider, Model: model, EstimatedCost: estimate, Status: "running", CreatedAt: now, UpdatedAt: now}
	if err := s.Store.Update(account, "ai.started", job.ID, func(state *AccountState) error { state.AIJobs = append(state.AIJobs, job); return nil }); err != nil {
		return AIJob{}, err
	}
	jobCtx, cancel := context.WithCancel(context.Background())
	s.aiMu.Lock()
	if s.aiCancels == nil {
		s.aiCancels = map[string]context.CancelFunc{}
	}
	s.aiCancels[job.ID] = cancel
	s.aiMu.Unlock()
	go s.runAI(jobCtx, request, job.ID, account)
	return job, nil
}

func (s *Service) runAI(ctx context.Context, request AIRequest, jobID, account string) {
	result, err := s.AI.Stream(ctx, request, func(delta string) {
		_ = s.updateAIJob(account, jobID, func(job *AIJob) {
			job.Progress += delta
			if len(job.Progress) > 4000 {
				job.Progress = job.Progress[len(job.Progress)-4000:]
			}
			job.UpdatedAt = time.Now().UTC()
		})
	})
	_ = s.updateAIJob(account, jobID, func(job *AIJob) {
		job.UpdatedAt = time.Now().UTC()
		if err != nil {
			if errors.Is(err, context.Canceled) {
				job.Status = "cancelled"
			} else {
				job.Status = "failed"
			}
			job.Error = err.Error()
			return
		}
		job.Status = "ready"
		job.Result = result
	})
	s.aiMu.Lock()
	delete(s.aiCancels, jobID)
	s.aiMu.Unlock()
}

func (s *Service) CancelAI(account, id string) error {
	job, ok := s.aiJob(account, id)
	if !ok || job.Status != "running" {
		return errors.New("running AI job not found")
	}
	s.aiMu.Lock()
	cancel := s.aiCancels[id]
	s.aiMu.Unlock()
	if cancel == nil {
		return errors.New("AI job cannot be cancelled after restart")
	}
	cancel()
	return nil
}

func (s *Service) DecideAI(account, id, decision string) error {
	if decision != "apply" && decision != "reject" {
		return errors.New("AI decision must be apply or reject")
	}
	job, ok := s.aiJob(account, id)
	if !ok || job.Status != "ready" {
		return errors.New("reviewable AI job not found")
	}
	if decision == "apply" && job.Kind == "categorize" {
		assignments, _ := job.Result["assignments"].([]any)
		if len(assignments) == 0 || len(assignments) > len(job.RecordIDs) {
			return errors.New("AI category draft has no bounded assignments")
		}
		return s.Store.Update(account, "ai.applied", id, func(state *AccountState) error {
			allowed := map[string]bool{}
			for _, record := range job.RecordIDs {
				allowed[record] = true
			}
			for _, raw := range assignments {
				item, _ := raw.(map[string]any)
				record, _ := item["recordId"].(string)
				category, _ := item["categoryId"].(string)
				if !allowed[record] || !categoryExists(*state, category) {
					return errors.New("AI result references an unauthorized record or category")
				}
				state.Classifications[record] = Classification{RecordID: record, CategoryID: category, Source: "ai-reviewed", UpdatedAt: time.Now().UTC()}
			}
			for i := range state.AIJobs {
				if state.AIJobs[i].ID == id {
					state.AIJobs[i].Status = "applied"
					state.AIJobs[i].Decision = decision
					state.AIJobs[i].UpdatedAt = time.Now().UTC()
				}
			}
			return nil
		})
	}
	if decision == "apply" && job.Kind == "draft_budget" {
		drafts, _ := job.Result["budgets"].([]any)
		if len(drafts) == 0 || len(drafts) > 10 {
			return errors.New("AI budget draft must contain between one and ten budgets")
		}
		return s.Store.Update(account, "ai.applied", id, func(state *AccountState) error {
			if len(state.Budgets)+len(drafts) > 64 {
				return errors.New("budget limit reached")
			}
			now := time.Now().UTC()
			for _, raw := range drafts {
				item, _ := raw.(map[string]any)
				name, _ := item["name"].(string)
				name = strings.TrimSpace(name)
				category, _ := item["categoryId"].(string)
				period, _ := item["period"].(string)
				limit := aiInt64(item["limitYnxt"])
				if name == "" || len(name) > 64 || !categoryExists(*state, category) || (period != "weekly" && period != "monthly") || limit <= 0 {
					return errors.New("AI budget draft contains invalid or unauthorized fields")
				}
				state.Budgets = append(state.Budgets, Budget{ID: newID("budget"), Name: name, CategoryID: category, LimitYNXT: limit, Period: period, StartsAt: now, CreatedAt: now, UpdatedAt: now})
			}
			for i := range state.AIJobs {
				if state.AIJobs[i].ID == id {
					state.AIJobs[i].Status = "applied"
					state.AIJobs[i].Decision = decision
					state.AIJobs[i].UpdatedAt = now
				}
			}
			return nil
		})
	}
	return s.updateAIJob(account, id, func(job *AIJob) {
		job.Status = map[bool]string{true: "rejected", false: "applied"}[decision == "reject"]
		job.Decision = decision
		job.UpdatedAt = time.Now().UTC()
	})
}

func aiInt64(value any) int64 {
	switch v := value.(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case json.Number:
		parsed, _ := v.Int64()
		return parsed
	default:
		return 0
	}
}

func (s *Service) aiJob(account, id string) (AIJob, bool) {
	for _, job := range s.Store.Account(account).AIJobs {
		if job.ID == id {
			return job, true
		}
	}
	return AIJob{}, false
}

func (s *Service) updateAIJob(account, id string, fn func(*AIJob)) error {
	return s.Store.Update(account, "ai.updated", id, func(state *AccountState) error {
		for i := range state.AIJobs {
			if state.AIJobs[i].ID == id {
				fn(&state.AIJobs[i])
				return nil
			}
		}
		return errors.New("AI job not found")
	})
}
