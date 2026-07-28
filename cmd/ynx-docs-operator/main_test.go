package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
)

const operatorOwner = "ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqf4d5uw"

func TestOperatorBackupRestoreRoundTripIsReadOnlyAgainstSource(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "source", "state.json")
	objectDir := filepath.Join(root, "source", "objects")
	service, err := cloud.New(cloud.Config{StatePath: statePath, ObjectDir: objectDir})
	if err != nil {
		t.Fatal(err)
	}
	document, err := service.Create(context.Background(), operatorOwner, cloud.CreateObjectRequest{Kind: cloud.KindDoc, Name: "Operator", MIME: "text/plain", Content: []byte("operator drill")})
	if err != nil {
		t.Fatal(err)
	}
	stateBefore, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}

	backupDir := filepath.Join(root, "backup")
	var backupOutput, backupErrors bytes.Buffer
	code := run(context.Background(), []string{"backup", "--state", statePath, "--objects", objectDir, "--out", backupDir}, &backupOutput, &backupErrors)
	if code != 0 {
		t.Fatalf("backup exit %d: %s", code, backupErrors.String())
	}
	stateAfter, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stateBefore, stateAfter) {
		t.Fatal("offline backup modified the source state")
	}
	var manifest cloud.BackupManifest
	if err := json.Unmarshal(backupOutput.Bytes(), &manifest); err != nil {
		t.Fatalf("decode backup output: %v\n%s", err, backupOutput.String())
	}
	if manifest.BackupID == "" || len(manifest.Objects) != 1 || manifest.ProductionDurabilityClaim {
		t.Fatalf("unexpected backup output: %#v", manifest)
	}

	restoredState := filepath.Join(root, "restored", "state.json")
	restoredObjects := filepath.Join(root, "restored", "objects")
	var restoreOutput, restoreErrors bytes.Buffer
	code = run(context.Background(), []string{"restore", "--backup", backupDir, "--state", restoredState, "--objects", restoredObjects}, &restoreOutput, &restoreErrors)
	if code != 0 {
		t.Fatalf("restore exit %d: %s", code, restoreErrors.String())
	}
	var report cloud.RestoreReport
	if err := json.Unmarshal(restoreOutput.Bytes(), &report); err != nil {
		t.Fatalf("decode restore output: %v\n%s", err, restoreOutput.String())
	}
	if !report.Ready || report.BackupID != manifest.BackupID || report.SessionsRestored != 0 || report.PresenceRestored != 0 {
		t.Fatalf("unexpected restore report: %#v", report)
	}
	restored, err := cloud.New(cloud.Config{StatePath: restoredState, ObjectDir: restoredObjects})
	if err != nil {
		t.Fatal(err)
	}
	if metadata, body, err := restored.Content(operatorOwner, document.ID, 0); err != nil || metadata.Hash != document.Hash || string(body) != "operator drill" {
		t.Fatalf("restored content: %#v %q %v", metadata, body, err)
	}
}

func TestOperatorRejectsUnsafePathsAndBroadSourcePermissions(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "source", "state.json")
	objectDir := filepath.Join(root, "source", "objects")
	service, err := cloud.New(cloud.Config{StatePath: statePath, ObjectDir: objectDir})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Create(context.Background(), operatorOwner, cloud.CreateObjectRequest{Kind: cloud.KindDoc, Name: "Safety", MIME: "text/plain", Content: []byte("safe")}); err != nil {
		t.Fatal(err)
	}

	var stdout, stderr bytes.Buffer
	insideObjects := filepath.Join(objectDir, "backup")
	if code := run(context.Background(), []string{"backup", "--state", statePath, "--objects", objectDir, "--out", insideObjects}, &stdout, &stderr); code != 2 || !strings.Contains(stderr.String(), "must not be inside") {
		t.Fatalf("unsafe destination exit=%d stderr=%q", code, stderr.String())
	}
	if _, err := os.Stat(insideObjects); !os.IsNotExist(err) {
		t.Fatalf("unsafe destination was created: %v", err)
	}

	if runtime.GOOS != "windows" {
		if err := os.Chmod(statePath, 0o644); err != nil {
			t.Fatal(err)
		}
		stdout.Reset()
		stderr.Reset()
		outside := filepath.Join(root, "outside-backup")
		if code := run(context.Background(), []string{"backup", "--state", statePath, "--objects", objectDir, "--out", outside}, &stdout, &stderr); code != 1 || !strings.Contains(stderr.String(), "permissions are too broad") {
			t.Fatalf("broad source permissions exit=%d stderr=%q", code, stderr.String())
		}
		if err := os.Chmod(statePath, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	stdout.Reset()
	stderr.Reset()
	stateInsideObjects := filepath.Join(objectDir, "state.json")
	if code := run(context.Background(), []string{"backup", "--state", stateInsideObjects, "--objects", objectDir, "--out", filepath.Join(root, "separate")}, &stdout, &stderr); code != 2 || !strings.Contains(stderr.String(), "source state must not be inside") {
		t.Fatalf("state-inside-object path exit=%d stderr=%q", code, stderr.String())
	}
}

func TestOperatorCanonicalizesSymlinkedParentsAndRejectsRestoreMixing(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink semantics require elevated Windows privileges")
	}
	root := t.TempDir()
	realParent := filepath.Join(root, "real")
	if err := os.Mkdir(realParent, 0o700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(root, "alias")
	if err := os.Symlink(realParent, alias); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	inside, err := pathInside(filepath.Join(alias, "child", "future"), realParent)
	if err != nil || !inside {
		t.Fatalf("symlinked path was not canonicalized: inside=%v err=%v", inside, err)
	}

	var stdout, stderr bytes.Buffer
	backupDir := filepath.Join(root, "backup")
	if err := os.MkdirAll(filepath.Join(backupDir, "objects"), 0o700); err != nil {
		t.Fatal(err)
	}
	stateInsideObjects := filepath.Join(root, "target", "objects", "state.json")
	objectDir := filepath.Join(root, "target", "objects")
	code := run(context.Background(), []string{"restore", "--backup", backupDir, "--state", stateInsideObjects, "--objects", objectDir}, &stdout, &stderr)
	if code != 2 || !strings.Contains(stderr.String(), "must not be written inside") {
		t.Fatalf("restore mixing exit=%d stderr=%q", code, stderr.String())
	}
}

func TestOperatorUsageAndRequiredFlags(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run(context.Background(), nil, &stdout, &stderr); code != 2 || !strings.Contains(stderr.String(), "Usage:") {
		t.Fatalf("empty args exit=%d stderr=%q", code, stderr.String())
	}
	stdout.Reset()
	stderr.Reset()
	if code := run(context.Background(), []string{"backup", "--state", "state.json"}, &stdout, &stderr); code != 2 || !strings.Contains(stderr.String(), "required flags missing") {
		t.Fatalf("missing flags exit=%d stderr=%q", code, stderr.String())
	}
	stdout.Reset()
	stderr.Reset()
	if code := run(context.Background(), []string{"unknown"}, &stdout, &stderr); code != 2 || !strings.Contains(stderr.String(), "unknown command") {
		t.Fatalf("unknown command exit=%d stderr=%q", code, stderr.String())
	}
}
