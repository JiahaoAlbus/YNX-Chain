package cloud

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// PUBLIC original-container protocol seams only; no real engine/authority.
func TestIDEDeploymentResourceConcurrentClaimAndUnknownRemainBusy(t *testing.T) {
	m := publicIDEOCIFixture(t)
	release, err := m.e.acquireResource(context.Background(), m.p, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	next := m.p
	next.RequestID = "request_second_123456"
	next.ApprovalSHA256 = strings.Repeat("e", 64)
	if unlock, err := m.e.acquireResource(context.Background(), next, func() error { return nil }); !errors.Is(err, ErrIDEResourceBusy) {
		if unlock != nil {
			unlock()
		}
		t.Fatalf("concurrent cap multiplied: %v", err)
	}
	release()
	// A process restart does not turn the durable unknown record into a free slot.
	if unlock, err := m.e.acquireResource(context.Background(), next, func() error { return nil }); !errors.Is(err, ErrIDEResourceBusy) {
		if unlock != nil {
			unlock()
		}
		t.Fatalf("unknown slot released: %v", err)
	}
	if m.creates != 0 || m.starts != 0 {
		t.Fatal("read-only reconciliation executed")
	}
}
func TestIDEDeploymentResourceOriginalRunningThenActualTerminal(t *testing.T) {
	m := publicIDEOCIFixture(t)
	_, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	next := m.p
	next.RequestID = "request_second_123456"
	next.ApprovalSHA256 = strings.Repeat("e", 64)
	m.row.State.Running = true
	m.row.State.Status = "running"
	if unlock, err := m.e.acquireResource(context.Background(), next, func() error { return nil }); !errors.Is(err, ErrIDEResourceBusy) {
		if unlock != nil {
			unlock()
		}
		t.Fatal("running reservation released")
	}
	m.row.State.Running = false
	m.row.State.Status = "exited"
	m.row.State.ExitCode = 0
	unlock, err := m.e.acquireResource(context.Background(), next, func() error { return nil })
	if err != nil {
		t.Fatalf("confirmed prior exit did not release: %v", err)
	}
	unlock()
	if m.creates != 1 || m.starts != 1 {
		t.Fatal("reservation silently deployed")
	}
}
func TestIDEDeploymentResourceCurrentAndCorruptReservationDeny(t *testing.T) {
	m := publicIDEOCIFixture(t)
	denied := errors.New("PUBLIC_CURRENT_REVOKED")
	if unlock, err := m.e.acquireResource(context.Background(), m.p, func() error { return denied }); !errors.Is(err, denied) {
		if unlock != nil {
			unlock()
		}
		t.Fatal("revoked current admitted")
	}
	file := filepath.Join(m.e.cfg.StorageRoot, "resource-"+productHash([]byte(m.e.cfg.ResourceID))+".json")
	if err := os.WriteFile(file, []byte("{corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if unlock, err := m.e.acquireResource(context.Background(), m.p, func() error { return nil }); !errors.Is(err, ErrIDEResourceBusy) {
		if unlock != nil {
			unlock()
		}
		t.Fatal("corruption released resource")
	}
	raw, err := os.ReadFile(file)
	if err != nil || string(raw) != "{corrupt" {
		t.Fatal("first cause overwritten")
	}
}
