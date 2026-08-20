package resourceproduct

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func do(t *testing.T, s *Service, a Actor, in Action) Result {
	t.Helper()
	r, err := s.Do(a, in)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestResourceAI429EmptyAndCancellationRemainHonest(t *testing.T) {
	for name, handler := range map[string]http.HandlerFunc{
		"rate_limited": func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limited"})
		},
		"empty": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
		},
	} {
		t.Run(name, func(t *testing.T) {
			provider := httptest.NewServer(handler)
			defer provider.Close()
			svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "state.json"), AIURL: provider.URL, AIKey: "key", AIModel: "model"})
			actor := Actor{"user", "user"}
			prepared := do(t, svc, actor, Action{Type: "ai_prepare", IdempotencyKey: "prepare", Reason: "explain quote", Context: []string{"prices"}}).AI
			got := do(t, svc, actor, Action{Type: "ai_run", IdempotencyKey: "run", AIID: prepared.ID, Permission: true}).AI
			if got.Status != "failed" || got.Error == "" {
				t.Fatalf("dishonest provider result: %+v", got)
			}
		})
	}
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() { close(started) })
		select {
		case <-r.Context().Done():
			return
		case <-release:
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("data: {\"text\":\"late\"}\n\n"))
		}
	}))
	defer provider.Close()
	defer close(release)
	svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "cancel.json"), AIURL: provider.URL, AIKey: "key", AIModel: "model"})
	actor := Actor{"user", "user"}
	prepared := do(t, svc, actor, Action{Type: "ai_prepare", IdempotencyKey: "prepare", Reason: "explain", Context: []string{"usage"}}).AI
	done := make(chan Result, 1)
	go func() {
		r, _ := svc.Do(actor, Action{Type: "ai_run", IdempotencyKey: "run", AIID: prepared.ID, Permission: true})
		done <- r
	}()
	<-started
	cancelled := do(t, svc, actor, Action{Type: "ai_cancel", IdempotencyKey: "cancel", AIID: prepared.ID}).AI
	if cancelled.Status != "cancelled" {
		t.Fatalf("cancel=%+v", cancelled)
	}
	select {
	case result := <-done:
		if result.AI == nil || result.AI.Status != "cancelled" {
			t.Fatalf("late provider overwrote cancel: %+v", result)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("AI cancellation did not interrupt provider request")
	}
}
func poolAction(now time.Time) Action {
	return Action{Type: "create_pool", IdempotencyKey: "pool", ResourceType: "Compute", Limit: 1000, Source: "staking-receipt:chain-6423-10", Expiry: now.Add(24 * time.Hour), Fee: 2, Policy: Policy{AllowedBeneficiaries: []string{"beneficiary"}, MaxPerGrant: 300, Revocable: true}}
}

