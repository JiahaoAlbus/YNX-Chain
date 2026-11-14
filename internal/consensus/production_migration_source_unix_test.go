//go:build unix

package consensus

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestProductionMigrationHeldRootChangesRefuse(t *testing.T) {
	_, _, _, doc, raw := productionReferencePackageFixture(t)
	for _, kind := range []string{"common-parent", "package-root", "leaf", "restored-mtime"} {
		t.Run(kind, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "package")
			if err := os.MkdirAll(filepath.Join(root, "common"), 0700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(root, "common", "bound-migration.json")
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			s, err := readProductionMigrationSource(path, doc.AppState)
			if err != nil {
				t.Fatal(err)
			}
			before, err := s.file.Stat()
			if err != nil {
				t.Fatal(err)
			}
			if kind == "restored-mtime" {
				changed := bytes.Clone(raw)
				changed[0] = ' '
				if err := os.WriteFile(path, changed, 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Chtimes(path, before.ModTime(), before.ModTime()); err != nil {
					t.Fatal(err)
				}
			} else {
				move := path
				if kind == "common-parent" {
					move = filepath.Dir(path)
				}
				if kind == "package-root" {
					move = root
				}
				if err := os.Rename(move, move+".original"); err != nil {
					t.Fatal(err)
				}
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
				// The held descriptor still points at the original inode: the
				// replacement path is never used as a new decode or comparison source.
				got, err := io.ReadAll(s.reader())
				if err != nil || !bytes.Equal(got, raw) {
					t.Fatal("held original changed", err)
				}
			}
			if _, err := s.hash(); err == nil {
				t.Fatal("changed source hash accepted")
			}
			if err := s.compareRole(path); err == nil {
				t.Fatal("changed source role accepted")
			}
			if err := s.close(); err == nil {
				t.Fatal("changed source cleanup hid failure")
			}
			if _, err := s.file.ReadAt(make([]byte, 1), 0); !errors.Is(err, os.ErrClosed) {
				t.Fatal("failure did not close held source", err)
			}
		})
	}
}
