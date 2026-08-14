package calendar

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCalendarBackupRestoreIsAuthenticatedDeterministicAndIsolated(t *testing.T) {
	livePath := filepath.Join(t.TempDir(), "live", "state.json")
	store, err := NewStore(livePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.update(func(state *State) error {
		state.Users["user-1"] = User{ID: "user-1", Handle: "@alice"}
		state.Events["event-1"] = Event{ID: "event-1", SeriesID: "event-1", OwnerID: "user-1", Title: "Restore drill", State: "scheduled", Version: 1}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	fixed := time.Date(2026, 7, 29, 2, 30, 0, 0, time.UTC)
	first, err := store.CreateBackupAt(fixed)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.CreateBackupAt(fixed)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("Calendar backup is not deterministic for identical state and timestamp")
	}
	restoreRoot := t.TempDir()
	result, err := store.RestoreBackupTo(restoreRoot, "drill/restored.json", first, fixed.Add(time.Minute), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if result.ProductID != ProductID || result.StateSchemaVersion != StateSchemaVersion || result.Users != 1 || result.Events != 1 {
		t.Fatalf("unexpected restore result: %+v", result)
	}
	restored, err := NewStore(filepath.Join(restoreRoot, result.Target))
	if err != nil {
		t.Fatal(err)
	}
	if err = restored.view(func(state State) error {
		if state.SchemaVersion != StateSchemaVersion || state.Events["event-1"].Title != "Restore drill" {
			t.Fatalf("restored Calendar state is incomplete: %+v", state)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = NewStore(livePath); err != nil {
		t.Fatalf("isolated restore modified the live Calendar store: %v", err)
	}
}

func TestCalendarRestoreRejectsInvalidInputs(t *testing.T) {
	livePath := filepath.Join(t.TempDir(), "live", "state.json")
	store, err := NewStore(livePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.update(func(state *State) error {
		state.Users["user-1"] = User{ID: "user-1", Handle: "@alice"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	fixed := time.Date(2026, 7, 29, 2, 30, 0, 0, time.UTC)
	body, err := store.CreateBackupAt(fixed)
	if err != nil {
		t.Fatal(err)
	}
	restoreRoot := t.TempDir()

	tampered := append([]byte(nil), body...)
	tampered[len(tampered)/2] ^= 1
	if _, err = store.RestoreBackupTo(restoreRoot, "tampered.json", tampered, fixed.Add(time.Minute), time.Hour); err == nil {
		t.Fatal("tampered Calendar backup was accepted")
	}

	mutateEnvelope := func(fn func(*backupEnvelope)) []byte {
		t.Helper()
		var envelope backupEnvelope
		if err := json.Unmarshal(body, &envelope); err != nil {
			t.Fatal(err)
		}
		fn(&envelope)
		out, err := json.Marshal(envelope)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	wrongProduct := mutateEnvelope(func(envelope *backupEnvelope) { envelope.ProductID = "com.ynx.mail" })
	if _, err = store.RestoreBackupTo(restoreRoot, "wrong-product.json", wrongProduct, fixed.Add(time.Minute), time.Hour); err == nil || !strings.Contains(err.Error(), "belongs to product") {
		t.Fatalf("wrong-product Calendar backup did not fail closed: %v", err)
	}
	wrongVersion := mutateEnvelope(func(envelope *backupEnvelope) { envelope.StateSchemaVersion = StateSchemaVersion + 1 })
	if _, err = store.RestoreBackupTo(restoreRoot, "wrong-version.json", wrongVersion, fixed.Add(time.Minute), time.Hour); err == nil || !strings.Contains(err.Error(), "state schema version") {
		t.Fatalf("incompatible Calendar backup did not fail closed: %v", err)
	}
	if _, err = store.RestoreBackupTo(restoreRoot, "stale.json", body, fixed.Add(2*time.Hour), time.Hour); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("stale Calendar backup did not fail closed: %v", err)
	}
	escapingTarget := filepath.Join("..", "escape.json")
	if _, err = store.RestoreBackupTo(restoreRoot, escapingTarget, body, fixed.Add(time.Minute), time.Hour); err == nil || !strings.Contains(err.Error(), "escapes") {
		t.Fatalf("path-escaping Calendar restore did not fail closed: %v", err)
	}
	absoluteTarget := filepath.Join(string(filepath.Separator), "absolute.json")
	if _, err = store.RestoreBackupTo(restoreRoot, absoluteTarget, body, fixed.Add(time.Minute), time.Hour); err == nil || !strings.Contains(err.Error(), "relative") {
		t.Fatalf("absolute Calendar restore target did not fail closed: %v", err)
	}
	outside := t.TempDir()
	linkPath := filepath.Join(restoreRoot, "linked")
	if err = os.Symlink(outside, linkPath); err == nil {
		if _, err = store.RestoreBackupTo(restoreRoot, "linked/restored.json", body, fixed.Add(time.Minute), time.Hour); err == nil || !strings.Contains(err.Error(), "symbolic link") {
			t.Fatalf("symlink-traversing Calendar restore did not fail closed: %v", err)
		}
	}
}

func TestCalendarLegacyStateSchemaNormalizesAndFutureSchemaFailsClosed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "calendar.json")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, version := range []int{0, 1} {
		legacy := emptyState()
		legacy.SchemaVersion = version
		legacy.CanonicalOutbox = nil
		legacyBytes, err := json.Marshal(legacy)
		if err != nil {
			t.Fatal(err)
		}
		legacyEnvelope := diskEnvelope{SchemaVersion: 1, State: legacyBytes, HMAC: base64.RawURLEncoding.EncodeToString(hmacSHA256(store.key, legacyBytes))}
		encodedLegacy, err := json.Marshal(legacyEnvelope)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, encodedLegacy, 0o600); err != nil {
			t.Fatal(err)
		}
		reloaded, err := NewStore(path)
		if err != nil {
			t.Fatal(err)
		}
		if err = reloaded.view(func(state State) error {
			if state.SchemaVersion != StateSchemaVersion || state.CanonicalOutbox == nil {
				t.Fatalf("legacy Calendar state schema %d was not normalized: %+v", version, state)
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}

	future := emptyState()
	future.SchemaVersion = StateSchemaVersion + 1
	futureBytes, err := json.Marshal(future)
	if err != nil {
		t.Fatal(err)
	}
	futureEnvelope := diskEnvelope{SchemaVersion: 1, State: futureBytes, HMAC: base64.RawURLEncoding.EncodeToString(hmacSHA256(store.key, futureBytes))}
	encodedFuture, err := json.Marshal(futureEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, encodedFuture, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err = NewStore(path); err == nil || !strings.Contains(err.Error(), "unsupported Calendar state schema version") {
		t.Fatalf("future Calendar state schema did not fail closed: %v", err)
	}
}