func confirmPoolForAuthoritativeTest(t *testing.T, svc *Service, id string) Pool {
	t.Helper()
	svc.mu.Lock()
	defer svc.mu.Unlock()
	p := svc.data.Pools[id]
	p.Status = "capacity_confirmed"
	p.Available = p.Limit
	svc.data.Pools[id] = p
	if err := svc.saveLocked(); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPoolSponsorshipLifecycleReplayRestartAndNoAssets(t *testing.T) {
	now := time.Date(2026, 7, 15, 9, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state.json")
	svc, _ := New(Config{StorePath: path, Now: func() time.Time { return now }})
	owner := Actor{"owner", "user"}
	p := do(t, svc, owner, poolAction(now)).Pool
	if p.Available != 0 || p.Status != "pending_capacity_evidence" || p.ResourceType != "Compute" {
		t.Fatalf("pool %+v", p)
	}
	again := do(t, svc, owner, poolAction(now))
	if !again.Replayed || again.Pool.ID != p.ID {
		t.Fatalf("replay %+v", again)
	}
	changed := poolAction(now)
	changed.Limit = 999
	if _, err := svc.Do(owner, changed); err == nil {
		t.Fatal("changed replay accepted")
	}
	confirmed := confirmPoolForAuthoritativeTest(t, svc, p.ID)
	p = &confirmed
	base := Action{Type: "sponsor", IdempotencyKey: "sponsor", PoolID: p.ID, Beneficiary: "beneficiary", Limit: 250, Expiry: now.Add(time.Hour)}
	if _, err := svc.Do(owner, base); err == nil {
		t.Fatal("sponsorship without beneficiary consent")
	}
	base.BeneficiaryConsent = true
	base.IdempotencyKey = "sponsor-ok"
	r := do(t, svc, owner, base).Record
	if r.Owner != "owner" || r.Beneficiary != "beneficiary" || r.ResourceType != "Compute" || r.Limit != 250 || r.Source == "" || r.Expiry.IsZero() || r.Fee != 500 || len(r.Audit) == 0 {
		t.Fatalf("record missing required display fields: %+v", r)
	}
	if !strings.Contains(r.Settlement, "external") || strings.Contains(strings.ToLower(r.Settlement), "transferred") {
		t.Fatalf("false asset claim: %s", r.Settlement)
	}
	if _, err := svc.Do(Actor{"intruder", "user"}, Action{Type: "revoke", IdempotencyKey: "bad", RecordID: r.ID}); err == nil {
		t.Fatal("unauthorized revocation")
	}
	revoked := do(t, svc, owner, Action{Type: "revoke", IdempotencyKey: "revoke", RecordID: r.ID}).Record
	if revoked.Status != "revoked" {
		t.Fatal("capacity not revoked")
	}
	view, _ := svc.View(owner)
	if view["policy"].(map[string]any)["assetMovement"] != false {
		t.Fatal("asset movement boundary missing")
	}
	restarted, err := New(Config{StorePath: path, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	rv, _ := restarted.View(owner)
	if len(rv["pools"].([]Pool)) != 1 || len(rv["records"].([]Record)) != 1 {
		t.Fatal("restart lost state")
	}
	now = now.Add(48 * time.Hour)
	do(t, restarted, Actor{"system", "system"}, Action{Type: "expire_resources", IdempotencyKey: "expire"})
	rv, _ = restarted.View(owner)
	if rv["pools"].([]Pool)[0].Status != "expired" {
		t.Fatal("expired pool remained active")
	}
}

func TestAllResourceTypesStakeDelegationRentalPolicyExpiryAndDispute(t *testing.T) {
	now := time.Date(2026, 7, 15, 9, 0, 0, 0, time.UTC)
	svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "s.json"), Now: func() time.Time { return now }})
	for i, typ := range []string{"Bandwidth", "Compute", "AI Credits", "Trust Credits", "Pay Credits"} {
		r := do(t, svc, Actor{"user", "user"}, Action{Type: "stake", IdempotencyKey: typ, ResourceType: typ, Limit: int64(i + 1), Source: "external-stake-proof", Expiry: now.Add(time.Hour)}).Record
		if r.Kind != "staking" || r.Beneficiary != "user" {
			t.Fatalf("stake %+v", r)
		}
	}
	p := do(t, svc, Actor{"owner", "user"}, Action{Type: "create_pool", IdempotencyKey: "p", ResourceType: "Bandwidth", Limit: 100, Source: "allocation:1", Expiry: now.Add(time.Hour), Fee: 1, Policy: Policy{MaxPerGrant: 50, Revocable: true}}).Pool
	confirmed := confirmPoolForAuthoritativeTest(t, svc, p.ID)
	p = &confirmed
	d := do(t, svc, Actor{"owner", "user"}, Action{Type: "delegate", IdempotencyKey: "d", PoolID: p.ID, Beneficiary: "b", Limit: 20, Expiry: now.Add(30 * time.Minute)}).Record
	if d.Kind != "delegation" {
		t.Fatal("delegation missing")
	}
	if _, err := svc.Do(Actor{"renter", "user"}, Action{Type: "rent", IdempotencyKey: "bad-rent", PoolID: p.ID, Beneficiary: "other", Limit: 10, Expiry: now.Add(20 * time.Minute)}); err == nil {
		t.Fatal("rental beneficiary substitution accepted")
	}
	rent := do(t, svc, Actor{"renter", "user"}, Action{Type: "rent", IdempotencyKey: "rent", PoolID: p.ID, Beneficiary: "renter", Limit: 10, Expiry: now.Add(20 * time.Minute)}).Record
	if rent.Kind != "rental" {
		t.Fatal("rental missing")
	}
	disputed := do(t, svc, Actor{"b", "user"}, Action{Type: "dispute", IdempotencyKey: "dispute", RecordID: d.ID, Reason: "capacity unavailable"}).Record
	if disputed.Status != "disputed" {
		t.Fatal("dispute missing")
	}
	if _, err := svc.Do(Actor{"b", "dispute_reviewer"}, Action{Type: "resolve_dispute", IdempotencyKey: "self-review", RecordID: d.ID, Decision: "upheld", Reason: "x"}); err == nil {
		t.Fatal("beneficiary reviewed own dispute")
	}
	resolved := do(t, svc, Actor{"independent", "dispute_reviewer"}, Action{Type: "resolve_dispute", IdempotencyKey: "resolve", RecordID: d.ID, Decision: "upheld", Reason: "verified capacity failure"}).Record
	if resolved.Status != "revoked" || resolved.Dispute.Reviewer != "independent" {
		t.Fatalf("resolution %+v", resolved)
	}
	view, _ := svc.View(Actor{"owner", "user"})
	if got := view["pools"].([]Pool)[0].Available; got != 90 {
		t.Fatalf("upheld dispute did not restore capacity: %d", got)
	}
	if _, err := svc.Do(Actor{"owner", "user"}, Action{Type: "update_policy", IdempotencyKey: "too-large", PoolID: p.ID, Policy: Policy{MaxPerGrant: 200}}); err == nil {
		t.Fatal("unbounded policy accepted")
	}
}

func TestAIExplicitPermissionProviderFailureAndNoAutomaticRental(t *testing.T) {
	now := time.Now().UTC()
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.RawQuery != "" {
			t.Errorf("AI prompt must use POST body, got %s %s", r.Method, r.URL.String())
		}
		var aiBody map[string]any
		if json.NewDecoder(r.Body).Decode(&aiBody) != nil || aiBody["prompt"] == "" || aiBody["outputLanguage"] != "en" {
			t.Errorf("invalid POST AI body: %+v", aiBody)
		}
		if r.Header.Get("Authorization") != "Bearer gateway-key" {
			t.Error("missing gateway authorization")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"text\":\"Option A costs two fee units; review before renting.\"}\n\n"))
	}))
	defer provider.Close()
	svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "s.json"), AIURL: provider.URL, AIKey: "gateway-key", AIModel: "provider-model", Now: func() time.Time { return now }})
	prepared := do(t, svc, Actor{"u", "user"}, Action{Type: "ai_prepare", IdempotencyKey: "p", Reason: "compare rentals", Context: []string{"balances", "prices", "rental_options"}}).AI
	if prepared.Permission || prepared.Provider != "YNX AI Gateway" {
		t.Fatalf("preview %+v", prepared)
	}
	if _, err := svc.Do(Actor{"u", "user"}, Action{Type: "ai_run", IdempotencyKey: "no", AIID: prepared.ID}); err == nil {
		t.Fatal("AI ran without permission")
	}
	run := do(t, svc, Actor{"u", "user"}, Action{Type: "ai_run", IdempotencyKey: "run", AIID: prepared.ID, Permission: true}).AI
	if run.Status != "completed" || run.Result == "" {
		t.Fatalf("run %+v", run)
	}
	view, _ := svc.View(Actor{"u", "user"})
	if len(view["records"].([]Record)) != 0 {
		t.Fatal("AI automatically created rental/stake/transfer")
	}
	u, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "u.json")})
	ua := do(t, u, Actor{"u", "user"}, Action{Type: "ai_prepare", IdempotencyKey: "p", Reason: "cost", Context: []string{"prices"}}).AI
	failed := do(t, u, Actor{"u", "user"}, Action{Type: "ai_run", IdempotencyKey: "r", AIID: ua.ID, Permission: true}).AI
	if failed.Status != "failed" || !strings.Contains(failed.Error, "unavailable") {
		t.Fatalf("provider failure hidden %+v", failed)
	}
}

