package chain

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type offlinePQOwnerFixture struct {
	os.FileInfo
	sys any
}

func (f offlinePQOwnerFixture) Sys() any { return f.sys }

func TestOfflinePQScheduledCopyOwnerMetadataFailsClosed(t *testing.T) {
	info, err := os.Stat(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if os.Geteuid() >= 0 && !offlinePQOwnedByEffectiveUser(info) {
		t.Fatal("actual private directory owner not recognized")
	}
	for _, bad := range []os.FileInfo{nil, offlinePQOwnerFixture{info, nil}, offlinePQOwnerFixture{info, struct{}{}}, offlinePQOwnerFixture{info, struct{ Uid string }{"0"}}, offlinePQOwnerFixture{info, struct{ Uid uint32 }{^uint32(os.Geteuid())}}} {
		if offlinePQOwnedByEffectiveUser(bad) {
			t.Fatalf("unknown or different owner accepted: %#v", bad)
		}
	}
}

func TestOfflinePQScheduledCopyFaultsRetainOriginalAttempt(t *testing.T) {
	for _, name := range []string{"source-writer", "target-replaced", "post-persistence-error"} {
		t.Run(name, func(t *testing.T) {
			source, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), source)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := d.Faucet("ynx_offline_copy_fixture", 50); err != nil {
				t.Fatal(err)
			}
			d.ProduceBlock()
			before, err := ExportConsensusMigrationCheckpoint(source)
			if err != nil {
				t.Fatal(err)
			}
			original, err := os.ReadFile(filepath.Join(source, "devnet-state.json"))
			if err != nil {
				t.Fatal(err)
			}
			parent, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(parent, 0700); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(parent, "copy")
			pins := OfflinePQCopyPins{OriginalGenesisHash: before.OriginalGenesisHash, SourceStateHash: before.StateHash, SourceHeight: before.Height, AdmissionHeight: before.Height + 10}
			fault := errors.New("synthetic post-persistence failure")
			hook := func() error {
				switch name {
				case "source-writer":
					return os.WriteFile(filepath.Join(source, "devnet-state.json.tmp"), []byte("simulated unfinished source write"), 0600)
				case "target-replaced":
					if err := os.Rename(target, target+".retained"); err != nil {
						return err
					}
					return os.Mkdir(target, 0700)
				default:
					return fault
				}
			}
			result, err := prepareOfflinePQScheduledCopy(source, target, pins, hook, nil)
			if !errors.Is(err, ErrOfflinePQCopyUnknown) || result != (OfflinePQCopyResult{}) {
				t.Fatal("uncertain operation returned a success result", result, err)
			}
			if name == "post-persistence-error" && !errors.Is(err, fault) {
				t.Fatal("original failure cause was lost", err)
			}
			retained := target
			if name == "target-replaced" {
				retained += ".retained"
			}
			if _, err := os.Lstat(filepath.Join(retained, "devnet-state.json")); err != nil {
				t.Fatal("original attempted copy was not retained", err)
			}
			if _, err := os.Lstat(target); err != nil {
				t.Fatal("reserved target disappeared", err)
			}
			raw, err := os.ReadFile(filepath.Join(source, "devnet-state.json"))
			if err != nil || !bytes.Equal(raw, original) {
				t.Fatal("copy operation changed the original snapshot", err)
			}
		})
	}
}
