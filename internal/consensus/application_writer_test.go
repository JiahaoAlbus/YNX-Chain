//go:build unix

package consensus

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestApplicationWriterLeaseExcludesCompetingEntrypointsAndPreservesState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "existing-state.json")
	original := []byte("isolated ledger and UNKNOWN preservation fixture")
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	lease, err := AcquireApplicationStateWriterLease(path)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	if competing, err := AcquireApplicationStateWriterLease(path); err == nil || competing != nil {
		t.Fatal("two production entrypoints acquired one state writer")
	}
	copy := *lease
	if err := copy.Close(); err != nil {
		t.Fatal(err)
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	again, err := AcquireApplicationStateWriterLease(path)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, original) {
		t.Fatal("writer lease changed original ledger")
	}
	if _, err := os.Stat(path + ".writer.lock"); err != nil {
		t.Fatal("close deleted the original lock file", err)
	}
}

func TestApplicationWriterLeaseRejectsUnsafeLockFiles(t *testing.T) {
	for _, mode := range []string{"symlink", "hardlink", "public"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			path, original := filepath.Join(dir, "state.json"), filepath.Join(dir, "original")
			if err := os.WriteFile(original, []byte("preserve"), 0o600); err != nil {
				t.Fatal(err)
			}
			var err error
			switch mode {
			case "symlink":
				err = os.Symlink(original, path+".writer.lock")
			case "hardlink":
				err = os.Link(original, path+".writer.lock")
			case "public":
				err = os.WriteFile(path+".writer.lock", nil, 0o644)
			}
			if err != nil {
				t.Fatal(err)
			}
			if lease, err := AcquireApplicationStateWriterLease(path); err == nil || lease != nil {
				t.Fatal("unsafe writer lock accepted")
			}
			if raw, err := os.ReadFile(original); err != nil || string(raw) != "preserve" {
				t.Fatal("lease changed existing file")
			}
		})
	}
}
