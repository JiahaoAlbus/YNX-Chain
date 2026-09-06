package video

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLegacyStateMigratesAfterIntegrityVerification(t *testing.T) {
	root := t.TempDir()
	key := []byte("test-video-integrity-key-32-bytes!!")
	legacy := emptyState()
	legacy.SchemaVersion = 0
	legacy.Videos["vid_legacy"] = &Video{ID: "vid_legacy", Owner: "ynx1legacy", ChannelID: "chn_legacy", Title: "Legacy", Visibility: VisibilityPrivate, Status: "ready", SHA256: "legacy-sha", CreatedAt: time.Unix(1, 0).UTC(), UpdatedAt: time.Unix(2, 0).UTC()}
	legacy.TeamInvites = nil
	legacy.TeamMembers = nil
	legacy.Rights = nil
	legacy.Integrity = ""
	canonical, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(canonical)
	legacy.Integrity = hex.EncodeToString(mac.Sum(nil))
	body, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(root, "objects"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "state.json"), body, 0600); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore(root, key)
	if err != nil {
		t.Fatalf("legacy integrity was checked after schema mutation: %v", err)
	}
	if store.state.SchemaVersion != 3 || store.state.TeamInvites == nil || store.state.TeamMembers == nil || store.state.Rights == nil {
		t.Fatalf("legacy state was not normalized: %+v", store.state)
	}
	migrated := store.state.Videos["vid_legacy"]
	if migrated == nil || migrated.WorkflowState != WorkflowDraft || migrated.Version != 1 || len(migrated.Versions) != 1 || migrated.Versions[0].Kind != "workflow.migration" {
		t.Fatalf("legacy video lifecycle was not migrated: %+v", migrated)
	}
	if err = store.update(func(*State) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err = OpenStore(root, key); err != nil {
		t.Fatalf("migrated state did not reopen: %v", err)
	}
}

func TestStoreUpdateRollsBackFailedMutation(t *testing.T) {
	root := t.TempDir()
	key := []byte("test-video-integrity-key-32-bytes!!")
	store, err := OpenStore(root, key)
	if err != nil {
		t.Fatal(err)
	}
	expected := errors.New("reject mutation")
	err = store.update(func(st *State) error {
		st.Channels["chn_rejected"] = &Channel{ID: "chn_rejected", Owner: "ynx1owner", Handle: "rejected", Name: "Rejected", CreatedAt: time.Now().UTC()}
		return expected
	})
	if !errors.Is(err, expected) {
		t.Fatalf("unexpected update result: %v", err)
	}
	if _, exists := store.state.Channels["chn_rejected"]; exists {
		t.Fatal("failed mutation leaked into memory")
	}
	if _, err = os.Stat(filepath.Join(root, "state.json")); !os.IsNotExist(err) {
		t.Fatalf("failed first mutation wrote state: %v", err)
	}
}
