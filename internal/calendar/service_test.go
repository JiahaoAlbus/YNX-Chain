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

func TestEventProductFieldsRoundTripAndRejectUnsafeAttachments(t *testing.T) {
	svc := newTestService(t, "")
	token, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	in := input("Launch plan", "2026-09-01T00:00", "2026-09-02T00:00", "Asia/Shanghai", "product-fields-1")
	in.Location = "Singapore · Room 6423"
	in.AllDay = true
	in.CalendarID = "team"
	in.Color = "violet"
	in.Privacy = "participants"
	in.AttachmentLinks = []string{"https://cloud.ynxweb4.com/files/calendar-plan"}
	preview, err := svc.PreviewCreate(token, in)
	if err != nil {
		t.Fatal(err)
	}
	event, err := svc.ApproveChange(token, preview.ID, false)
	if err != nil || !event.AllDay || event.Location != in.Location || event.CalendarID != "team" || event.Color != "violet" || event.Privacy != "participants" || len(event.AttachmentLinks) != 1 {
		t.Fatalf("event product fields did not round-trip: %v %+v", err, event)
	}

	bad := input("Unsafe attachment", "2026-09-03T09:00", "2026-09-03T10:00", "UTC", "product-fields-unsafe")
	bad.AttachmentLinks = []string{"https://wallet.example/sign/approval"}
	if _, err = svc.PreviewCreate(token, bad); err == nil {
		t.Fatal("wallet authority attachment was accepted")
	}
}

