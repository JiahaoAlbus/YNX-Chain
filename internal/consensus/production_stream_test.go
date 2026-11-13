package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The input is a local PUBLIC synthetic file, not a migration-size estimate or
// a claim about the memory required to validate a complete migration object.
func TestProductionPackageHashesBoundedIO(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "public.bin")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.New()
	chunk := bytes.Repeat([]byte{0xa5}, 64<<10)
	for i := 0; i < 256; i++ {
		if _, err := io.MultiWriter(f, h).Write(chunk); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	got, err := packageFileHashes(root)
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatal(err)
	}
	if got["public.bin"] != hex.EncodeToString(h.Sum(nil)) {
		t.Fatal("complete file hash differs")
	}
	allocated := after.TotalAlloc - before.TotalAlloc
	t.Logf("synthetic inputBytes=%d hashAllocatedBytes=%d", len(chunk)*256, allocated)
	if allocated >= 4<<20 {
		t.Fatalf("package hashing retained file-sized allocation: %d", allocated)
	}
}

func TestProductionPackageStreamExactBytesAndLayouts(t *testing.T) {
	f := newProductionOperatorFixture(t, false, false)
	// Package generation declares the destination Linux custody paths; it does
	// not open them. Keep those original strict path rules independent of the
	// test runner's local TMPDIR (which may contain spaces/non-ASCII characters).
	// All keys used to construct this PUBLIC fixture remain in t.TempDir.
	for i := range f.plan.Roles {
		r := &f.plan.Roles[i]
		r.LegacyKeyPath = "/etc/ynx/test-public/" + r.Role + "/priv_validator_key.json"
		r.NodeKeyPath = "/etc/ynx/test-public/" + r.Role + "/node_key.json"
		r.LegacyStatePath = r.Home + "/data/priv_validator_state.json"
	}
	bound, err := bindProductionValidatorKeys(f.migration, f.validators)
	if err != nil {
		t.Fatal(err)
	}
	// Original complete encoder is the byte oracle, including the package LF.
	original, err := bound.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	original = append(original, '\n')
	for _, layout := range []string{"legacy", "atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "candidate")
			var manifest ProductionCandidatePackageManifest
			var pin string
			if layout == "legacy" {
				manifest, err = GenerateProductionCandidatePackage(f.migration, f.validators, root, f.genesisTime)
			} else {
				plan := f.plan
				plan.StateLayout = layout
				var raw []byte
				raw, pin = productionOperatorPlanBytes(t, plan)
				manifest, err = GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, root, f.genesisTime, raw, pin)
			}
			if err != nil {
				t.Fatal(err)
			}
			paths := []string{filepath.Join(root, "common", "bound-migration.json")}
			for _, role := range manifest.Roles {
				paths = append(paths, filepath.Join(root, "roles", role, "config", "bound-migration.json"))
			}
			var originals []os.FileInfo
			for _, path := range paths {
				raw, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(raw, original) {
					t.Fatal("complete original migration bytes differ", err)
				}
				info, err := os.Lstat(path)
				if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
					t.Fatal("migration permission or type differs", err)
				}
				for _, previous := range originals {
					if os.SameFile(previous, info) {
						t.Fatal("disk copies were replaced with a shared inode")
					}
				}
				originals = append(originals, info)
			}
			for relative, expected := range manifest.Files {
				raw, err := os.ReadFile(filepath.Join(root, relative))
				if err != nil {
					t.Fatal(err)
				}
				sum := sha256.Sum256(raw)
				if hex.EncodeToString(sum[:]) != expected {
					t.Fatal("original whole-byte hash differs")
				}
			}
			// A self-rehashed role copy must still be rejected by full byte equality.
			path := paths[1]
			changed := bytes.Clone(original)
			changed[len(changed)/2] ^= 1
			if err := os.WriteFile(path, changed, 0600); err != nil {
				t.Fatal(err)
			}
			relative, _ := filepath.Rel(root, path)
			sum := sha256.Sum256(changed)
			manifest.Files[relative] = hex.EncodeToString(sum[:])
			if err := writeJSON(filepath.Join(root, "package-manifest.json"), manifest, 0600); err != nil {
				t.Fatal(err)
			}
			if err := verifyProductionCandidatePackage(root, pin); err == nil {
				t.Fatal("rehashed unequal role migration accepted")
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(after, changed) {
				t.Fatal("rejected original bytes were modified")
			}
		})
	}
}

