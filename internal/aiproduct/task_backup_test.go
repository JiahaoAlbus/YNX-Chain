package aiproduct

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestP08TaskBackupRecovery(t *testing.T) {
	source, conversation, key := p08TaskStore(t)
	task, err := source.CreateTask("tenant-a", conversation.ID, "original-holder")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(conversationToolInput{ConversationID: conversation.ID})
	session := ProductSession{Account: "tenant-a", DeviceID: "original-holder", Scopes: []string{"ai:conversations"}}
	input := toolStepRequest{OperationID: "pending-original", TaskRevision: 1, Generation: 1, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw}
	if _, _, err := source.reserveToolStep(session, task.ID, input); err != nil {
		t.Fatal(err)
	}
	unknown := ActionRecord{ID: "remote-original", Account: "tenant-a", ConversationID: conversation.ID, Status: "UNKNOWN", GatewayID: "immutable-remote-id", Description: "firstCause: response lost", Evidence: []string{"original-result-reference"}, ToolStep: &ToolStepBinding{TaskID: task.ID, OperationID: "same-original-operation"}}
	if err := source.SaveAction(unknown); err != nil {
		t.Fatal(err)
	}
	if _, err := source.CancelTask("tenant-a", task.ID, 1, 1, "original-holder"); err != nil {
		t.Fatal(err)
	}
	want, err := source.ReadTaskProjection("tenant-a", task.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(t.TempDir(), "task.ynxbackup")
	if _, err := source.CreateBackup(backup); err != nil {
		t.Fatal(err)
	}
	backupBytes, err := os.ReadFile(backup)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{task.ID, unknown.GatewayID, "same-original-operation", conversation.ID} {
		if bytes.Contains(backupBytes, []byte(private)) {
			t.Fatalf("encrypted backup exposed orchestration reference %q", private)
		}
	}
	targetPath := filepath.Join(t.TempDir(), "restored.json")
	target, err := NewStore(targetPath, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := target.RestoreBackup(backup); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewStore(targetPath, key)
	if err != nil {
		t.Fatal(err)
	}
	got, err := restarted.ReadTaskProjection("tenant-a", task.ID, 0)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("task/event/cancellation recovery mismatch: %+v %v", got, err)
	}
	if remote, ok := restarted.Action("tenant-a", unknown.ID); !ok || !reflect.DeepEqual(remote, unknown) {
		t.Fatalf("UNKNOWN identity/evidence changed: %+v", remote)
	}
	input.TaskRevision = got.Revision
	input.OperationID = "must-not-run-after-restore"
	if _, _, err := restarted.reserveToolStep(session, task.ID, input); err != errToolConflict {
		t.Fatalf("restore reopened cancelled work: %v", err)
	}
	if _, err := restarted.RestoreBackup(backup); err == nil {
		t.Fatal("same backup replay accepted")
	}
}

func TestP08LegacyBackupDoesNotCreateTaskAuthority(t *testing.T) {
	source, _, key := p08TaskStore(t)
	if len(source.state.Tasks) != 0 || len(source.state.TaskEvents) != 0 {
		t.Fatal("legacy fixture unexpectedly has tasks")
	}
	backup := filepath.Join(t.TempDir(), "legacy.ynxbackup")
	if _, err := source.CreateBackup(backup); err != nil {
		t.Fatal(err)
	}
	target, err := NewStore(filepath.Join(t.TempDir(), "restored.json"), key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := target.RestoreBackup(backup); err != nil {
		t.Fatal(err)
	}
	if len(target.state.Tasks) != 0 || len(target.state.TaskEvents) != 0 || len(target.state.Permissions) != 0 || len(target.state.Actions) != 0 {
		t.Fatal("legacy restore manufactured task or effect authority")
	}
}
