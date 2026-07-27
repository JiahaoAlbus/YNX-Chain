package main

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/trustproduct"
)

func TestRunCreatesAndColdStartsRestoredStore(t *testing.T) {
	root := t.TempDir()
	livePath := filepath.Join(root, "live", "state.json")
	backupPath := filepath.Join(root, "backups", "trust.json")
	restorePath := filepath.Join(root, "restore", "state.json")

	svc, err := trustproduct.New(trustproduct.Config{StorePath: livePath})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.Do(trustproduct.Actor{ID: "cli-reporter", Role: "reporter"}, trustproduct.Action{
		Type:            "submit_case",
		IdempotencyKey:  "cli-backup-case",
		Subject:         "cli-subject",
		Purpose:         "exercise the operator backup command",
		RequestScope:    "one case",
		RequestedAction: "review",
		Evidence: []trustproduct.Evidence{{
			Source:           "cli test evidence",
			Digest:           "sha256:cli-test",
			Summary:          "bounded test record",
			VisibleToSubject: true,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	var stdout, stderr bytes.Buffer
	if code := run([]string{"create", "-store", livePath, "-out", backupPath}, &stdout, &stderr); code != 0 {
		t.Fatalf("create exit=%d stderr=%s", code, stderr.String())
	}
	var created trustproduct.BackupManifest
	if err := json.Unmarshal(stdout.Bytes(), &created); err != nil || created.CaseCount != 1 {
		t.Fatalf("create manifest err=%v value=%+v", err, created)
	}

	stdout.Reset()
	stderr.Reset()
	if code := run([]string{"restore", "-backup", backupPath, "-store", restorePath}, &stdout, &stderr); code != 0 {
		t.Fatalf("restore exit=%d stderr=%s", code, stderr.String())
	}
	var restored trustproduct.BackupManifest
	if err := json.Unmarshal(stdout.Bytes(), &restored); err != nil || restored != created {
		t.Fatalf("restore manifest err=%v got=%+v want=%+v", err, restored, created)
	}
	if _, err := trustproduct.New(trustproduct.Config{StorePath: restorePath}); err != nil {
		t.Fatalf("restored store failed independent cold start: %v", err)
	}
}

func TestRunFailsClosedOnInvalidInvocation(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run(nil, &stdout, &stderr); code != 2 {
		t.Fatalf("empty invocation exit=%d", code)
	}
	stdout.Reset()
	stderr.Reset()
	missing := filepath.Join(t.TempDir(), "missing-state.json")
	if code := run([]string{"create", "-store", missing, "-out", missing + ".backup"}, &stdout, &stderr); code != 1 {
		t.Fatalf("missing store invocation exit=%d", code)
	}
}
