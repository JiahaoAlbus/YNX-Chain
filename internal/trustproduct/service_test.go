package trustproduct

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func evidence() []Evidence {
	return []Evidence{{Source: "signed transaction record", Digest: "sha256:001122", Summary: "A bounded event with source provenance", VisibleToSubject: true}}
}
func do(t *testing.T, s *Service, a Actor, in Action) Result {
	t.Helper()
	r, err := s.Do(a, in)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestCaseLifecycleRoleSeparationCorrectionExpiryReplayRestart(t *testing.T) {
	now := time.Date(2026, 7, 15, 9, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state.json")
	svc, err := New(Config{StorePath: path, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	user := Actor{"ynx1subject", "user"}
	reporter := Actor{"ynx1reporter", "reporter"}
	reviewer := Actor{"ynx1reviewer", "reviewer"}
	appeals := Actor{"ynx1appeals", "appeal_reviewer"}
	illegal := do(t, svc, reporter, Action{Type: "submit_case", IdempotencyKey: "illegal", Subject: user.ID, Purpose: "request", RequestScope: "one event", RequestedAction: "freeze native YNXT", Evidence: evidence()}).Case
	if illegal.Status != "rejected_illegal" || !strings.Contains(illegal.ValidityReason, "cannot") && !strings.Contains(illegal.ValidityReason, "illegal") {
		t.Fatalf("illegal request not rejected: %+v", illegal)
	}
	overbroad := do(t, svc, reporter, Action{Type: "submit_case", IdempotencyKey: "broad", Subject: user.ID, Purpose: "request", RequestScope: "all accounts", RequestedAction: "review", Evidence: evidence()}).Case
	if overbroad.Status != "rejected_overbroad" {
		t.Fatalf("overbroad=%s", overbroad.Status)
	}
	if _, err := svc.Do(reviewer, Action{Type: "review", IdempotencyKey: "illegal-valid", CaseID: illegal.ID, Decision: "valid", Reason: "override", Classification: "allowed"}); err == nil {
		t.Fatal("illegal native asset request was reviewed as valid")
	}
	if _, err := svc.Do(reviewer, Action{Type: "review", IdempotencyKey: "broad-valid", CaseID: overbroad.ID, Decision: "valid", Reason: "override", Classification: "allowed"}); err == nil {
		t.Fatal("overbroad request was reviewed as valid")
	}
	in := Action{Type: "submit_case", IdempotencyKey: "case-1", Subject: user.ID, Purpose: "explain event", RequestScope: "one account/event", RequestedAction: "review", Evidence: evidence()}
	submitted := do(t, svc, reporter, in).Case
	again := do(t, svc, reporter, in)
	if !again.Replayed || again.Case.ID != submitted.ID {
		t.Fatalf("exact replay failed: %+v", again)
	}
	changed := in
	changed.Purpose = "changed"
	if _, err := svc.Do(reporter, changed); err == nil {
		t.Fatal("changed replay accepted")
	}
	if _, err := svc.Do(Actor{reporter.ID, "reviewer"}, Action{Type: "review", IdempotencyKey: "own", CaseID: submitted.ID, Decision: "valid", Reason: "ok", Classification: "reviewed"}); err == nil {
		t.Fatal("owner reviewed own case")
	}
	reviewed := do(t, svc, reviewer, Action{Type: "review", IdempotencyKey: "review", CaseID: submitted.ID, Decision: "valid", Reason: "Evidence supports a bounded classification", Classification: "reviewed event"}).Case
	labelled := do(t, svc, reviewer, Action{Type: "set_label", IdempotencyKey: "label", CaseID: reviewed.ID, LabelValue: "reviewed", LabelSource: "case evidence records", ExpiresAt: now.Add(time.Hour)}).Case
	if labelled.Label == nil || labelled.Label.Source == "" {
		t.Fatal("visible label source missing")
	}
	appealed := do(t, svc, user, Action{Type: "appeal", IdempotencyKey: "appeal", CaseID: reviewed.ID, Reason: "The event was attributed to the wrong account", Evidence: evidence()}).Case
	appealID := appealed.Appeals[0].ID
	if _, err := svc.Do(Actor{reviewer.ID, "appeal_reviewer"}, Action{Type: "resolve_appeal", IdempotencyKey: "bad-separation", CaseID: reviewed.ID, AppealID: appealID, Decision: "false_positive", Reason: "wrong"}); err == nil {
		t.Fatal("initial reviewer resolved appeal")
	}
	corrected := do(t, svc, appeals, Action{Type: "resolve_appeal", IdempotencyKey: "resolve", CaseID: reviewed.ID, AppealID: appealID, Decision: "false_positive", Reason: "New signed evidence disproves attribution"}).Case
	if corrected.Status != "corrected" || corrected.Label.Active || corrected.Notice == nil {
		t.Fatalf("correction incomplete: %+v", corrected)
	}
	if _, err := New(Config{StorePath: path, Now: func() time.Time { return now }}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("store mode=%v err=%v", info.Mode().Perm(), err)
	}
	restarted, _ := New(Config{StorePath: path, Now: func() time.Time { return now }})
	view, err := restarted.View(user)
	if err != nil || len(view["cases"].([]Case)) < 3 {
		t.Fatalf("restart lost state: %v %+v", err, view)
	}
}

func TestSnapshotIntegrityRejectsOfflineTamperAndMigratesLegacyState(t *testing.T) {
	now := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state.json")
	svc, err := New(Config{StorePath: path, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	do(t, svc, Actor{"ynx1reporter", "reporter"}, Action{
		Type:            "submit_case",
		IdempotencyKey:  "integrity-case",
		Subject:         "ynx1subject",
		Purpose:         "verify persisted evidence integrity",
		RequestScope:    "one case",
		RequestedAction: "review",
		Evidence:        evidence(),
	})

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var sealed snapshot
	if err := json.Unmarshal(raw, &sealed); err != nil {
		t.Fatal(err)
	}
	if sealed.Version != currentSnapshotVersion || !strings.HasPrefix(sealed.Integrity, "sha256:") {
		t.Fatalf("snapshot was not sealed: version=%d integrity=%q", sealed.Version, sealed.Integrity)
	}
	if _, err := New(Config{StorePath: path, Now: func() time.Time { return now }}); err != nil {
		t.Fatalf("valid sealed snapshot did not restart: %v", err)
	}

	tampered := strings.Replace(string(raw), "ynx1subject", "ynx1tampered", 1)
	if tampered == string(raw) {
		t.Fatal("tamper fixture did not alter persisted state")
	}
	if err := os.WriteFile(path, []byte(tampered), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{StorePath: path, Now: func() time.Time { return now }}); err == nil || !strings.Contains(err.Error(), "integrity mismatch") {
		t.Fatalf("offline-tampered snapshot was accepted: %v", err)
	}

	// Version 1 stores are preserved and atomically upgraded once. After the
	// migration, they receive the same version-2 integrity protection.
	sealed.Version = 1
	sealed.Integrity = ""
	legacyRaw, err := json.MarshalIndent(sealed, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, legacyRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{StorePath: path, Now: func() time.Time { return now }}); err != nil {
		t.Fatalf("legacy snapshot migration failed: %v", err)
	}
	migratedRaw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var migrated snapshot
	if err := json.Unmarshal(migratedRaw, &migrated); err != nil {
		t.Fatal(err)
	}
	if migrated.Version != currentSnapshotVersion || migrated.Integrity == "" {
		t.Fatalf("legacy snapshot was not integrity-migrated: version=%d integrity=%q", migrated.Version, migrated.Integrity)
	}
	if err := verifySnapshotIntegrity(migrated); err != nil {
		t.Fatalf("migrated snapshot seal is invalid: %v", err)
	}
}

func TestLabelExpiryAndEvidenceRequired(t *testing.T) {
	now := time.Date(2026, 7, 15, 9, 0, 0, 0, time.UTC)
	svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "s.json"), Now: func() time.Time { return now }})
	if _, err := svc.Do(Actor{"r", "reporter"}, Action{Type: "submit_case", IdempotencyKey: "none", Subject: "s", Purpose: "p", RequestScope: "one", RequestedAction: "review"}); err == nil {
		t.Fatal("evidenceless conclusion path accepted")
	}
	c := do(t, svc, Actor{"r", "reporter"}, Action{Type: "submit_case", IdempotencyKey: "c", Subject: "s", Purpose: "p", RequestScope: "one", RequestedAction: "review", Evidence: evidence()}).Case
	c = do(t, svc, Actor{"v", "reviewer"}, Action{Type: "review", IdempotencyKey: "v", CaseID: c.ID, Decision: "valid", Reason: "bounded", Classification: "reviewed"}).Case
	do(t, svc, Actor{"v", "reviewer"}, Action{Type: "set_label", IdempotencyKey: "l", CaseID: c.ID, LabelValue: "reviewed", LabelSource: "evidence", ExpiresAt: now.Add(time.Minute)})
	now = now.Add(2 * time.Minute)
	do(t, svc, Actor{"system", "system"}, Action{Type: "expire_labels", IdempotencyKey: "x"})
	view, _ := svc.View(Actor{"s", "user"})
	got := view["cases"].([]Case)[0]
	if got.Label.Active {
		t.Fatal("expired label remains active")
	}
}

func TestAIProviderPermissionFailureAndNoCaseMutation(t *testing.T) {
	now := time.Now().UTC()
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.RawQuery != "" {
			t.Errorf("AI prompt must use POST body, got %s %s", r.Method, r.URL.String())
		}
		var aiBody map[string]any
		if json.NewDecoder(r.Body).Decode(&aiBody) != nil || aiBody["prompt"] == "" || aiBody["outputLanguage"] != "en" {
			t.Errorf("invalid POST AI body: %+v", aiBody)
		}
		if r.Header.Get("Authorization") != "Bearer server-key" {
			t.Error("missing server-only gateway key")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"delta\":\"Evidence explains provenance; human review remains required.\"}\n\n"))
	}))
	defer provider.Close()
	svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "s.json"), Now: func() time.Time { return now }, AIURL: provider.URL, AIKey: "server-key", AIModel: "provider-model"})
	c := do(t, svc, Actor{"r", "reporter"}, Action{Type: "submit_case", IdempotencyKey: "c", Subject: "s", Purpose: "p", RequestScope: "one", RequestedAction: "review", Evidence: evidence()}).Case
	prepared := do(t, svc, Actor{"s", "user"}, Action{Type: "ai_prepare", IdempotencyKey: "p", CaseID: c.ID, Purpose: "explain appeal", Context: []string{"evidence_summary", "appeal"}}).AI
	if prepared.Provider != "YNX AI Gateway" || prepared.Permission {
		t.Fatalf("bad preview %+v", prepared)
	}
	if _, err := svc.Do(Actor{"s", "user"}, Action{Type: "ai_run", IdempotencyKey: "no", AIID: prepared.ID}); err == nil {
		t.Fatal("AI ran without consent")
	}
	run := do(t, svc, Actor{"s", "user"}, Action{Type: "ai_run", IdempotencyKey: "run", AIID: prepared.ID, Permission: true}).AI
	if run.Status != "completed" || run.Result == "" {
		t.Fatalf("AI run %+v", run)
	}
	view, _ := svc.View(Actor{"s", "user"})
	if view["cases"].([]Case)[0].Status != "submitted" {
		t.Fatal("AI changed case state")
	}
	unavailable, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "u.json")})
	uc := do(t, unavailable, Actor{"r", "reporter"}, Action{Type: "submit_case", IdempotencyKey: "c", Subject: "s", Purpose: "p", RequestScope: "one", RequestedAction: "review", Evidence: evidence()}).Case
	ua := do(t, unavailable, Actor{"s", "user"}, Action{Type: "ai_prepare", IdempotencyKey: "p", CaseID: uc.ID, Purpose: "explain", Context: []string{"appeal"}}).AI
	failed := do(t, unavailable, Actor{"s", "user"}, Action{Type: "ai_run", IdempotencyKey: "r", AIID: ua.ID, Permission: true}).AI
	if failed.Status != "failed" || !strings.Contains(failed.Error, "unavailable") {
		t.Fatalf("provider failure hidden: %+v", failed)
	}
}

