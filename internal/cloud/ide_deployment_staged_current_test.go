package cloud

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// PUBLIC current callbacks drive the real production ordering and file IO.
// They do not stand in for a genuine Auth Source or deploy authorization.
func TestIDEDeploymentStagedFinalCurrentFence(t *testing.T) {
	for _, phase := range []string{"create", "start"} {
		for _, reason := range []string{"revoke", "expire", "cancel"} {
			t.Run(phase+"/"+reason, func(t *testing.T) {
				m := publicIDEOCIFixture(t)
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				now := time.Now()
				m.e.now = func() time.Time { return now }
				file := filepath.Join(m.e.cfg.StorageRoot, m.e.name(m.p.RequestID, m.p.ApprovalSHA256), "artifact.mjs")
				gates := 0
				denied := errors.New("PUBLIC permission revoked after digest")
				current := func() error {
					if _, err := os.Lstat(file); errors.Is(err, os.ErrNotExist) {
						return nil
					} else if err != nil {
						return err
					}
					if (phase == "create" && m.creates != 0) || (phase == "start" && m.creates != 1) {
						return nil
					}
					gates++
					if gates == 2 {
						switch reason {
						case "revoke":
							return denied
						case "expire":
							now = m.p.ExpiresAt.Add(time.Second)
						case "cancel":
							cancel()
						}
					}
					return nil
				}
				_, err := m.e.ApplyExisting(ctx, m.p, bytes.NewReader(m.body), current)
				if err == nil || gates != 2 || m.starts != 0 {
					t.Fatalf("missing post-digest current fence: err=%v gates=%d creates=%d starts=%d", err, gates, m.creates, m.starts)
				}
				switch reason {
				case "revoke":
					if !errors.Is(err, denied) {
						t.Fatal("original revocation cause lost")
					}
				case "expire":
					if !errors.Is(err, ErrDenied) {
						t.Fatal("late expiry admitted")
					}
				case "cancel":
					if !errors.Is(err, context.Canceled) {
						t.Fatal("late cancellation admitted")
					}
				}
				want := 0
				if phase == "start" {
					want = 1
				}
				if m.creates != want {
					t.Fatal("wrong effect crossed the final fence")
				}
				if want == 1 && createdRecordedID(t, createdReceiptPath(m)) != m.row.ID {
					t.Fatal("original acknowledged instance was discarded")
				}
			})
		}
	}
}

func TestIDEDeploymentStagedCurrentCannotChangeVerifiedFile(t *testing.T) {
	for _, kind := range []string{"bytes-restored-mtime", "inode"} {
		t.Run(kind, func(t *testing.T) {
			m := publicIDEOCIFixture(t)
			file := filepath.Join(m.e.cfg.StorageRoot, m.e.name(m.p.RequestID, m.p.ApprovalSHA256), "artifact.mjs")
			gates := 0
			changed := false
			current := func() error {
				info, err := os.Lstat(file)
				if errors.Is(err, os.ErrNotExist) {
					return nil
				}
				if err != nil {
					return err
				}
				if m.creates != 0 {
					return nil
				}
				gates++
				if gates != 2 {
					return nil
				}
				changed = true
				if kind == "inode" {
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
				if err := os.Chmod(file, 0444); err != nil {
					return err
				}
				return os.Chtimes(file, info.ModTime(), info.ModTime())
			}
			_, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), current)
			if !changed || !errors.Is(err, ErrIDEArtifactInput) || m.creates != 0 || m.starts != 0 {
				t.Fatalf("current changed verified bytes: changed=%v err=%v creates=%d starts=%d", changed, err, m.creates, m.starts)
			}
		})
	}
}
