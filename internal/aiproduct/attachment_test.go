package aiproduct

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAttachmentEncryptedPersistentBoundedAndDeletedWithConversation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ai-state.json")
	store, err := NewStore(path, bytes.Repeat([]byte{3}, 32))
	if err != nil {
		t.Fatal(err)
	}
	c, err := store.CreateConversation("ynx1owner", "attachment test")
	if err != nil {
		t.Fatal(err)
	}
	secret := []byte("private attachment body")
	a, err := store.AddAttachment("ynx1owner", c.ID, "notes.txt", "text/plain", secret)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, secret) {
		t.Fatal("attachment plaintext leaked into persistent state")
	}
	restarted, err := NewStore(path, bytes.Repeat([]byte{3}, 32))
	if err != nil {
		t.Fatal(err)
	}
	contexts, err := restarted.AttachmentContexts("ynx1owner", c.ID, []string{a.ID})
	if err != nil || len(contexts) != 1 || contexts[0].Text != string(secret) {
		t.Fatalf("attachment did not survive restart: %+v %v", contexts, err)
	}
	if _, err := restarted.AttachmentContexts("ynx1other", c.ID, []string{a.ID}); err == nil {
		t.Fatal("attachment was readable by another account")
	}
	if err := restarted.DeleteConversation("ynx1owner", c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.Attachments("ynx1owner", c.ID); err == nil {
		t.Fatal("deleted conversation attachments remained accessible")
	}
}

func TestAttachmentCipherTamperIsRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ai-state.json")
	key := bytes.Repeat([]byte{4}, 32)
	store, _ := NewStore(path, key)
	c, _ := store.CreateConversation("ynx1owner", "tamper")
	a, _ := store.AddAttachment("ynx1owner", c.ID, "data.json", "application/json", []byte(`{"safe":true}`))
	raw, _ := os.ReadFile(path)
	var doc map[string]any
	_ = json.Unmarshal(raw, &doc)
	attachments := doc["attachments"].(map[string]any)[c.ID].([]any)
	item := attachments[0].(map[string]any)
	cipher := item["cipher"].(string)
	item["cipher"] = cipher[:len(cipher)-1] + "A"
	mutated, _ := json.Marshal(doc)
	if err := os.WriteFile(path, mutated, 0o600); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.AttachmentContexts("ynx1owner", c.ID, []string{a.ID}); err == nil {
		t.Fatal("tampered encrypted attachment was accepted")
	}
}

func TestAttachmentRejectsOversizeAndUnsupportedType(t *testing.T) {
	store, _ := NewStore(filepath.Join(t.TempDir(), "state.json"), bytes.Repeat([]byte{5}, 32))
	c, _ := store.CreateConversation("ynx1owner", "bounds")
	if _, err := store.AddAttachment("ynx1owner", c.ID, "huge.txt", "text/plain", make([]byte, (256<<10)+1)); err == nil {
		t.Fatal("oversized attachment accepted")
	}
	if _, err := store.AddAttachment("ynx1owner", c.ID, "run.sh", "application/x-sh", []byte("rm -rf /")); err == nil {
		t.Fatal("unsupported attachment type accepted")
	}
}