func TestHTTPAuthorizationSecurityAndTransparency(t *testing.T) {
	svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "s.json"), AllowHeaderAuth: true, Build: buildinfo.Info{Commit: "commit-123", Release: "trust-test", BuildTime: "2026-07-27T00:00:00Z"}})
	ts := httptest.NewServer(svc.Handler(http.NotFoundHandler()))
	defer ts.Close()
	healthResp, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	var health map[string]any
	if err := json.NewDecoder(healthResp.Body).Decode(&health); err != nil {
		healthResp.Body.Close()
		t.Fatal(err)
	}
	healthResp.Body.Close()
	build, _ := health["build"].(map[string]any)
	if healthResp.StatusCode != http.StatusOK || health["stateFormatVersion"] != float64(currentSnapshotVersion) || health["tamperEvidentPersistence"] != true || build["commit"] != "commit-123" || build["release"] != "trust-test" || build["buildTime"] != "2026-07-27T00:00:00Z" {
		t.Fatalf("health does not disclose persistence and build integrity: status=%d body=%+v", healthResp.StatusCode, health)
	}
	resp, err := http.Get(ts.URL + "/api/state")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 401 {
		t.Fatalf("status=%d", resp.StatusCode)
	}
	if !strings.Contains(resp.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatal("security headers absent")
	}
	body, _ := json.Marshal(Action{Type: "submit_case", IdempotencyKey: "http", Subject: "s", Purpose: "p", RequestScope: "one", RequestedAction: "review", Evidence: evidence()})
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/actions", bytes.NewReader(body))
	req.Header.Set("X-YNX-Actor", "r")
	req.Header.Set("X-YNX-Role", "reporter")
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("submit status=%d", resp.StatusCode)
	}
	resp, err = http.Get(ts.URL + "/api/transparency")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("transparency err=%v status=%d", err, resp.StatusCode)
	}
}

func TestSessionRegistryRejectsSpoofedRoleHeaders(t *testing.T) {
	svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "s.json"), Sessions: map[string]Actor{"opaque-session": {ID: "verified", Role: "reporter"}}})
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
