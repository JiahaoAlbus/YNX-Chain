package payproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type admissionAI struct{ calls atomic.Int32 }

func (a *admissionAI) Complete(context.Context, string, string) (string, string, string, int64, error) {
	a.calls.Add(1)
	return "controlled", "controlled", "draft", 1, nil
}

type admittedGateAI struct{ started, release chan struct{} }

func (a *admittedGateAI) Complete(ctx context.Context, _, _ string) (string, string, string, int64, error) {
	close(a.started)
	select {
	case <-a.release:
		return "controlled", "controlled", "original result", 1, nil
	case <-ctx.Done():
		return "", "", "", 0, ctx.Err()
	}
}

func TestAIOriginalScopedAdmissionOutlivesResponseButNotRetirement(t *testing.T) {
	for _, retired := range []bool{false, true} {
		t.Run(map[bool]string{false: "response-ended", true: "actor-retired"}[retired], func(t *testing.T) {
			s, m, v, server := merchantBusinessQA(t)
			original := merchantQASession(t, server, m, "")
			if err := s.store.Update(func(d *Snapshot) error {
				d.Invoices["inv_original"] = Invoice{ID: "inv_original", MerchantID: m.ID}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			provider := &admittedGateAI{started: make(chan struct{}), release: make(chan struct{})}
			s.ai = provider
			body, _ := json.Marshal(AIRunInput{Workflow: "invoice_extraction", ContextIDs: []string{"inv_original"}, Permission: "allow-once", OutputLanguage: "en"})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			r := httptest.NewRequest("POST", "/v1/merchant/ai/runs", bytes.NewReader(body)).WithContext(ctx)
			r.Header.Set("Authorization", "Bearer "+original.Token)
			// Actual public canonical AI mounting remains closed pending its
			// protected provider composition. Exercise the original scoped service,
			// not a fake HTTP admission or a relaxed route policy.
			admission, err := v.verify(r, body)
			if err != nil {
				t.Fatal(err)
			}
			admission.merchantID = m.ID
			admission.domainID = original.SessionID
			admission.domainToken = strings.Split(original.Token, ".")[1]
			scoped := s.merchantScope(ctx, admission, "ai-run")
			var input AIRunInput
			if err := json.Unmarshal(body, &input); err != nil {
				t.Fatal(err)
			}
			run, err := scoped.StartAI(ctx, m, input)
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-provider.started:
			case <-time.After(time.Second):
				t.Fatal("original admitted provider did not start")
			}
			cancel() // real HTTP request is finished; worker retains finite original authority
			if retired {
				v.active.Store(false)
			}
			close(provider.release)
			deadline := time.Now().Add(time.Second)
			for {
				s.aiMu.Lock()
				_, active := s.aiCancels[run.ID]
				s.aiMu.Unlock()
				if !active {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("AI worker did not finish")
				}
				time.Sleep(time.Millisecond)
			}
			if err := s.store.View(func(d Snapshot) error {
				got := d.AIRuns[run.ID]
				if retired {
					if got.Result != "" || got.Status != "running" {
						t.Fatalf("retired actor wrote result: %+v", got)
					}
				} else if got.Status != "review" || got.Result != "original result" {
					t.Fatalf("response completion lost original result: %+v", got)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func aiAdmissionFixture(t *testing.T) (*Service, Merchant, AIRunInput) {
	t.Helper()
	s, _ := testService(t, &fakePay{}, time.Now)
	m, _ := onboard(t, s)
	if err := s.store.Update(func(data *Snapshot) error {
		data.Invoices["inv_original"] = Invoice{ID: "inv_original", MerchantID: m.ID}
		data.Refunds["rfr_original"] = RefundRequest{ID: "rfr_original", MerchantID: m.ID}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return s, m, AIRunInput{Workflow: "invoice_extraction", ContextIDs: []string{"inv_original"}, Permission: "allow-once", OutputLanguage: "en"}
}

func TestAIAdmissionRejectsFailedCommitBeforeProvider(t *testing.T) {
	for _, reason := range []string{"persistence", "late-authority", "cancelled-request"} {
		t.Run(reason, func(t *testing.T) {
			s, m, input := aiAdmissionFixture(t)
			provider := &admissionAI{}
			s.ai = provider
			base := s.store
			ctx := context.Background()
			switch reason {
			case "persistence":
				base.path = t.TempDir() // a directory cannot be replaced by a state file
			case "late-authority":
				calls := 0
				s.store = &Store{parent: base, authorize: func() (func(*Snapshot) error, error) {
					calls++
					if calls > 1 {
						return nil, errors.New("controlled original authority retired after read")
					}
					return func(*Snapshot) error { return nil }, nil
				}, consume: func(*Snapshot) error { return nil }, afterCommit: func() {}}
			case "cancelled-request":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			if run, err := s.StartAI(ctx, m, input); err == nil || run.ID != "" {
				t.Fatalf("uncommitted AI run admitted: %+v %v", run, err)
			}
			if provider.calls.Load() != 0 {
				t.Fatal("AI provider called without durable admission")
			}
			if err := base.View(func(data Snapshot) error {
				if len(data.AIRuns) != 0 {
					t.Fatal("failed admission changed AI records")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAIAdmissionUsesDistinctWorkflowAllowedRecords(t *testing.T) {
	for _, ids := range [][]string{{"inv_original", "inv_original"}, {""}, {" inv_original"}, {"rfr_original"}} {
		s, m, input := aiAdmissionFixture(t)
		provider := &admissionAI{}
		s.ai = provider
		input.ContextIDs = ids
		if _, err := s.StartAI(context.Background(), m, input); err == nil {
			t.Fatalf("invalid workflow selection admitted: %q", ids)
		}
		if provider.calls.Load() != 0 {
			t.Fatal("invalid selection reached AI provider")
		}
	}
}

func TestAIReviewChecksMerchantAndCommitBeforeCancellation(t *testing.T) {
	s, m, input := aiAdmissionFixture(t)
	provider := &blockingAI{started: make(chan struct{})}
	s.ai = provider
	run, err := s.StartAI(context.Background(), m, input)
	if err != nil {
		t.Fatal(err)
	}
	<-provider.started
	var cancellations atomic.Int32
	s.aiMu.Lock()
	originalCancel := s.aiCancels[run.ID]
	s.aiCancels[run.ID] = func() { cancellations.Add(1); originalCancel() }
	s.aiMu.Unlock()
	t.Cleanup(originalCancel)
	if _, err := s.ReviewAI(Merchant{ID: "mrc_other"}, run.ID, "cancelled"); err == nil {
		t.Fatal("another merchant cancelled the run")
	}
	if cancellations.Load() != 0 {
		t.Fatal("unauthorized review cancelled the original provider")
	}
	originalPath := s.store.path
	s.store.path = t.TempDir()
	if _, err := s.ReviewAI(m, run.ID, "cancelled"); err == nil {
		t.Fatal("failed review persistence was reported successful")
	}
	if cancellations.Load() != 0 {
		t.Fatal("uncommitted review cancelled the original provider")
	}
	s.store.path = originalPath
	if out, err := s.ReviewAI(m, run.ID, "cancelled"); err != nil || out.Status != "cancelled" {
		t.Fatalf("original merchant cancellation failed: %+v %v", out, err)
	}
	if cancellations.Load() != 1 {
		t.Fatal("committed cancellation did not stop original provider once")
	}
}
