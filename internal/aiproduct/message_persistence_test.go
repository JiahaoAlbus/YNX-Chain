package aiproduct

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestMessagePersistenceRollbackRestartAndAccountIsolation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")
	key := bytes.Repeat([]byte{7}, 32)
	s, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.CreateConversation("alice", "Private history")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.AddMessage("alice", c.ID, Message{Role: "user", Content: "private-first", Status: "complete"}); err != nil {
		t.Fatal(err)
	}
	before, audits, sequence := s.state.Conversations[c.ID], len(s.state.Audits), s.state.AuditSequence
	s.path = dir // An existing directory cannot be replaced by the state file.
	if _, err = s.AddMessage("alice", c.ID, Message{Role: "assistant", Content: "must-not-survive", Status: "complete"}); err == nil {
		t.Fatal("expected persistence failure")
	}
	if s.state.Conversations[c.ID].MessageCount != before.MessageCount || len(s.state.Messages[c.ID]) != 1 || len(s.state.Audits) != audits || s.state.AuditSequence != sequence {
		t.Fatal("failed write changed in-memory history or audit")
	}
	s.path = path
	if _, err = s.AddMessage("bob", c.ID, Message{Role: "user", Content: "cross-account"}); err == nil {
		t.Fatal("cross-account write allowed")
	}
	if _, _, err = s.Conversation("bob", c.ID); err == nil {
		t.Fatal("cross-account history disclosed")
	}
	if _, err = s.AddMessage("alice", c.ID, Message{Role: "assistant", Content: "private-final", Status: "complete"}); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	_, messages, err := reopened.Conversation("alice", c.ID)
	if err != nil || len(messages) != 2 || messages[1].Content != "private-final" {
		t.Fatalf("history did not survive restart: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"private-first", "private-final", "must-not-survive", "cross-account"} {
		if bytes.Contains(raw, []byte(text)) {
			t.Fatal("plaintext or failed message leaked to state")
		}
	}
}