func TestHTTPAuthorizationAndSecurityHeaders(t *testing.T) {
	svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "s.json"), AllowHeaderAuth: true})
	ts := httptest.NewServer(svc.Handler(http.NotFoundHandler()))
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/api/state")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 401 {
		t.Fatalf("status=%d", resp.StatusCode)
	}
	if !strings.Contains(resp.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatal("missing CSP")
	}
	body, _ := json.Marshal(Action{Type: "stake", IdempotencyKey: "h", ResourceType: "Compute", Limit: 10, Source: "proof", Expiry: time.Now().Add(time.Hour)})
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/actions", bytes.NewReader(body))
	req.Header.Set("X-YNX-Actor", "u")
	req.Header.Set("X-YNX-Role", "user")
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("http action err=%v status=%d", err, resp.StatusCode)
	}
}

func TestSessionRegistryRejectsSpoofedRoleHeaders(t *testing.T) {
	svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "s.json"), Sessions: map[string]Actor{"opaque-session": {ID: "verified", Role: "user"}}})
	ts := httptest.NewServer(svc.Handler(http.NotFoundHandler()))
	defer ts.Close()
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/state", nil)
	req.Header.Set("X-YNX-Actor", "attacker")
	req.Header.Set("X-YNX-Role", "auditor")
	resp, _ := http.DefaultClient.Do(req)
	if resp.StatusCode != 401 {
		t.Fatalf("spoofed headers status=%d", resp.StatusCode)
	}
	req, _ = http.NewRequest(http.MethodGet, ts.URL+"/api/state", nil)
	req.Header.Set("Authorization", "Bearer opaque-session")
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 200 {
		t.Fatalf("registered session status=%d", resp.StatusCode)
	}
}
