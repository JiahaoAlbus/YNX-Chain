package cloud

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// PUBLIC host-file mutation at the actual current fences. No authority or
// Docker is represented; the real staging/receipt/resource code is exercised.
func TestIDEDeploymentStagedArtifactBindsActualFile(t *testing.T) {
	for _, scenario := range []string{"bytes-before-create", "bytes-before-start", "inode-before-start"} {
		t.Run(scenario, func(t *testing.T) {
			m := publicIDEOCIFixture(t)
			file := filepath.Join(m.e.cfg.StorageRoot, m.e.name(m.p.RequestID, m.p.ApprovalSHA256), "artifact.mjs")
			changed := false
			current := func() error {
				if changed {
					return nil
				}
				if _, err := os.Lstat(file); errors.Is(err, os.ErrNotExist) {
					return nil
				} else if err != nil {
					return err
				}
				if scenario == "bytes-before-create" && m.creates != 0 {
					return nil
				}
				if scenario != "bytes-before-create" && m.creates != 1 {
					return nil
				}
				changed = true
				if scenario == "inode-before-start" {
					if err := os.Rename(file, file+".original"); err != nil {
						return err
					}
					return os.WriteFile(file, m.body, 0444)
				}
				body := append([]byte(nil), m.body...)
				body[0] ^= 1
				if err := os.Chmod(file, 0600); err != nil {
					return err
				}
				if err := os.WriteFile(file, body, 0600); err != nil {
					return err
				}
				return os.Chmod(file, 0444)
			}
			_, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), current)
			if !changed || !errors.Is(err, ErrIDEArtifactInput) || m.starts != 0 {
				t.Fatalf("changed staged artifact executed: changed=%v err=%v creates=%d starts=%d", changed, err, m.creates, m.starts)
			}
			wantCreates := 1
			if scenario == "bytes-before-create" {
				wantCreates = 0
			}
			if m.creates != wantCreates {
				t.Fatal("effect crossed the wrong byte fence")
			}
			if wantCreates == 1 && createdRecordedID(t, createdReceiptPath(m)) != m.row.ID {
				t.Fatal("original create acknowledgment lost on staged-file refusal")
			}
			if _, err = m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err == nil || m.creates != wantCreates || m.starts != 0 {
				t.Fatal("artifact failure replayed the original attempt")
			}
		})
	}
}
