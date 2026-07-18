package video

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBackupRestoreRoundTripAndTamperBoundaries(t *testing.T) {
	key := []byte("backup-integrity-key-that-is-long-enough")
	root := t.TempDir()
	store, err := OpenStore(root, key)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.update(func(state *State) error {
		state.Channels["channel-1"] = &Channel{ID: "channel-1", Owner: "ynx1owner", Handle: "owner", Name: "Owner"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "objects", "owned.bin"), []byte("owned-media"), 0600); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	if err = CreateBackup(root, key, &archive, time.Unix(1_700_000_000, 0)); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "restored")
	if err = RestoreBackup(destination, key, bytes.NewReader(archive.Bytes())); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenStore(destination, key)
	if err != nil {
		t.Fatal(err)
	}
	if err = restored.read(func(state State) error {
		if state.Channels["channel-1"] == nil {
			t.Fatal("channel missing after restore")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	object, err := os.ReadFile(filepath.Join(destination, "objects", "owned.bin"))
	if err != nil || string(object) != "owned-media" {
		t.Fatalf("restored object mismatch: %q %v", object, err)
	}
	wrongKey := []byte("wrong-integrity-key-that-is-long-enough")
	if err = RestoreBackup(filepath.Join(t.TempDir(), "wrong-key"), wrongKey, bytes.NewReader(archive.Bytes())); err == nil {
		t.Fatal("wrong integrity key accepted")
	}
}

func TestRestoreRejectsTraversalAndNonEmptyDestination(t *testing.T) {
	var archive bytes.Buffer
	gz := gzip.NewWriter(&archive)
	tw := tar.NewWriter(gz)
	body := []byte("escape")
	if err := tw.WriteHeader(&tar.Header{Name: "../escape", Mode: 0600, Size: int64(len(body)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	_, _ = tw.Write(body)
	_ = tw.Close()
	_ = gz.Close()
	if err := RestoreBackup(filepath.Join(t.TempDir(), "restore"), []byte("restore-key-that-is-long-enough-32"), bytes.NewReader(archive.Bytes())); err == nil {
		t.Fatal("path traversal accepted")
	}
	destination := t.TempDir()
	if err := os.WriteFile(filepath.Join(destination, "keep"), []byte("user-data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := RestoreBackup(destination, []byte("restore-key-that-is-long-enough-32"), bytes.NewReader(nil)); err == nil {
		t.Fatal("non-empty destination accepted")
	}
}

func FuzzRestoreBackup(f *testing.F) {
	f.Add([]byte("not-an-archive"))
	f.Fuzz(func(t *testing.T, body []byte) {
		_ = RestoreBackup(filepath.Join(t.TempDir(), "restore"), []byte("fuzz-key-that-is-long-enough-12345"), bytes.NewReader(body))
	})
}
