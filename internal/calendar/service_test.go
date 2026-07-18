package calendar

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type testVerifier struct{}

func (testVerifier) Verify(_ context.Context, p WalletProof) error {
	if p.Account == "" || p.Assertion == "" {
		return errors.New("invalid wallet proof")
	}
	return nil
}

func TestExportDeleteCookieAndStoreTamper(t *testing.T) {
	path := filepath.Join(t.TempDir(), "calendar.json")
	svc := newTestService(t, path)
	token, user, _ := signIn(t, svc, "@alice", "ynx1alice")
	preview, err := svc.PreviewCreate(token, input("Export", "2026-09-01T09:00", "2026-09-01T10:00", "UTC", "export-1"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.ApproveChange(token, preview.ID, false); err != nil {
		t.Fatal(err)
	}
	exported, err := svc.ExportAccount(token)
	if err != nil || exported.User.Handle != user.Handle || exported.User.AccountHash != "" || len(exported.Events) != 1 {
		t.Fatalf("Calendar export failed: %v %+v", err, exported)
	}
	if err = svc.DeleteAccount(token, "DELETE"); err == nil {
		t.Fatal("Calendar account deleted without exact confirmation")
	}
	if err = svc.DeleteAccount(token, "DELETE CALENDAR ACCOUNT"); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Account(token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("deleted Calendar session remained active: %v", err)
	}

	path2 := filepath.Join(t.TempDir(), "calendar-tamper.json")
	svc2 := newTestService(t, path2)
	_, _, _ = signIn(t, svc2, "@tamper", "ynx1tamper")
	body, err := os.ReadFile(path2)
	if err != nil {
		t.Fatal(err)
	}
	body[len(body)/2] ^= 1
	if err = os.WriteFile(path2, body, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err = NewStore(path2); err == nil {
		t.Fatal("tampered Calendar state was accepted")
	}
	if err = os.Remove(path2 + ".hmac-key"); err != nil {
		t.Fatal(err)
	}
	if _, err = NewStore(path2); err == nil || !strings.Contains(err.Error(), "key is missing") {
		t.Fatalf("missing Calendar state key did not fail closed: %v", err)
	}
}

func TestHTTPLoginUsesHttpOnlyCookieWithoutTokenBody(t *testing.T) {
	svc := newTestService(t, "")
	c, _ := svc.NewChallenge()
	proof := WalletProof{Account: "ynx1cookie", Handle: "@cookie", Product: ProductID, Scopes: []string{RequiredScope}, Challenge: c.ID, DeviceKey: "calendar-cookie-device", ExpiresAt: svc.now().Add(time.Minute).Unix(), Assertion: "verified"}
	body, _ := json.Marshal(proof)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/sessions", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	NewHandler(svc).ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated || strings.Contains(rec.Body.String(), `"token"`) {
		t.Fatalf("unsafe login response: %d %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Name != sessionCookieName {
		t.Fatalf("unsafe session cookie: %+v", cookies)
	}
}

type testAI struct{ unavailable bool }

func (a testAI) Status(context.Context) (string, string, string, error) {
	if a.unavailable {
		return "", "", "", errors.New("provider offline")
	}
	return "test-provider", "calendar-safe-model", "0.003 YNXT", nil
}
func (testAI) Generate(_ context.Context, kind string, e []Event) (string, error) {
	return kind + ": " + e[0].Title, nil
}

type blockingAI struct{ started chan struct{} }

func (blockingAI) Status(context.Context) (string, string, string, error) {
	return "test-provider", "streaming-model", "0.001 YNXT", nil
}
func (a blockingAI) Generate(ctx context.Context, _ string, _ []Event) (string, error) {
	close(a.started)
	<-ctx.Done()
	return "", ctx.Err()
}
func newTestService(t *testing.T, path string) *Service {
	t.Helper()
	store, e := NewStore(path)
	if e != nil {
		t.Fatal(e)
	}
	svc, e := NewService(store, testVerifier{}, testAI{})
	if e != nil {
		t.Fatal(e)
	}
	return svc
}
func signIn(t *testing.T, s *Service, handle, account string) (string, User, WalletProof) {
	t.Helper()
	c, e := s.NewChallenge()
	if e != nil {
		t.Fatal(e)
	}
	p := WalletProof{Account: account, Handle: handle, Product: ProductID, Scopes: []string{RequiredScope}, Challenge: c.ID, DeviceKey: "calendar-device-key", ExpiresAt: s.now().Add(time.Minute).Unix(), Assertion: "wallet-verified"}
	token, user, e := s.SignIn(context.Background(), p)
	if e != nil {
		t.Fatal(e)
	}
	return token, user, p
}
func input(title, start, end, zone, id string) EventInput {
	return EventInput{Title: title, LocalStart: start, LocalEnd: end, TimeZone: zone, ClientMutationID: id, Reminders: []Reminder{{MinutesBefore: 10, Channel: "local"}}}
}

func TestCentralWalletRequestReplayPersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "calendar.json")
	svc := newTestService(t, path)
	c, _ := svc.NewChallenge()
	central := &CentralWalletProof{AuthorizationRequest: json.RawMessage(`{"version":"1","nonce":"same"}`)}
	proof := WalletProof{Account: "ynx1central", Handle: "@central", Product: ProductID, Scopes: []string{RequiredScope}, Challenge: c.ID, DeviceKey: "calendar-device-key", ExpiresAt: svc.now().Add(time.Minute).Unix(), Assertion: "verified", Central: central}
	if _, _, e := svc.SignIn(context.Background(), proof); e != nil {
		t.Fatal(e)
	}
	restarted := newTestService(t, path)
	next, _ := restarted.NewChallenge()
	proof.Challenge = next.ID
	if _, _, e := restarted.SignIn(context.Background(), proof); e == nil || !strings.Contains(e.Error(), "replayed") {
		t.Fatalf("central request replay survived restart: %v", e)
	}
}

func TestPersistenceEventStateConflictIdempotencyAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "calendar.json")
	svc := newTestService(t, path)
	token, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	first, err := svc.PreviewCreate(token, input("Architecture", "2026-07-20T09:00", "2026-07-20T10:00", "Asia/Shanghai", "offline-1"))
	if err != nil {
		t.Fatal(err)
	}
	same, err := svc.PreviewCreate(token, input("ignored duplicate", "2026-07-20T12:00", "2026-07-20T13:00", "Asia/Shanghai", "offline-1"))
	if err != nil || same.ID != first.ID {
		t.Fatal("offline mutation was not idempotent")
	}
	event, err := svc.ApproveChange(token, first.ID, false)
	if err != nil || event.State != "scheduled" {
		t.Fatalf("create approval failed: %v %+v", err, event)
	}
	conflict, err := svc.PreviewCreate(token, input("Collision", "2026-07-20T09:30", "2026-07-20T10:30", "Asia/Shanghai", "offline-2"))
	if err != nil || len(conflict.Conflicts) != 1 {
		t.Fatalf("conflict not detected: %v %+v", err, conflict.Conflicts)
	}
	if _, err = svc.ApproveChange(token, conflict.ID, false); err == nil {
		t.Fatal("conflicting event applied without override")
	}
	if _, err = svc.ApproveChange(token, conflict.ID, true); err != nil {
		t.Fatal(err)
	}
	store2, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	svc2, err := NewService(store2, testVerifier{}, testAI{})
	if err != nil {
		t.Fatal(err)
	}
	events, err := svc2.Events(token, time.Date(2026, 7, 19, 0, 0, 0, 0, time.UTC), time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC))
	if err != nil || len(events) != 2 {
		t.Fatalf("restart persistence failed: %v %d", err, len(events))
	}
}

