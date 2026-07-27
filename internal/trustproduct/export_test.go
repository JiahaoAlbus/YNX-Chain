package trustproduct

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSubjectExportIsPortableAndCrossSubjectIsolated(t *testing.T) {
	now := time.Date(2026, 7, 17, 8, 0, 0, 0, time.UTC)
	subject := Actor{ID: "ynx1subject-export", Role: "user"}
	svc, err := New(Config{
		StorePath: filepath.Join(t.TempDir(), "state.json"),
		Now:       func() time.Time { return now },
		Sessions: map[string]Actor{
			"subject-export-session": subject,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	reporter := Actor{ID: "ynx1reporter-export", Role: "reporter"}
	ownCase := do(t, svc, reporter, Action{
		Type:            "submit_case",
		IdempotencyKey:  "subject-export-case",
		Subject:         subject.ID,
		Purpose:         "provide a portable subject record",
		RequestScope:    "one account and event",
		RequestedAction: "review",
		Evidence:        evidence(),
	}).Case
	otherCase := do(t, svc, reporter, Action{
		Type:            "submit_case",
		IdempotencyKey:  "other-subject-case",
		Subject:         "ynx1other-subject",
		Purpose:         "must not cross the export boundary",
		RequestScope:    "one account and event",
		RequestedAction: "review",
		Evidence:        evidence(),
	}).Case
	do(t, svc, subject, Action{
		Type:           "ai_prepare",
		IdempotencyKey: "subject-export-ai",
		CaseID:         ownCase.ID,
		Purpose:        "explain my evidence record",
		Context:        []string{"evidence_summary", "appeal"},
	})

	exported, err := svc.ExportSubject(subject)
	if err != nil {
		t.Fatal(err)
	}
	if exported.SchemaVersion != subjectExportSchemaVersion || exported.Account != subject.ID || exported.StateFormatVersion != currentSnapshotVersion {
		t.Fatalf("bad export identity: %+v", exported)
	}
	if len(exported.Cases) != 1 || exported.Cases[0].ID != ownCase.ID {
		t.Fatalf("cross-subject case boundary failed: %+v", exported.Cases)
	}
	if len(exported.AI) != 1 || exported.AI[0].Owner != subject.ID {
		t.Fatalf("subject AI export failed: %+v", exported.AI)
	}
	if strings.Contains(mustJSON(t, exported), otherCase.ID) || strings.Contains(mustJSON(t, exported), "ynx1other-subject") {
		t.Fatal("another subject's record leaked into export")
	}

	server := httptest.NewServer(svc.Handler(http.NotFoundHandler()))
	defer server.Close()
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/export", nil)
	req.Header.Set("Authorization", "Bearer subject-export-session")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("export status=%d body=%s", resp.StatusCode, raw)
	}
	if resp.Header.Get("Cache-Control") != "no-store" || !strings.Contains(resp.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("unsafe export headers: %+v", resp.Header)
	}
	for _, forbidden := range [][]byte{
		[]byte("subject-export-session"),
		[]byte(`"tokenHash"`),
		[]byte(`"sessions"`),
		[]byte(`"replay"`),
		[]byte(`"integrity"`),
		[]byte(otherCase.ID),
	} {
		if bytes.Contains(raw, forbidden) {
			t.Fatalf("forbidden internal or cross-subject data in export: %s", forbidden)
		}
	}
	var decoded SubjectExport
	if err := json.Unmarshal(raw, &decoded); err != nil || decoded.Account != subject.ID || len(decoded.Cases) != 1 {
		t.Fatalf("invalid portable export: err=%v body=%s", err, raw)
	}

	unauthenticated, err := http.Get(server.URL + "/api/export")
	if err != nil {
		t.Fatal(err)
	}
	unauthenticated.Body.Close()
	if unauthenticated.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated export status=%d", unauthenticated.StatusCode)
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
