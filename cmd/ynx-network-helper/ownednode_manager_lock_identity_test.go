//go:build darwin || linux

package main_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

func TestNetworkOwnedNodeManagerLockIdentity(t *testing.T) {
	peer := ownedPeer(t)
	for _, kind := range []string{"original", "hardlink", "modified-marker", "symlink", "wrong-mode", "missing-marker", "same-bytes-replacement"} {
		t.Run(kind, func(t *testing.T) {
			cfg := ownedConfig(t)
			m, err := ownednode.New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = m.Close(context.Background()) }()
			installOwnedFixture(t, m, peer)
			lockPath := filepath.Join(cfg.Directory, "manager.lock")
			statePath := filepath.Join(cfg.Directory, "manager.json")
			read := func(path string) []byte {
				t.Helper()
				raw, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				return raw
			}
			original := read(lockPath)
			journal := read(statePath)
			originalArtifact, err := m.ManagedArtifactReadback(peer)
			if err != nil {
				t.Fatal(err)
			}
			alias := filepath.Join(filepath.Dir(cfg.Directory), "outside-lock")
			var target []byte
			replaced := kind == "missing-marker" || kind == "same-bytes-replacement"
			switch kind {
			case "hardlink":
				err = os.Link(lockPath, alias)
				target = original
			case "modified-marker":
				target = bytes.Repeat([]byte("x"), len(original))
				err = os.WriteFile(lockPath, target, 0600)
			case "symlink":
				if err = os.Rename(lockPath, alias); err == nil {
					err = os.Symlink(alias, lockPath)
				}
				target = original
			case "wrong-mode":
				err = os.Chmod(lockPath, 0400)
			case "missing-marker", "same-bytes-replacement":
				err = os.Rename(lockPath, alias)
				if err == nil && kind == "same-bytes-replacement" {
					err = os.WriteFile(lockPath, original, 0600)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if kind != "original" {
				if _, err := m.Prepare(peer, "start", ""); !errors.Is(err, ownednode.ErrUnsafePath) {
					t.Errorf("changed live owner permitted a new intent: %v", err)
				}
				if _, err := m.ManagedArtifactReadback(peer); !errors.Is(err, ownednode.ErrUnsafePath) {
					t.Errorf("changed live owner presented an installed artifact: %v", err)
				}
			}
			if replaced {
				other, err := ownednode.New(cfg)
				if err == nil {
					ownedClose(t, other)
					t.Error("second owner acquired a new lock inode while the original manager still held its lock")
				}
				if kind == "missing-marker" {
					if _, err := os.Lstat(lockPath); !errors.Is(err, os.ErrNotExist) {
						t.Fatalf("contention should leave a missing marker absent: %v", err)
					}
				} else {
					source, sourceErr := os.Stat(alias)
					replacement, replacementErr := os.Stat(lockPath)
					if sourceErr != nil || replacementErr != nil || os.SameFile(source, replacement) ||
						!bytes.Equal(read(lockPath), original) {
						t.Fatalf("replacement or original lock was changed: %v %v", sourceErr, replacementErr)
					}
					// Preserve the injected replacement outside the original name
					// when restoring the fixture's original marker.
					if err := os.Rename(lockPath, alias+".replacement"); err != nil {
						t.Fatal(err)
					}
				}
				if !bytes.Equal(read(alias), original) || !bytes.Equal(read(statePath), journal) {
					t.Fatal("second owner mutated retained original bytes")
				}
				if err := os.Rename(alias, lockPath); err != nil {
					t.Fatal(err)
				}
				if second, err := ownednode.New(cfg); err == nil {
					ownedClose(t, second)
					t.Fatal("restored marker bypassed the live manager")
				}
			}
			closeErr := m.Close(context.Background())
			if kind == "original" || replaced {
				if closeErr != nil {
					t.Errorf("valid owner close failed: %v", closeErr)
				}
			} else if !errors.Is(closeErr, ownednode.ErrUnsafePath) {
				t.Errorf("close omitted the ownership failure: %v", closeErr)
			}
			if !m.PhysicalReleased() {
				t.Fatal("close did not release the original ownership")
			}
			next, err := ownednode.New(cfg)
			if kind == "original" || replaced {
				if err != nil {
					t.Fatal(err)
				}
				defer ownedClose(t, next)
				artifact, err := next.ManagedArtifactReadback(peer)
				if err != nil || artifact != originalArtifact {
					t.Fatalf("normal original lock changed managed artifact: %+v %v", artifact, err)
				}
				if !bytes.Equal(read(lockPath), original) {
					t.Fatal("normal reopen rewrote the original lock")
				}
			} else if err == nil {
				ownedClose(t, next)
				t.Error("cold reopen accepted changed owner")
			}
			if !bytes.Equal(read(statePath), journal) {
				t.Error("ownership check modified the installed journal")
			}
			if target != nil && !bytes.Equal(read(lockPath), target) {
				t.Error("ownership check changed the original lock bytes")
			}
			if (kind == "hardlink" || kind == "symlink") && !bytes.Equal(read(alias), target) {
				t.Error("ownership check changed the retained alias target")
			}
		})
	}
}