func TestRecurrencePreservesLocalTimeAcrossDST(t *testing.T) {
	svc := newTestService(t, "")
	token, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	in := input("Weekly standup", "2026-03-01T09:00", "2026-03-01T10:00", "America/New_York", "dst-1")
	in.Recurrence = Recurrence{Frequency: "weekly", Interval: 1, Count: 3}
	preview, err := svc.PreviewCreate(token, in)
	if err != nil {
		t.Fatal(err)
	}
	event, err := svc.ApproveChange(token, preview.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	occ := expand(event, time.Date(2026, 2, 28, 0, 0, 0, 0, time.UTC), time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC))
	if len(occ) != 3 {
		t.Fatalf("expected 3 occurrences, got %d", len(occ))
	}
	for _, o := range occ {
		if !strings.Contains(o.LocalStart, "T09:00:00") {
			t.Fatalf("local time drifted: %s", o.LocalStart)
		}
	}
	if occ[0].StartUTC.Hour() != 14 || occ[2].StartUTC.Hour() != 13 {
		t.Fatalf("DST UTC conversion incorrect: %v %v", occ[0].StartUTC, occ[2].StartUTC)
	}
}

func TestInviteRSVPShareUpdateCancelRevertAndAuthorization(t *testing.T) {
	svc := newTestService(t, "")
	alice, aliceUser, _ := signIn(t, svc, "@alice", "ynx1alice")
	bob, bobUser, _ := signIn(t, svc, "@bob", "ynx1bob")
	charlie, _, _ := signIn(t, svc, "@charlie", "ynx1charlie")
	in := input("Review", "2026-08-01T10:00", "2026-08-01T11:00", "Asia/Shanghai", "invite-1")
	in.Invitees = []string{"@bob"}
	preview, err := svc.PreviewCreate(alice, in)
	if err != nil {
		t.Fatal(err)
	}
	event, err := svc.ApproveChange(alice, preview.ID, false)
	if err != nil || event.Invites[0].State != "pending" {
		t.Fatalf("invite not approved: %v", err)
	}
	if _, err = svc.RSVP(charlie, event.ID, "accepted"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("uninvited RSVP accepted: %v", err)
	}
	event, err = svc.RSVP(bob, event.ID, "accepted")
	if err != nil || event.Invites[0].State != "accepted" {
		t.Fatal("RSVP not persisted")
	}
	if _, err = svc.Share(bob, event.ID, "@charlie", "viewer"); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("non-owner share accepted")
	}
	event, err = svc.Share(alice, event.ID, "@charlie", "editor")
	if err != nil {
		t.Fatal(err)
	}
	event, err = svc.Unshare(alice, event.ID, "@charlie")
	if err != nil || len(event.Shares) != 0 {
		t.Fatalf("share recovery failed: %v", err)
	}
	event, err = svc.Share(alice, event.ID, "@charlie", "editor")
	if err != nil {
		t.Fatal(err)
	}
	update := input("Review updated", "2026-08-01T11:00", "2026-08-01T12:00", "Asia/Shanghai", "update-1")
	update.Invitees = []string{"@bob"}
	update.BaseVersion = event.Version
	change, err := svc.PreviewUpdate(charlie, event.ID, update)
	if err != nil {
		t.Fatalf("editor update preview failed: %v", err)
	}
	updated, err := svc.ApproveChange(charlie, change.ID, false)
	if err != nil || updated.Title != "Review updated" {
		t.Fatal(err)
	}
	stale := update
	stale.ClientMutationID = "stale"
	if _, err = svc.PreviewUpdate(alice, event.ID, stale); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale update accepted: %v", err)
	}
	restored, err := svc.RevertChange(charlie, change.ID)
	if err != nil || restored.Title != "Review" {
		t.Fatalf("revert failed: %v %+v", err, restored)
	}
	cancel, err := svc.PreviewCancel(alice, event.ID, "cancel-1", restored.Version)
	if err != nil {
		t.Fatal(err)
	}
	cancelled, err := svc.ApproveChange(alice, cancel.ID, false)
	if err != nil || cancelled.State != "cancelled" {
		t.Fatal("cancel approval failed")
	}
	if aliceUser.AccountHash == "" || bobUser.AccountHash == "" {
		t.Fatal("test identity setup failed")
	}
}