func TestLegacyRecurrenceLineageNormalizesOnRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "calendar.json")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	legacy := Event{ID: "legacy-event", Recurrence: Recurrence{Frequency: "daily", Interval: 1, Count: 2}}
	legacyBefore := legacy
	if err = store.update(func(st *State) error {
		st.Events[legacy.ID] = legacy
		st.Changes["legacy-change"] = ChangePreview{ID: "legacy-change", EventID: legacy.ID, Before: &legacyBefore, After: legacy, RelatedAfter: []Event{legacy}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = reloaded.view(func(st State) error {
		event := st.Events[legacy.ID]
		change := st.Changes["legacy-change"]
		if event.SeriesID != legacy.ID || event.Recurrence.SchemaVersion != 1 {
			t.Fatalf("legacy event was not normalized: %+v", event)
		}
		if change.Before == nil || change.Before.SeriesID != legacy.ID || change.After.SeriesID != legacy.ID || change.RelatedAfter[0].SeriesID != legacy.ID {
			t.Fatalf("legacy change lineage was not normalized: %+v", change)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
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

func TestVersionedRecurrenceRulesAndSingleOccurrenceExceptions(t *testing.T) {
	svc := newTestService(t, "")
	weeklyInput := input("Distributed review", "2026-03-01T09:00", "2026-03-01T10:00", "America/New_York", "recurrence-weekly")
	weeklyInput.Recurrence = Recurrence{
		Frequency: "weekly",
		Interval:  1,
		Count:     5,
		ByDay:     []string{"we", "mo"},
		Exceptions: []RecurrenceException{
			{RecurrenceID: "2026-03-04T09:00", State: "cancelled"},
			{RecurrenceID: "2026-03-09T09:00", State: "modified", LocalStart: "2026-03-09T11:00", LocalEnd: "2026-03-09T12:00", Title: "Moved review"},
		},
	}
	weekly, err := svc.eventFromInput(User{ID: "alice", Handle: "@alice"}, weeklyInput)
	if err != nil {
		t.Fatal(err)
	}
	if weekly.Recurrence.SchemaVersion != 1 || strings.Join(weekly.Recurrence.ByDay, ",") != "MO,WE" {
		t.Fatalf("recurrence was not normalized: %+v", weekly.Recurrence)
	}
	occurrences := expand(weekly, time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC))
	if len(occurrences) != 4 {
		t.Fatalf("expected one cancellation across five generated occurrences, got %d", len(occurrences))
	}
	if !strings.Contains(occurrences[0].LocalStart, "2026-03-02T09:00:00") || !strings.Contains(occurrences[1].LocalStart, "2026-03-09T11:00:00") || occurrences[1].Title != "Moved review" {
		t.Fatalf("weekly exception expansion is incorrect: %+v", occurrences)
	}
	if occurrences[0].StartUTC.Hour() != 14 || occurrences[1].StartUTC.Hour() != 15 {
		t.Fatalf("weekly DST conversion is incorrect: %v %v", occurrences[0].StartUTC, occurrences[1].StartUTC)
	}

	monthlyInput := input("Month end", "2026-01-31T09:00", "2026-01-31T10:00", "UTC", "recurrence-monthly")
	monthlyInput.Recurrence = Recurrence{SchemaVersion: 1, Frequency: "monthly", Interval: 1, Count: 3, ByMonthDay: []int{31}}
	monthly, err := svc.eventFromInput(User{ID: "alice", Handle: "@alice"}, monthlyInput)
	if err != nil {
		t.Fatal(err)
	}
	monthOccurrences := expand(monthly, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	if len(monthOccurrences) != 3 || monthOccurrences[0].StartUTC.Month() != time.January || monthOccurrences[1].StartUTC.Month() != time.March || monthOccurrences[2].StartUTC.Month() != time.May {
		t.Fatalf("invalid month-end dates were not skipped safely: %+v", monthOccurrences)
	}

	yearlyInput := input("Leap review", "2024-02-29T09:00", "2024-02-29T10:00", "UTC", "recurrence-yearly")
	yearlyInput.Recurrence = Recurrence{SchemaVersion: 1, Frequency: "yearly", Interval: 1, Count: 3}
	yearly, err := svc.eventFromInput(User{ID: "alice", Handle: "@alice"}, yearlyInput)
	if err != nil {
		t.Fatal(err)
	}
	yearOccurrences := expand(yearly, time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2033, 1, 1, 0, 0, 0, 0, time.UTC))
	if len(yearOccurrences) != 3 || yearOccurrences[0].StartUTC.Year() != 2024 || yearOccurrences[1].StartUTC.Year() != 2028 || yearOccurrences[2].StartUTC.Year() != 2032 {
		t.Fatalf("yearly leap-day expansion is incorrect: %+v", yearOccurrences)
	}

	invalid := input("Invalid", "2026-03-01T09:00", "2026-03-01T10:00", "UTC", "recurrence-invalid")
	invalid.Recurrence = Recurrence{SchemaVersion: 2, Frequency: "daily", Interval: 1, Count: 2}
	if _, err = svc.eventFromInput(User{ID: "alice", Handle: "@alice"}, invalid); err == nil || !strings.Contains(err.Error(), "schema version") {
		t.Fatalf("unsupported recurrence schema did not fail closed: %v", err)
	}
}

func TestRecurrenceMutationScopesAreAtomicReplayableAndRecoverable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "calendar.json")
	svc := newTestService(t, path)
	token, _, _ := signIn(t, svc, "@alice", "ynx1alice")

	createInput := input("Daily review", "2026-10-01T09:00", "2026-10-01T10:00", "UTC", "recurrence-scope-create")
	createInput.Recurrence = Recurrence{SchemaVersion: 1, Frequency: "daily", Interval: 1, Count: 5}
	create, err := svc.PreviewCreate(token, createInput)
	if err != nil {
		t.Fatal(err)
	}
	event, err := svc.ApproveChange(token, create.ID, false)
	if err != nil || event.SeriesID != event.ID || event.Version != 1 {
		t.Fatalf("recurring event creation failed: %v %+v", err, event)
	}

	modifyInput := RecurrenceMutationInput{
		Scope:            "occurrence",
		RecurrenceID:     "2026-10-02T09:00",
		Action:           "modify",
		LocalStart:       "2026-10-02T11:00",
		LocalEnd:         "2026-10-02T12:00",
		Title:            "Moved review",
		ClientMutationID: "recurrence-occurrence-1",
		BaseVersion:      event.Version,
	}
	modify, err := svc.PreviewRecurrenceChange(token, event.ID, modifyInput)
	if err != nil || modify.Scope != "occurrence" || modify.RecurrenceID != modifyInput.RecurrenceID {
		t.Fatalf("occurrence preview failed: %v %+v", err, modify)
	}
	replay, err := svc.PreviewRecurrenceChange(token, event.ID, modifyInput)
	if err != nil || replay.ID != modify.ID {
		t.Fatalf("occurrence mutation replay was not idempotent: %v %+v", err, replay)
	}
	event, err = svc.ApproveChange(token, modify.ID, false)
	if err != nil || event.Version != 2 || len(event.Recurrence.Exceptions) != 1 {
		t.Fatalf("occurrence approval failed: %v %+v", err, event)
	}
	occurrences, err := svc.Events(token, time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC))
	if err != nil || len(occurrences) != 5 || occurrences[1].Title != "Moved review" || occurrences[1].StartUTC.Hour() != 11 {
		t.Fatalf("modified occurrence expansion failed: %v %+v", err, occurrences)
	}

	svc = newTestService(t, path)
	persisted, err := svc.Event(token, event.ID)
	if err != nil || len(persisted.Recurrence.Exceptions) != 1 || persisted.SeriesID != event.ID {
		t.Fatalf("occurrence mutation did not survive restart: %v %+v", err, persisted)
	}
	restored, err := svc.RevertChange(token, modify.ID)
	if err != nil || restored.Version != 3 || len(restored.Recurrence.Exceptions) != 0 {
		t.Fatalf("occurrence rollback failed: %v %+v", err, restored)
	}

	futureInput := input("Future review", "2026-10-03T10:00", "2026-10-03T11:00", "UTC", "ignored-nested-id")
	futureInput.Recurrence = Recurrence{SchemaVersion: 1, Frequency: "daily", Interval: 1, Count: 3}
	firstSplit := RecurrenceMutationInput{Scope: "this_and_following", RecurrenceID: "2026-10-01T09:00", Action: "update", Series: &futureInput, ClientMutationID: "split-first", BaseVersion: restored.Version}
	if _, err = svc.PreviewRecurrenceChange(token, event.ID, firstSplit); err == nil || !strings.Contains(err.Error(), "entire_series") {
		t.Fatalf("first-occurrence split did not fail closed: %v", err)
	}

	splitInput := RecurrenceMutationInput{Scope: "this_and_following", RecurrenceID: "2026-10-03T09:00", Action: "update", Series: &futureInput, ClientMutationID: "recurrence-split-1", BaseVersion: restored.Version}
	split, err := svc.PreviewRecurrenceChange(token, event.ID, splitInput)
	if err != nil || split.Scope != "this_and_following" || len(split.RelatedAfter) != 1 || split.After.Recurrence.Count != 2 {
		t.Fatalf("this-and-following preview failed: %v %+v", err, split)
	}
	splitReplay, err := svc.PreviewRecurrenceChange(token, event.ID, splitInput)
	if err != nil || splitReplay.ID != split.ID || splitReplay.RelatedAfter[0].ID != split.RelatedAfter[0].ID {
		t.Fatalf("split replay was not stable: %v %+v", err, splitReplay)
	}
	futureID := split.RelatedAfter[0].ID
	if err = svc.store.update(func(st *State) error {
		st.Events[futureID] = Event{ID: futureID, Version: 99, State: "scheduled"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.ApproveChange(token, split.ID, false); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("derived event collision did not fail atomically: %v", err)
	}
	unchanged, err := svc.Event(token, event.ID)
	if err != nil || unchanged.Version != restored.Version || unchanged.Recurrence.Count != 5 {
		t.Fatalf("failed split approval partially truncated the original: %v %+v", err, unchanged)
	}
	if err = svc.store.update(func(st *State) error {
		delete(st.Events, futureID)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	truncated, err := svc.ApproveChange(token, split.ID, false)
	if err != nil || truncated.Version != 4 || truncated.Recurrence.Count != 2 {
		t.Fatalf("split approval failed: %v %+v", err, truncated)
	}
	futureEvent, err := svc.Event(token, futureID)
	if err != nil || futureEvent.SeriesID != event.ID || futureEvent.ParentEventID != event.ID || futureEvent.SplitFromRecurrenceID != splitInput.RecurrenceID || futureEvent.Version != 1 {
		t.Fatalf("derived future series lineage failed: %v %+v", err, futureEvent)
	}
	occurrences, err = svc.Events(token, time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC))
	if err != nil || len(occurrences) != 5 || occurrences[1].StartUTC.Hour() != 9 || occurrences[2].StartUTC.Hour() != 10 || occurrences[2].EventID != futureID {
		t.Fatalf("split occurrence expansion failed: %v %+v", err, occurrences)
	}

	svc = newTestService(t, path)
	restored, err = svc.RevertChange(token, split.ID)
	if err != nil || restored.Version != 5 || restored.Recurrence.Count != 5 {
		t.Fatalf("split rollback failed after restart: %v %+v", err, restored)
	}
	if _, err = svc.Event(token, futureID); err == nil {
		t.Fatal("derived future series survived rollback")
	}
	occurrences, err = svc.Events(token, time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC))
	if err != nil || len(occurrences) != 5 || occurrences[2].StartUTC.Hour() != 9 {
		t.Fatalf("original series was not restored deterministically: %v %+v", err, occurrences)
	}

	entireInput := input("All reviews moved", "2026-10-01T08:00", "2026-10-01T09:00", "UTC", "ignored-entire-id")
	entireInput.Recurrence = Recurrence{SchemaVersion: 1, Frequency: "daily", Interval: 1, Count: 5}
	entireMutation := RecurrenceMutationInput{Scope: "entire_series", Action: "update", Series: &entireInput, ClientMutationID: "recurrence-entire-1", BaseVersion: restored.Version}
	entire, err := svc.PreviewRecurrenceChange(token, event.ID, entireMutation)
	if err != nil || entire.Scope != "entire_series" || entire.After.Title != "All reviews moved" {
		t.Fatalf("entire-series preview failed: %v %+v", err, entire)
	}
	updated, err := svc.ApproveChange(token, entire.ID, false)
	if err != nil || updated.Version != 6 || updated.StartUTC.Hour() != 8 || updated.SeriesID != event.ID {
		t.Fatalf("entire-series approval failed: %v %+v", err, updated)
	}
	stale := modifyInput
	stale.ClientMutationID = "recurrence-stale"
	stale.RecurrenceID = "2026-10-02T08:00"
	stale.BaseVersion = restored.Version
	if _, err = svc.PreviewRecurrenceChange(token, event.ID, stale); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale recurrence mutation was accepted: %v", err)
	}

	httpInput := RecurrenceMutationInput{Scope: "occurrence", RecurrenceID: "2026-10-04T08:00", Action: "cancel", ClientMutationID: "recurrence-http-1", BaseVersion: updated.Version}
	body, _ := json.Marshal(httpInput)
	req := httptest.NewRequest(http.MethodPost, "/v1/events/"+event.ID+"/recurrence-preview", strings.NewReader(string(body)))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	NewHandler(svc).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"scope":"occurrence"`) || !strings.Contains(rec.Body.String(), `"recurrence_id":"2026-10-04T08:00"`) {
		t.Fatalf("recurrence HTTP preview failed: %d %s", rec.Code, rec.Body.String())
	}
}

func TestRecurrenceMutationPermissionBoundaries(t *testing.T) {
	svc := newTestService(t, "")
	alice, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	bob, _, _ := signIn(t, svc, "@bob", "ynx1bob")
	in := input("Shared series", "2026-11-01T09:00", "2026-11-01T10:00", "UTC", "shared-series-create")
	in.Recurrence = Recurrence{SchemaVersion: 1, Frequency: "daily", Interval: 1, Count: 3}
	preview, err := svc.PreviewCreate(alice, in)
	if err != nil {
		t.Fatal(err)
	}
	event, err := svc.ApproveChange(alice, preview.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	event, err = svc.Share(alice, event.ID, "@bob", "editor")
	if err != nil {
		t.Fatal(err)
	}
	modify := RecurrenceMutationInput{Scope: "occurrence", RecurrenceID: "2026-11-02T09:00", Action: "modify", LocalStart: "2026-11-02T11:00", LocalEnd: "2026-11-02T12:00", ClientMutationID: "editor-occurrence", BaseVersion: event.Version}
	if _, err = svc.PreviewRecurrenceChange(bob, event.ID, modify); err != nil {
		t.Fatalf("shared editor could not preview an occurrence modification: %v", err)
	}
	cancel := RecurrenceMutationInput{Scope: "occurrence", RecurrenceID: "2026-11-02T09:00", Action: "cancel", ClientMutationID: "editor-cancel", BaseVersion: event.Version}
	if _, err = svc.PreviewRecurrenceChange(bob, event.ID, cancel); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("shared editor cancelled an occurrence: %v", err)
	}
}

func TestThisAndFollowingTruncatesUntilAtPreviousDSTOccurrence(t *testing.T) {
	svc := newTestService(t, "")
	token, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	in := input("DST weekly", "2026-03-01T09:00", "2026-03-01T10:00", "America/New_York", "dst-until-create")
	in.Recurrence = Recurrence{SchemaVersion: 1, Frequency: "weekly", Interval: 1, Until: time.Date(2026, 4, 1, 9, 0, 0, 0, loc)}
	preview, err := svc.PreviewCreate(token, in)
	if err != nil {
		t.Fatal(err)
	}
	event, err := svc.ApproveChange(token, preview.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	future := input("DST future", "2026-03-15T10:00", "2026-03-15T11:00", "America/New_York", "ignored-dst-future")
	future.Recurrence = Recurrence{SchemaVersion: 1, Frequency: "weekly", Interval: 1, Count: 3}
	change, err := svc.PreviewRecurrenceChange(token, event.ID, RecurrenceMutationInput{Scope: "this_and_following", RecurrenceID: "2026-03-15T09:00", Action: "update", Series: &future, ClientMutationID: "dst-until-split", BaseVersion: event.Version})
	if err != nil {
		t.Fatal(err)
	}
	if change.After.Recurrence.Count != 0 || change.After.Recurrence.Until.In(loc).Format(recurrenceLocalLayout) != "2026-03-08T09:00" {
		t.Fatalf("until recurrence was not truncated at the previous local occurrence: %+v", change.After.Recurrence)
	}
	if _, err = svc.ApproveChange(token, change.ID, false); err != nil {
		t.Fatal(err)
	}
	occurrences, err := svc.Events(token, time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC))
	if err != nil || len(occurrences) != 5 {
		t.Fatalf("until split occurrence count failed: %v %+v", err, occurrences)
	}
	if occurrences[0].StartUTC.Hour() != 14 || occurrences[1].StartUTC.Hour() != 13 || !strings.Contains(occurrences[2].LocalStart, "2026-03-15T10:00:00") {
		t.Fatalf("until split DST wall time failed: %+v", occurrences)
	}
}

func TestOccurrenceCancellationDoesNotRequireUnrelatedConflictOverride(t *testing.T) {
	svc := newTestService(t, "")
	token, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	recurringInput := input("Recurring", "2026-12-01T09:00", "2026-12-01T10:00", "UTC", "cancel-conflict-recurring")
	recurringInput.Recurrence = Recurrence{SchemaVersion: 1, Frequency: "daily", Interval: 1, Count: 2}
	recurringPreview, err := svc.PreviewCreate(token, recurringInput)
	if err != nil {
		t.Fatal(err)
	}
	recurring, err := svc.ApproveChange(token, recurringPreview.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	collisionPreview, err := svc.PreviewCreate(token, input("Collision", "2026-12-02T09:30", "2026-12-02T10:30", "UTC", "cancel-conflict-collision"))
	if err != nil || len(collisionPreview.Conflicts) != 1 {
		t.Fatalf("expected collision preview: %v %+v", err, collisionPreview.Conflicts)
	}
	if _, err = svc.ApproveChange(token, collisionPreview.ID, true); err != nil {
		t.Fatal(err)
	}
	cancel, err := svc.PreviewRecurrenceChange(token, recurring.ID, RecurrenceMutationInput{Scope: "occurrence", RecurrenceID: "2026-12-02T09:00", Action: "cancel", ClientMutationID: "cancel-conflict-occurrence", BaseVersion: recurring.Version})
	if err != nil || len(cancel.Conflicts) != 0 {
		t.Fatalf("occurrence cancellation inherited unrelated conflicts: %v %+v", err, cancel.Conflicts)
	}
	if _, err = svc.ApproveChange(token, cancel.ID, false); err != nil {
		t.Fatalf("occurrence cancellation required an override: %v", err)
	}
	occurrences, err := svc.Events(token, time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 12, 4, 0, 0, 0, 0, time.UTC))
	if err != nil || len(occurrences) != 2 {
		t.Fatalf("cancelled occurrence was not removed: %v %+v", err, occurrences)
	}
}

func TestSharedCalendarLifecycleAndRoles(t *testing.T) {
	svc := newTestService(t, "")
	alice, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	bob, _, _ := signIn(t, svc, "@bob", "ynx1bob")
	calendar, err := svc.CreateCalendar(alice, "Protocol team", "violet")
	if err != nil || calendar.OwnerHandle != "@alice" || calendar.Version != 1 {
		t.Fatalf("shared calendar not created: %#v %v", calendar, err)
	}
	if _, err = svc.ShareCalendar(alice, calendar.ID, "@missing", "viewer"); err == nil {
		t.Fatal("unknown shared-calendar contact accepted")
	}
	calendar, err = svc.ShareCalendar(alice, calendar.ID, "@bob", "viewer")
	if err != nil || len(calendar.Shares) != 1 || calendar.Shares[0].Role != "viewer" {
		t.Fatalf("viewer permission not persisted: %#v %v", calendar, err)
	}
	in := input("Shared protocol review", "2026-08-20T10:00", "2026-08-20T11:00", "UTC", "shared-calendar-event")
	in.CalendarID = calendar.ID
	preview, err := svc.PreviewCreate(alice, in)
	if err != nil {
		t.Fatal(err)
	}
	event, err := svc.ApproveChange(alice, preview.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Event(bob, event.ID); err != nil {
		t.Fatalf("viewer could not read shared-calendar event: %v", err)
	}
	update := in
	update.Title = "Viewer must not edit"
	update.ClientMutationID = "shared-viewer-edit"
	update.BaseVersion = event.Version
	if _, err = svc.PreviewUpdate(bob, event.ID, update); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("viewer edited shared-calendar event: %v", err)
	}
	calendar, err = svc.ShareCalendar(alice, calendar.ID, "@bob", "editor")
	if err != nil || calendar.Shares[0].Role != "editor" {
		t.Fatal("editor permission change failed")
	}
	update.Title = "Editor-reviewed shared event"
	update.ClientMutationID = "shared-editor-edit"
	change, err := svc.PreviewUpdate(bob, event.ID, update)
	if err != nil {
		t.Fatalf("editor update preview failed: %v", err)
	}
	if _, err = svc.ApproveChange(bob, change.ID, false); err != nil {
		t.Fatalf("editor update approval failed: %v", err)
	}
	calendar, err = svc.ShareCalendar(alice, calendar.ID, "@bob", "availability")
	if err != nil || calendar.Shares[0].Role != "availability" {
		t.Fatal("availability permission change failed")
	}
	busy, err := svc.Event(bob, event.ID)
	if err != nil || busy.Title != "Busy" || busy.Location != "" || busy.OwnerHandle != "" || len(busy.Comments) != 0 {
		t.Fatalf("availability view leaked event details: %#v %v", busy, err)
	}
	if _, err = svc.AddComment(bob, event.ID, "Must remain blocked"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("availability-only member commented: %v", err)
	}
	exported, err := svc.ExportAccount(bob)
	if err != nil || len(exported.Events) != 1 || exported.Events[0].Title != "Busy" || exported.Events[0].Description != "" {
		t.Fatalf("availability export leaked event details: %#v %v", exported.Events, err)
	}
	if _, err = svc.UnshareCalendar(alice, calendar.ID, "@bob"); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Event(bob, event.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("revoked viewer retained shared-calendar access: %v", err)
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
	event, err = svc.AddComment(bob, event.ID, "I will bring the reviewed agenda.")
	if err != nil || len(event.Comments) != 1 || event.Comments[0].Author != "@bob" {
		t.Fatalf("participant comment not persisted: %v", err)
	}
	if _, err = svc.AddComment(charlie, event.ID, "Editor note"); err != nil {
		t.Fatalf("shared editor could not comment: %v", err)
	}
	if _, err = svc.AddComment(bob, event.ID, strings.Repeat("x", 1001)); err == nil {
		t.Fatal("oversized comment accepted")
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

func TestActivityNotificationsCoverInviteRSVPCommentReadAndAvailabilityPrivacy(t *testing.T) {
	svc := newTestService(t, "")
	alice, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	bob, _, _ := signIn(t, svc, "@bob", "ynx1bob")
	carol, _, _ := signIn(t, svc, "@carol", "ynx1carol")

	in := input("Private acquisition planning", "2026-10-01T09:00", "2026-10-01T10:00", "UTC", "notification-create")
	in.Invitees = []string{"@bob"}
	preview, err := svc.PreviewCreate(alice, in)
	if err != nil {
		t.Fatal(err)
	}
	event, err := svc.ApproveChange(alice, preview.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	bobNotifications, err := svc.ActivityNotifications(bob)
	if err != nil || len(bobNotifications) != 1 || bobNotifications[0].Kind != "event_create" || bobNotifications[0].Body != in.Title {
		t.Fatalf("invite notification missing: %v %+v", err, bobNotifications)
	}

	if _, err = svc.RSVP(bob, event.ID, "accepted"); err != nil {
		t.Fatal(err)
	}
	aliceNotifications, err := svc.ActivityNotifications(alice)
	if err != nil || len(aliceNotifications) != 1 || aliceNotifications[0].Kind != "event_rsvp" {
		t.Fatalf("RSVP notification missing: %v %+v", err, aliceNotifications)
	}
	if _, err = svc.AddComment(bob, event.ID, "Reviewed and accepted."); err != nil {
		t.Fatal(err)
	}
	aliceNotifications, _ = svc.ActivityNotifications(alice)
	if len(aliceNotifications) != 2 || aliceNotifications[0].Kind != "event_comment" {
		t.Fatalf("comment notification missing: %+v", aliceNotifications)
	}
	count, err := svc.MarkNotificationsRead(alice)
	if err != nil || count != 2 {
		t.Fatalf("mark read failed: count=%d err=%v", count, err)
	}
	aliceNotifications, _ = svc.ActivityNotifications(alice)
	for _, notification := range aliceNotifications {
		if notification.State != "read" || notification.ReadAt.IsZero() {
			t.Fatalf("notification remained unread: %+v", notification)
		}
	}

	calendar, err := svc.CreateCalendar(alice, "Executive private calendar", "blue")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.ShareCalendar(alice, calendar.ID, "@carol", "availability"); err != nil {
		t.Fatal(err)
	}
	carolNotifications, err := svc.ActivityNotifications(carol)
	if err != nil || len(carolNotifications) != 1 {
		t.Fatalf("availability notification missing: %v %+v", err, carolNotifications)
	}
	encoded, _ := json.Marshal(carolNotifications[0])
	if strings.Contains(string(encoded), calendar.Name) || strings.Contains(string(encoded), in.Title) {
		t.Fatalf("availability-only notification leaked private details: %s", encoded)
	}
	if _, err = svc.UnshareCalendar(alice, calendar.ID, "@carol"); err != nil {
		t.Fatal(err)
	}
	carolNotifications, _ = svc.ActivityNotifications(carol)
	if len(carolNotifications) != 2 || carolNotifications[0].Kind != "calendar_permission_revoked" {
		t.Fatalf("revocation notification missing: %+v", carolNotifications)
	}
}

func TestAuthorizedAttendeeAvailabilityAndTravelBuffersStayPrivate(t *testing.T) {
	svc := newTestService(t, "")
	alice, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	bob, _, _ := signIn(t, svc, "@bob", "ynx1bob")

	privatePreview, err := svc.PreviewCreate(bob, input("Unshared private appointment", "2026-11-01T09:00", "2026-11-01T10:00", "UTC", "bob-private"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.ApproveChange(bob, privatePreview.ID, false); err != nil {
		t.Fatal(err)
	}
	unauthorized := input("Proposed meeting", "2026-11-01T09:15", "2026-11-01T09:45", "UTC", "alice-no-availability")
	unauthorized.Invitees = []string{"@bob"}
	unauthorizedPreview, err := svc.PreviewCreate(alice, unauthorized)
	if err != nil || len(unauthorizedPreview.Conflicts) != 0 {
		t.Fatalf("unshared attendee availability was exposed: %v %+v", err, unauthorizedPreview.Conflicts)
	}

	calendar, err := svc.CreateCalendar(bob, "Bob availability source", "slate")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.ShareCalendar(bob, calendar.ID, "@alice", "availability"); err != nil {
		t.Fatal(err)
	}
	busyInput := input("Confidential medical appointment", "2026-11-01T11:00", "2026-11-01T12:00", "UTC", "bob-shared-busy")
	busyInput.CalendarID = calendar.ID
	busyPreview, err := svc.PreviewCreate(bob, busyInput)
	if err != nil {
		t.Fatal(err)
	}
	busyEvent, err := svc.ApproveChange(bob, busyPreview.ID, false)
	if err != nil {
		t.Fatal(err)
	}

	buffered := input("Travel-aware meeting", "2026-11-01T10:15", "2026-11-01T10:30", "UTC", "alice-buffered")
	buffered.Invitees = []string{"@bob"}
	buffered.BufferAfterMinutes = 45
	bufferPreview, err := svc.PreviewCreate(alice, buffered)
	if err != nil || len(bufferPreview.Conflicts) != 1 {
		t.Fatalf("authorized buffer conflict missing: %v %+v", err, bufferPreview.Conflicts)
	}
	conflict := bufferPreview.Conflicts[0]
	if conflict.Kind != "buffer" || conflict.Title != "Busy" || conflict.EventID != "" || conflict.ParticipantHandle != "@bob" {
		t.Fatalf("attendee conflict leaked private details or lost provenance: %+v", conflict)
	}
	encoded, _ := json.Marshal(conflict)
	if strings.Contains(string(encoded), busyInput.Title) || strings.Contains(string(encoded), busyEvent.ID) {
		t.Fatalf("availability conflict leaked event identity: %s", encoded)
	}
	if len(bufferPreview.SuggestedSlots) == 0 || bufferPreview.SuggestedSlots[0].Reason == "" {
		t.Fatalf("conflict-free draft alternatives were not generated: %+v", bufferPreview.SuggestedSlots)
	}
	approved, err := svc.ApproveChange(alice, bufferPreview.ID, true)
	if err != nil || approved.StartUTC != bufferPreview.After.StartUTC {
		t.Fatalf("suggestions moved an event without user editing and approval: %v %+v", err, approved)
	}

	overlap := input("Direct overlap", "2026-11-01T11:15", "2026-11-01T11:45", "UTC", "alice-overlap")
	overlap.Invitees = []string{"@bob"}
	overlapPreview, err := svc.PreviewCreate(alice, overlap)
	if err != nil || len(overlapPreview.Conflicts) != 1 || overlapPreview.Conflicts[0].Kind != "overlap" {
		t.Fatalf("authorized attendee overlap missing: %v %+v", err, overlapPreview.Conflicts)
	}

	invalid := input("Invalid buffer", "2026-11-02T09:00", "2026-11-02T10:00", "UTC", "invalid-buffer")
	invalid.BufferBeforeMinutes = 241
	if _, err = svc.PreviewCreate(alice, invalid); err == nil {
		t.Fatal("out-of-bound preparation buffer was accepted")
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
	if requestID := health.Header().Get("X-Request-ID"); !strings.HasPrefix(requestID, "cal_") {
		t.Fatalf("bounded request ID missing: %q", requestID)
	}
	preservedID := httptest.NewRecorder()
	preservedRequest := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	preservedRequest.Header.Set("X-Request-ID", "calendar-client-request-0001")
	h.ServeHTTP(preservedID, preservedRequest)
	if got := preservedID.Header().Get("X-Request-ID"); got != "calendar-client-request-0001" {
		t.Fatalf("safe request ID not preserved: %q", got)
	}
	replacedID := httptest.NewRecorder()
	replacedRequest := httptest.NewRequest(http.MethodGet, "/v1/events?from=private-title", nil)
	replacedRequest.Header.Set("X-Request-ID", "bad value with spaces")
	h.ServeHTTP(replacedID, replacedRequest)
	if got := replacedID.Header().Get("X-Request-ID"); !strings.HasPrefix(got, "cal_") || strings.Contains(got, "bad value") {
		t.Fatalf("unsafe request ID not replaced: %q", got)
	}
	ready := httptest.NewRecorder()
	h.ServeHTTP(ready, httptest.NewRequest(http.MethodGet, "/v1/ready", nil))
	if ready.Code != 200 || !strings.Contains(ready.Body.String(), `"calendar_state":"ready"`) {
		t.Fatalf("readiness truth missing: %s", ready.Body.String())
	}
	version := httptest.NewRecorder()
	h.ServeHTTP(version, httptest.NewRequest(http.MethodGet, "/v1/version", nil))
	if version.Code != 200 || !strings.Contains(version.Body.String(), `"state_schema_version":1`) {
		t.Fatalf("version truth missing: %s", version.Body.String())
	}
	metrics := httptest.NewRecorder()
	h.ServeHTTP(metrics, httptest.NewRequest(http.MethodGet, "/v1/metrics", nil))
	if metrics.Code != 200 || !strings.Contains(metrics.Body.String(), `ynx_calendar_http_requests_total{method="GET",route="GET /v1/health",status="200"} 2`) {
		t.Fatalf("runtime metrics missing: %s", metrics.Body.String())
	}
	if strings.Contains(metrics.Body.String(), "private-title") {
		t.Fatalf("private URL value leaked into metrics: %s", metrics.Body.String())
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

func TestCanonicalOutboxIsTransactionalPrivateReplaySafeAndPersistent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "canonical-outbox.json")
	svc := newTestService(t, path)
	svc.SetSourceCommit("31a34c5736a848eb3fa6d5d3a55ea5187654af14")
	_, _, _ = signIn(t, svc, "@bob", "ynx1bob")
	alice, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	in := input("Private Board Meeting", "2026-09-12T10:00", "2026-09-12T11:00", "UTC", "canonical-create-1")
	in.Description = "confidential agenda"
	in.Invitees = []string{"@bob"}
	preview, err := svc.PreviewCreate(alice, in)
	if err != nil {
		t.Fatal(err)
	}
	event, err := svc.ApproveChange(alice, preview.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	batch, err := svc.PullCanonicalEvents(100)
	if err != nil || len(batch) != 2 {
		t.Fatalf("expected lifecycle plus invitation events: %v %+v", err, batch)
	}
	if batch[0].Sequence != 1 || batch[1].Sequence != 2 || batch[0].Type != "calendar.event.created.v1" || batch[1].Type != "calendar.invitation.created.v1" || batch[0].AggregateID != event.ID || batch[0].SourceCommit != "31a34c5736a848eb3fa6d5d3a55ea5187654af14" {
		t.Fatalf("canonical event contract mismatch: %+v", batch)
	}
	encoded, _ := json.Marshal(batch)
	for _, private := range []string{"Private Board Meeting", "confidential agenda", "@alice", "@bob", "ynx1alice", "ynx1bob"} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("private Calendar content leaked into canonical outbox: %q", private)
		}
	}
	exported, err := svc.ExportAccount(alice)
	if err != nil || len(exported.CanonicalEvents) != 2 {
		t.Fatalf("subject export did not include its pending canonical evidence: %v %+v", err, exported.CanonicalEvents)
	}
	if err = svc.AcknowledgeCanonicalEvents(batch[0].Sequence); err != nil {
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
	restored, err := svc2.PullCanonicalEvents(100)
	if err != nil || len(restored) != 1 || restored[0].Sequence != batch[1].Sequence {
		t.Fatalf("unacknowledged event did not survive restart: %v %+v", err, restored)
	}
	if err = svc2.AcknowledgeCanonicalEvents(batch[1].Sequence + 1); err == nil {
		t.Fatal("future outbox acknowledgement accepted")
	}
	if err = svc2.AcknowledgeCanonicalEvents(batch[1].Sequence); err != nil {
		t.Fatal(err)
	}
	remaining, _ := svc2.PullCanonicalEvents(100)
	if len(remaining) != 0 {
		t.Fatalf("acknowledged events were not compacted: %+v", remaining)
	}
}

func TestCanonicalOutboxOverflowAbortsCalendarMutation(t *testing.T) {
	store, _ := NewStore("")
	svc, _ := NewService(store, testVerifier{}, testAI{})
	token, _, _ := signIn(t, svc, "@alice", "ynx1alice")
	in := input("Must remain unapplied", "2026-09-12T10:00", "2026-09-12T11:00", "UTC", "outbox-overflow-1")
	preview, err := svc.PreviewCreate(token, in)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.update(func(st *State) error {
		st.CanonicalOutbox = make([]CanonicalEvent, maximumPendingCanonicalEvents)
		st.OutboxSequence = maximumPendingCanonicalEvents
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.ApproveChange(token, preview.ID, false); err == nil || !strings.Contains(err.Error(), "outbox is full") {
		t.Fatalf("mutation did not fail closed on outbox overflow: %v", err)
	}
	if _, err = svc.Event(token, preview.EventID); err == nil {
		t.Fatal("Calendar mutation committed after canonical evidence overflow")
	}
}
