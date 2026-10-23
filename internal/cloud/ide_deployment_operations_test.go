package cloud

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func ideOperationInput(t *testing.T) IDEDeploymentOperation {
	t.Helper()
	_, raw, binding := ideArtifactData(t)
	return IDEDeploymentOperation{RequestID: "request_original_123456", Binding: binding, ManifestSHA256: productHash(raw), ApprovalSHA256: productHash([]byte("PUBLIC_TEST_APPROVAL_NOT_AUTHORITY")), PublisherID: "PUBLIC_TEST_PUBLISHER_NOT_AUTHORITY", CreatedAt: time.Now().UTC()}
}

func TestIDEDeploymentOperationUnknownRestartNeverReclaims(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "private-journal")
	j, err := newIDEDeploymentJournal(dir)
	if err != nil {
		t.Fatal(err)
	}
	input := ideOperationInput(t)
	op, claim, err := j.begin("PUBLIC_TEST_ACTOR", input)
	if err != nil || !claim || op.State != "unknown" {
		t.Fatalf("initial claim: %v %v", claim, err)
	}
	reopened, err := newIDEDeploymentJournal(dir)
	if err != nil {
		t.Fatal(err)
	}
	again, claim, err := reopened.begin("PUBLIC_TEST_ACTOR", input)
	if err != nil || claim || again.State != "unknown" {
		t.Fatalf("replayed unknown: %v %v", claim, err)
	}
	if len(again.Logs) != 1 || again.Logs[0].Source != "cloud-operation" {
		t.Fatal("operation log incorrectly claims runtime output")
	}
}

func TestIDEDeploymentOperationRequestConflict(t *testing.T) {
	j, err := newIDEDeploymentJournal(filepath.Join(t.TempDir(), "private-journal"))
	if err != nil {
		t.Fatal(err)
	}
	input := ideOperationInput(t)
	if _, _, err := j.begin("PUBLIC_TEST_ACTOR", input); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"project", "environment", "artifact", "manifest", "approval", "publisher"} {
		t.Run(field, func(t *testing.T) {
			changed := input
			switch field {
			case "project":
				changed.Binding.ProjectID = "other"
			case "environment":
				changed.Binding.TargetEnvironment = "other"
			case "artifact":
				changed.Binding.ContentDigest = strings.Repeat("a", 64)
			case "manifest":
				changed.ManifestSHA256 = strings.Repeat("b", 64)
			case "approval":
				changed.ApprovalSHA256 = strings.Repeat("c", 64)
			case "publisher":
				changed.PublisherID = "other"
			}
			if _, claim, err := j.begin("PUBLIC_TEST_ACTOR", changed); claim || !errors.Is(err, ErrIDEDeploymentConflict) {
				t.Fatalf("conflicting request: %v %v", claim, err)
			}
		})
	}
}

func TestIDEDeploymentOperationTerminalCurrentAndOwner(t *testing.T) {
	j, err := newIDEDeploymentJournal(filepath.Join(t.TempDir(), "private-journal"))
	if err != nil {
		t.Fatal(err)
	}
	input := ideOperationInput(t)
	op, _, err := j.begin("PUBLIC_TEST_ACTOR", input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := j.lookup("OTHER_PUBLIC_TEST_ACTOR", input.RequestID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner read: %v", err)
	}
	op.State, op.DeploymentID, op.RuntimeURL, op.UpdatedAt = "running", "PUBLIC_TEST_DEPLOYMENT", "https://public-test.invalid/run", time.Now().UTC()
	denied := errors.New("PUBLIC_TEST_CURRENT_REVOKED")
	if err := j.recordTerminal("PUBLIC_TEST_ACTOR", op, func() error { return denied }); !errors.Is(err, denied) {
		t.Fatalf("revoked publication: %v", err)
	}
	prior, err := j.lookup("PUBLIC_TEST_ACTOR", input.RequestID)
	if err != nil || prior.State != "unknown" {
		t.Fatal("revoked gate lost UNKNOWN")
	}
	if err := j.recordTerminal("PUBLIC_TEST_ACTOR", op, nil); !errors.Is(err, ErrInvalid) {
		t.Fatal("nil current gate accepted")
	}
	// PUBLIC IO seam only, not genuine authorization or deployment acceptance.
	if err := j.recordTerminal("PUBLIC_TEST_ACTOR", op, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	prior, err = j.lookup("PUBLIC_TEST_ACTOR", input.RequestID)
	if err != nil || prior.State != "running" || len(prior.Logs) != 2 {
		t.Fatalf("terminal receipt: %#v %v", prior, err)
	}
	if err := j.recordTerminal("PUBLIC_TEST_ACTOR", op, func() error { return nil }); !errors.Is(err, ErrIDEDeploymentConflict) {
		t.Fatal("terminal result overwritten")
	}
	if _, claim, err := j.begin("PUBLIC_TEST_ACTOR", input); err != nil || claim {
		t.Fatal("completed result reexecuted")
	}
}

func TestIDEDeploymentOperationCorruptionAndPrivacy(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "private-journal")
	j, err := newIDEDeploymentJournal(dir)
	if err != nil {
		t.Fatal(err)
	}
	input := ideOperationInput(t)
	if _, _, err := j.begin("PUBLIC_TEST_ACTOR", input); err != nil {
		t.Fatal(err)
	}
	file := j.file("PUBLIC_TEST_ACTOR", input.RequestID)
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "PUBLIC_TEST_ACTOR") || strings.Contains(string(raw), "PUBLIC_TEST_APPROVAL_NOT_AUTHORITY") {
		t.Fatal("journal retained actor or approval body")
	}
	if err := os.WriteFile(file, []byte("{bad json"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, claim, err := j.begin("PUBLIC_TEST_ACTOR", input); err == nil || claim {
		t.Fatal("corrupt record treated as absent")
	}
	if _, err := os.Stat(filepath.Join(dir, filepath.Base(file))); err != nil {
		t.Fatal("corrupt first cause removed")
	}
}

func TestIDEDeploymentOperationRejectsPublicDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := newIDEDeploymentJournal(dir); err == nil {
		t.Fatal("public journal permissions accepted")
	}
}