func TestBoundariesRecoveryAIAndHTTPTruth(t *testing.T) {
	svc := newTestService(t, "")
	old, _, proof := signIn(t, svc, "@alice", "ynx1alice")
	if _, _, err := svc.SignIn(context.Background(), proof); err == nil {
		t.Fatal("wallet challenge replay accepted")
	}
	bad := input("Bad link", "2026-07-20T09:00", "2026-07-20T10:00", "Asia/Shanghai", "bad-link")
	bad.MeetingLink = "https://wallet.example/sign/request"
	if _, err := svc.PreviewCreate(old, bad); err == nil {
		t.Fatal("wallet authority meeting link accepted")
	}
	bad = input("Bad zone", "2026-07-20T09:00", "2026-07-20T10:00", "Mars/Olympus", "bad-zone")
	if _, err := svc.PreviewCreate(old, bad); err == nil {
		t.Fatal("unknown time zone accepted")
	}
	bad = input("Unknown invite", "2026-07-20T09:00", "2026-07-20T10:00", "UTC", "unknown-invite")
	bad.Invitees = []string{"@ghost"}
	if _, err := svc.PreviewCreate(old, bad); err == nil {
		t.Fatal("unknown YNX invitee accepted")
	}
	good, err := svc.PreviewCreate(old, input("AI context", "2026-07-20T12:00", "2026-07-20T13:00", "UTC", "ai-event"))
	if err != nil {
		t.Fatal(err)
	}
	event, err := svc.ApproveChange(old, good.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	job, err := svc.BeginAI(context.Background(), old, "draft_agenda", []string{event.ID})
	if err != nil || job.State != "preview" {
		t.Fatal(err)
	}
	job, err = svc.ApproveAI(context.Background(), old, job.ID)
	if err != nil || job.State != "review" {
		t.Fatal(err)
	}
	job, err = svc.ReviewAI(old, job.ID, "apply")
	if err != nil || job.State != "applied" {
		t.Fatal(err)
	}
	unchanged, err := svc.Event(old, event.ID)
	if err != nil || unchanged.Version != event.Version {
		t.Fatal("AI silently mutated calendar")
	}
	c, _ := svc.NewChallenge()
	rp := WalletProof{Account: "ynx1alice", Handle: "@alice", Product: ProductID, Scopes: []string{RecoveryScope}, Challenge: c.ID, DeviceKey: "calendar-new-device", ExpiresAt: svc.now().Add(time.Minute).Unix(), Assertion: "wallet-recovery"}
	fresh, user, err := svc.Recover(context.Background(), rp)
	if err != nil || user.RecoveredAt.IsZero() {
		t.Fatal(err)
	}
	if _, err = svc.Events(old, time.Now(), time.Now().Add(time.Hour)); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("recovery did not revoke old session")
	}
	if _, err = svc.Events(fresh, time.Now(), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	h := NewHandler(svc)
	health := httptest.NewRecorder()
	h.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/v1/health", nil))
	if health.Code != 200 || !strings.Contains(health.Body.String(), `"production_scheduling":false`) {
		t.Fatalf("truth boundary missing: %s", health.Body.String())
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/events/preview", strings.NewReader(`{"title":"x","unknown":true}`))
	req.Header.Set("Authorization", "Bearer "+fresh)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 400 {
		t.Fatal("strict request parsing missing")
	}
}

func TestAIProviderFailureIsHonest(t *testing.T) {
	store, _ := NewStore("")
	svc, _ := NewService(store, testVerifier{}, testAI{unavailable: true})
	token, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	p, _ := svc.PreviewCreate(token, input("Context", "2026-07-20T12:00", "2026-07-20T13:00", "UTC", "provider"))
	event, _ := svc.ApproveChange(token, p.ID, false)
	if _, err := svc.BeginAI(context.Background(), token, "propose_times", []string{event.ID}); err == nil || !strings.Contains(err.Error(), "provider offline") {
		t.Fatalf("provider failure hidden: %v", err)
	}
}

func TestReminderRestartRecoveryAndAICancel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "reminders.json")
	svc := newTestService(t, path)
	token, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	in := input("Reminder proof", "2026-09-01T10:00", "2026-09-01T11:00", "UTC", "reminder-1")
	in.Reminders = []Reminder{{MinutesBefore: 10, Channel: "local"}}
	preview, _ := svc.PreviewCreate(token, in)
	event, err := svc.ApproveChange(token, preview.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	due := event.StartUTC.Add(-10*time.Minute + 30*time.Second)
	deliveries, err := svc.ProcessReminders(due)
	if err != nil || len(deliveries) != 1 || deliveries[0].State != "delivered" {
		t.Fatalf("reminder not delivered: %v %+v", err, deliveries)
	}
	store2, _ := NewStore(path)
	svc2, _ := NewService(store2, testVerifier{}, testAI{})
	again, err := svc2.ProcessReminders(due.Add(time.Minute))
	if err != nil || len(again) != 0 {
		t.Fatal("reminder duplicated after restart")
	}
	notifications, err := svc2.Notifications(token)
	if err != nil || len(notifications) != 1 {
		t.Fatal("reminder state did not survive restart")
	}
	store, _ := NewStore("")
	blocked := blockingAI{started: make(chan struct{})}
	aiSvc, _ := NewService(store, testVerifier{}, blocked)
	owner, _, _ := signIn(t, aiSvc, "@owner", "ynx1owner")
	p, _ := aiSvc.PreviewCreate(owner, input("Cancel AI", "2026-09-01T10:00", "2026-09-01T11:00", "UTC", "cancel-ai"))
	e, _ := aiSvc.ApproveChange(owner, p.ID, false)
	job, _ := aiSvc.BeginAI(context.Background(), owner, "draft_agenda", []string{e.ID})
	done := make(chan struct{})
	go func() { _, _ = aiSvc.ApproveAI(context.Background(), owner, job.ID); close(done) }()
	<-blocked.started
	cancelled, err := aiSvc.ReviewAI(owner, job.ID, "cancel")
	if err != nil || cancelled.State != "cancelled" {
		t.Fatal("calendar AI cancel failed")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("calendar AI context not cancelled")
	}
	final, _ := aiSvc.AIJob(owner, job.ID)
	if final.State != "cancelled" {
		t.Fatal("late AI result overwrote cancellation")
	}
}
