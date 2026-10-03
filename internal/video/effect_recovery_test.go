package video

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type videoPayFixture func(context.Context, string, int64, string) (string, error)

func (f videoPayFixture) CreatePayoutIntent(c context.Context, a string, n int64, id string) (string, error) {
	return f(c, a, n, id)
}
func (f videoPayFixture) VerifyReceipt(context.Context, string, string, int64) error { return nil }
func payoutFixture(t *testing.T) (*Service, string) {
	t.Helper()
	s, c := fixture(t, nil)
	err := s.store.update(func(st *State) error {
		st.Revenue["original_revenue"] = &RevenueRecord{ID: "original_revenue", Owner: c.Owner, AmountYNXT: 5}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return s, c.Owner
}
func TestVideoPayoutReservationPrecedesDispatchAndConcurrentBalance(t *testing.T) {
	s, owner := payoutFixture(t)
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	s.cfg.Pay = videoPayFixture(func(ctx context.Context, actor string, amount int64, id string) (string, error) {
		calls.Add(1)
		raw, e := os.ReadFile(s.store.statePath)
		if e != nil || !strings.Contains(string(raw), id) || !strings.Contains(string(raw), "dispatching") {
			t.Error("external call preceded durable original reservation")
		}
		close(started)
		<-release
		return "confirmed_original_intent", nil
	})
	done := make(chan error, 1)
	go func() { _, e := s.CreatePayoutIntent(context.Background(), owner, 5); done <- e }()
	<-started
	if _, e := s.CreatePayoutIntent(context.Background(), owner, 5); e == nil {
		t.Fatal("concurrent request reused reserved original balance")
	}
	close(release)
	if e := <-done; e != nil {
		t.Fatal(e)
	}
	if calls.Load() != 1 || len(s.store.state.PayoutIntents) != 1 {
		t.Fatal("duplicate remote dispatch")
	}
	for _, p := range s.store.state.PayoutIntents {
		if p.State != "awaiting_wallet_confirmation" || p.PayIntentID != "confirmed_original_intent" {
			t.Fatal("lost original receipt")
		}
	}
}
func TestVideoPayoutUnknownSurvivesRestartAndDoesNotResend(t *testing.T) {
	s, owner := payoutFixture(t)
	var calls atomic.Int32
	s.cfg.Pay = videoPayFixture(func(context.Context, string, int64, string) (string, error) {
		calls.Add(1)
		return "", errors.New("connection lost after dispatch")
	})
	if _, e := s.CreatePayoutIntent(context.Background(), owner, 5); e == nil {
		t.Fatal("unknown dispatch accepted as receipt")
	}
	restarted, e := NewService(s.cfg)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = restarted.CreatePayoutIntent(context.Background(), owner, 5); e == nil {
		t.Fatal("unknown reservation released")
	}
	if calls.Load() != 1 {
		t.Fatal("unknown effect resent")
	}
	snapshot, e := restarted.Studio(owner)
	if e != nil || len(snapshot.PayoutIntents) != 1 || snapshot.PayoutIntents[0].State != "recovery_required" {
		t.Fatalf("lost unknown record %v %v", snapshot.PayoutIntents, e)
	}
}
func TestVideoPayoutCanceledLateResultCannotAttach(t *testing.T) {
	s, owner := payoutFixture(t)
	started := make(chan struct{})
	release := make(chan struct{})
	ended := make(chan struct{})
	s.cfg.Pay = videoPayFixture(func(context.Context, string, int64, string) (string, error) {
		close(started)
		<-release
		defer close(ended)
		return "late_result_must_not_attach", nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, e := s.CreatePayoutIntent(ctx, owner, 5); done <- e }()
	<-started
	cancel()
	select {
	case e := <-done:
		if e == nil {
			t.Fatal("canceled effect succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("effect ignored original cancellation")
	}
	close(release)
	<-ended
	for _, p := range s.store.state.PayoutIntents {
		if p.State != "recovery_required" || p.PayIntentID != "" {
			t.Fatal("late result committed")
		}
	}
}
func TestVideoPayoutRevokedAuthorityRetainsUnknownOriginalEffect(t *testing.T) {
	s, owner := payoutFixture(t)
	var revoked atomic.Bool
	s.cfg.Pay = videoPayFixture(func(context.Context, string, int64, string) (string, error) {
		revoked.Store(true)
		return "remote_accepted_intent", nil
	})
	g := videoTestGrant(s, owner, "original_payout_proof_001", func(context.Context) error {
		if revoked.Load() {
			return ErrUnauthorized
		}
		return nil
	})
	scoped := videoLease(t, s, context.Background(), g, false)
	if _, e := scoped.CreatePayoutIntent(context.Background(), owner, 5); e == nil {
		t.Fatal("revoked result attached")
	}
	for _, p := range s.store.state.PayoutIntents {
		if p.State != "recovery_required" || p.PayIntentID != "" {
			t.Fatal("revocation erased effect or wrote business result")
		}
	}
	if len(s.store.state.BusinessNonces) != 1 {
		t.Fatal("original dispatched proof lost")
	}
}
func TestVideoPayoutPersistenceFailureDoesNotDispatch(t *testing.T) {
	s, owner := payoutFixture(t)
	var calls atomic.Int32
	s.cfg.Pay = videoPayFixture(func(context.Context, string, int64, string) (string, error) { calls.Add(1); return "unexpected", nil })
	if e := os.Mkdir(s.store.statePath+".tmp", 0700); e != nil {
		t.Fatal(e)
	}
	if _, e := s.CreatePayoutIntent(context.Background(), owner, 5); e == nil {
		t.Fatal("failed reservation admitted")
	}
	if calls.Load() != 0 || len(s.store.state.PayoutIntents) != 0 {
		t.Fatal("failed persistence dispatched")
	}
}

type videoAIFixture func(context.Context, AIRequest) (AIResult, error)

func (f videoAIFixture) Generate(c context.Context, r AIRequest) (AIResult, error) { return f(c, r) }
func TestVideoAIUnknownSavedRequestNeverAutomaticallyResends(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "Retained AI request")
	job, e := s.PrepareAI(c.Owner, v.ID, "summary", []string{"metadata"})
	if e != nil {
		t.Fatal(e)
	}
	var calls atomic.Int32
	s.cfg.AI = videoAIFixture(func(context.Context, AIRequest) (AIResult, error) {
		calls.Add(1)
		raw, _ := os.ReadFile(s.store.statePath)
		if !strings.Contains(string(raw), `"State": "running"`) {
			t.Error("provider preceded original durable AI reservation")
		}
		return AIResult{}, errors.New("provider disconnected after receiving request")
	})
	if _, e = s.RunAI(context.Background(), c.Owner, job.ID); e == nil {
		t.Fatal("unknown result completed")
	}
	restarted, e := NewService(s.cfg)
	if e != nil {
		t.Fatal(e)
	}
	saved, e := restarted.GetAI(c.Owner, job.ID)
	if e != nil || saved.State != "recovery_required" {
		t.Fatalf("unknown state lost %v %v", saved, e)
	}
	if _, e = restarted.RunAI(context.Background(), c.Owner, job.ID); e == nil || calls.Load() != 1 {
		t.Fatal("unknown effect resent")
	}
	if _, e = restarted.ReviewAI(c.Owner, job.ID, true); e == nil {
		t.Fatal("unknown output applied")
	}
}
func TestVideoAILateResultAfterCancellationOrRevocationNotCommitted(t *testing.T) {
	for _, kind := range []string{"cancel", "revoke"} {
		t.Run(kind, func(t *testing.T) {
			s, c := fixture(t, nil)
			v := upload(t, s, c, "Fenced AI")
			job, e := s.PrepareAI(c.Owner, v.ID, "summary", nil)
			if e != nil {
				t.Fatal(e)
			}
			started, release, ended := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var revoked atomic.Bool
			s.cfg.AI = videoAIFixture(func(context.Context, AIRequest) (AIResult, error) {
				close(started)
				<-release
				defer close(ended)
				return AIResult{Provider: "provider", Model: "model", Text: "must not attach", Units: 1}, nil
			})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			g := videoTestGrant(s, c.Owner, "original_ai_fence_nonce_001", func(context.Context) error {
				if revoked.Load() {
					return ErrUnauthorized
				}
				return nil
			})
			scoped := videoLease(t, s, ctx, g, false)
			done := make(chan error, 1)
			go func() { _, e := scoped.RunAI(ctx, c.Owner, job.ID); done <- e }()
			<-started
			if kind == "cancel" {
				cancel()
				select {
				case e := <-done:
					if e == nil {
						t.Fatal("canceled AI succeeded")
					}
				case <-time.After(time.Second):
					t.Fatal("AI stalled cancellation")
				}
				close(release)
				<-ended
			} else {
				revoked.Store(true)
				close(release)
				<-ended
				if e := <-done; e == nil {
					t.Fatal("revoked AI succeeded")
				}
			}
			saved, e := s.GetAI(c.Owner, job.ID)
			if e != nil || saved.State != "recovery_required" || saved.Result != "" {
				t.Fatalf("late provider result attached %v %v", saved, e)
			}
		})
	}
}

func TestVideoCanonicalHTTPEffectsUseOriginalDurableRecords(t *testing.T) {
	s, _, claim, _ := videoHTTPFixture(t)
	base := s.cfg.BusinessAuthority
	claim.ProductID = "creator-studio"
	claim.ClientID = "ynx-creator-studio-web-v1"
	claim.ApplicationID = "com.ynxweb4.creator-studio.web"
	claim.Origin = "https://creator.ynxweb4.com"
	claim.Callback = claim.Origin + "/wallet-auth/callback"
	s.cfg.BusinessAuthority = videoAuthorityFunc(func(c context.Context, r *http.Request, scope string, b io.Reader, n int64) (VideoBusinessGrant, error) {
		g, e := base.VerifyVideoBusiness(c, r, scope, b, n)
		g.ProductID = claim.ProductID
		return g, e
	})
	channel, e := s.EnsureChannel(claim.Account, "canonical-effects", "Original canonical channel")
	if e != nil {
		t.Fatal(e)
	}
	video := upload(t, s, channel, "Canonical AI source")
	e = s.store.update(func(st *State) error {
		st.Revenue["original_canonical_receipt"] = &RevenueRecord{ID: "original_canonical_receipt", Owner: claim.Account, AmountYNXT: 5}
		return nil
	})
	if e != nil {
		t.Fatal(e)
	}
	var calls atomic.Int32
	s.cfg.Pay = videoPayFixture(func(context.Context, string, int64, string) (string, error) {
		calls.Add(1)
		return "original_remote_intent", nil
	})
	h := NewServer(s, StaticTokenAuth{}).Handler()
	run := func(path, body, nonce, key string) *httptest.ResponseRecorder {
		r := videoCanonicalRequest(claim, "POST", path, body, nonce)
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	first := run("/v1/studio/payout-intents", `{"amount_ynxt":5}`, "canonical_payout_nonce_001", "stable_payout_intent_001")
	second := run("/v1/studio/payout-intents", `{"amount_ynxt":5}`, "canonical_payout_nonce_002", "stable_payout_intent_001")
	if first.Code != 200 || second.Code != 200 || first.Body.String() != second.Body.String() || calls.Load() != 1 {
		t.Fatalf("canonical payout failed %d %d %s", first.Code, second.Code, first.Body.String())
	}
	job, e := s.PrepareAI(claim.Account, video.ID, "summary", nil)
	if e != nil {
		t.Fatal(e)
	}
	var aiCalls atomic.Int32
	s.cfg.AI = videoAIFixture(func(context.Context, AIRequest) (AIResult, error) {
		aiCalls.Add(1)
		return AIResult{Provider: "fixture-provider", Model: "fixture-model", Text: "Original retained result", Units: 2}, nil
	})
	first = run("/v1/ai/jobs/"+job.ID+"/stream", "", "canonical_ai_nonce_00001", "stable_ai_intent_00001")
	second = run("/v1/ai/jobs/"+job.ID+"/stream", "", "canonical_ai_nonce_00002", "stable_ai_intent_00001")
	if first.Code != 200 || second.Code != 200 || first.Body.String() != second.Body.String() || aiCalls.Load() != 1 || !strings.Contains(first.Body.String(), "review_required") {
		t.Fatalf("canonical AI recovery failed %d %d %s", first.Code, second.Code, first.Body.String())
	}
	retained, e := s.GetAI(claim.Account, job.ID)
	if e != nil || retained.State != "review_required" || retained.Result != "Original retained result" {
		t.Fatal("authoritative saved AI result missing")
	}
}
