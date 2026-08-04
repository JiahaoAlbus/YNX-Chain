package aiproduct

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"sync"
	"testing"
)

func TestConcurrentMessagesPreserveCountEncryptionAndAuditChain(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "state.json"), bytes.Repeat([]byte{8}, 32))
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation("ynx1concurrent", "Concurrency")
	if err != nil {
		t.Fatal(err)
	}
	const writers = 32
	var wait sync.WaitGroup
	errors := make(chan error, writers)
	for i := 0; i < writers; i++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			_, writeErr := store.AddMessage("ynx1concurrent", conversation.ID, Message{Role: "user", Content: "private concurrent payload", Status: "complete"})
			errors <- writeErr
		}(i)
	}
	wait.Wait()
	close(errors)
	for writeErr := range errors {
		if writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	got, messages, err := store.Conversation("ynx1concurrent", conversation.ID)
	if err != nil || got.MessageCount != writers || len(messages) != writers {
		t.Fatalf("concurrent message invariant failed: conversation=%+v messages=%d err=%v", got, len(messages), err)
	}
	raw, err := json.Marshal(store.state)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("private concurrent payload")) {
		t.Fatal("concurrent persistent state leaked plaintext")
	}
	previous := ""
	for _, event := range store.state.Audits {
		if event.PreviousHash != previous {
			t.Fatalf("audit link mismatch at sequence %d", event.Sequence)
		}
		copy := event
		copy.Hash = ""
		encoded, _ := json.Marshal(copy)
		sum := sha256.Sum256(encoded)
		if event.Hash != hex.EncodeToString(sum[:]) {
			t.Fatalf("audit hash mismatch at sequence %d", event.Sequence)
		}
		previous = event.Hash
	}
}

func FuzzBoundedTextAndCleanListInvariants(f *testing.F) {
	f.Add("  alpha  ", 5)
	f.Add("مرحبا بالعالم", 7)
	f.Add("alpha\x00beta", 120)
	f.Fuzz(func(t *testing.T, input string, maximum int) {
		if maximum < 0 {
			maximum = 0
		}
		maximum %= 256
		bounded := boundedText(input, maximum)
		if len([]rune(bounded)) > maximum {
			t.Fatalf("bounded text exceeded rune limit: %d > %d", len([]rune(bounded)), maximum)
		}
		items := cleanList([]string{input, input, " " + input + " ", ""})
		seen := map[string]bool{}
		for _, item := range items {
			if item == "" || item != boundedText(item, len([]rune(item))) || seen[item] {
				t.Fatalf("cleanList invariant failed for %q in %#v", item, items)
			}
			seen[item] = true
		}
	})
}