func TestProductionPackageStreamFailuresRetainOriginals(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "original")
	original := bytes.Repeat([]byte("PUBLIC exact bytes\n"), 10000)
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	t.Run("copy-independent-exclusive", func(t *testing.T) {
		destination := filepath.Join(root, "copy")
		if err := copyProductionPackageFile(path, destination); err != nil {
			t.Fatal(err)
		}
		a, _ := os.Stat(path)
		b, _ := os.Stat(destination)
		if os.SameFile(a, b) || b.Mode().Perm() != 0600 {
			t.Fatal("copy inode or permission differs")
		}
		if err := compareProductionPackageFileBytes(destination, original); err != nil {
			t.Fatal(err)
		}
		if err := copyProductionPackageFile(path, destination); err == nil {
			t.Fatal("existing destination overwritten")
		}
		retained, _ := os.ReadFile(destination)
		if !bytes.Equal(retained, original) {
			t.Fatal("existing bytes changed")
		}
	})
	for _, size := range []int{0, 1, productionPackageIOBufferBytes - 1, productionPackageIOBufferBytes, productionPackageIOBufferBytes + 1} {
		t.Run(fmt.Sprintf("eof-%d", size), func(t *testing.T) {
			input := bytes.Repeat([]byte{0x42}, size)
			file := filepath.Join(t.TempDir(), "public")
			if err := os.WriteFile(file, input, 0600); err != nil {
				t.Fatal(err)
			}
			if err := compareProductionPackageFileBytes(file, input); err != nil {
				t.Fatal(err)
			}
			if err := compareProductionPackageFileBytes(file, append(bytes.Clone(input), 0)); err == nil {
				t.Fatal("short file accepted")
			}
			if size > 0 {
				if err := compareProductionPackageFileBytes(file, input[:size-1]); err == nil {
					t.Fatal("trailing bytes accepted")
				}
				wrong := bytes.Clone(input)
				wrong[size-1] ^= 1
				if err := compareProductionPackageFileBytes(file, wrong); err == nil {
					t.Fatal("same length different bytes accepted")
				}
			}
		})
	}
	t.Run("failure-keeps-partial-and-first-cause", func(t *testing.T) {
		file := filepath.Join(root, "partial")
		cause := errors.New("test-only original write failure")
		err := writeProductionPackageFile(file, func(w io.Writer) error {
			if _, err := w.Write([]byte("partial public bytes")); err != nil {
				return err
			}
			return cause
		})
		if !errors.Is(err, cause) {
			t.Fatal("original error lost")
		}
		raw, readErr := os.ReadFile(file)
		if readErr != nil || string(raw) != "partial public bytes" {
			t.Fatal("uncertain partial removed or changed", readErr)
		}
	})
	t.Run("symlink-input-rejected", func(t *testing.T) {
		link := filepath.Join(root, "link")
		if err := os.Symlink(path, link); err != nil {
			t.Fatal(err)
		}
		if _, err := hashProductionPackageFile(link); err == nil {
			t.Fatal("symlink hashed")
		}
		if err := copyProductionPackageFile(link, filepath.Join(root, "bad-copy")); err == nil {
			t.Fatal("symlink copied")
		}
	})
	t.Run("held-file-replacement-and-first-cause", func(t *testing.T) {
		file := filepath.Join(t.TempDir(), "held")
		if err := os.WriteFile(file, original, 0600); err != nil {
			t.Fatal(err)
		}
		cause := errors.New("test-only original read failure")
		err := readProductionPackageFile(file, func(r io.Reader) error {
			if _, err := io.Copy(io.Discard, r); err != nil {
				return err
			}
			if err := os.Rename(file, file+".retained"); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(file, original, 0600); err != nil {
				t.Fatal(err)
			}
			return cause
		})
		if !errors.Is(err, cause) || !strings.Contains(err.Error(), "changed during complete read") {
			t.Fatal("replacement or original error lost")
		}
	})
	t.Run("same-inode-growth", func(t *testing.T) {
		file := filepath.Join(t.TempDir(), "held")
		if err := os.WriteFile(file, original, 0600); err != nil {
			t.Fatal(err)
		}
		err := readProductionPackageFile(file, func(r io.Reader) error {
			if _, err := io.Copy(io.Discard, r); err != nil {
				return err
			}
			f, err := os.OpenFile(file, os.O_WRONLY|os.O_APPEND, 0600)
			if err != nil {
				t.Fatal(err)
			}
			_, writeErr := f.Write([]byte{0})
			return errors.Join(writeErr, f.Close())
		})
		if err == nil {
			t.Fatal("growth accepted")
		}
	})
}
