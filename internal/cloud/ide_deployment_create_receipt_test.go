package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// PUBLIC engine responses only. The filesystem, resource lock, startup and
// restart consumer below are real; no genuine grant or Docker is supplied.
func createdReceiptPath(m *publicIDEOCI) string {
	return filepath.Join(m.e.cfg.StorageRoot, m.e.name(m.p.RequestID, m.p.ApprovalSHA256), "created-instance.json")
}
func createdResourcePath(m *publicIDEOCI) string {
	return filepath.Join(m.e.cfg.StorageRoot, "resource-"+productHash([]byte(m.p.ResourceID))+".json")
}
func createdUnknownOperation(m *publicIDEOCI) IDEDeploymentOperation {
	op := m.operation()
	op.DeploymentID = ""
	op.PublisherID = m.p.PublisherID
	op.RuntimeHandle = productHash([]byte(m.p.Principal + "\x00" + m.p.RequestID))
	return op
}
func createdRecordedID(t *testing.T, file string) string {
	t.Helper()
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var record struct {
		Version   int                    `json:"version"`
		Operation IDEDeploymentOperation `json:"operation"`
	}
	if err = json.Unmarshal(raw, &record); err != nil || record.Version != 1 || record.Operation.State != "unknown" {
		t.Fatalf("invalid durable unknown receipt: %v", err)
	}
	return record.Operation.DeploymentID
}
func TestIDEDeploymentCreatedIDDurableBeforeCurrentFailure(t *testing.T) {
	m := publicIDEOCIFixture(t)
	denied := errors.New("PUBLIC current revoked after create")
	_, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error {
		if m.creates > 0 {
			return denied
		}
		return nil
	})
	if !errors.Is(err, denied) || m.creates != 1 || m.starts != 0 {
		t.Fatalf("late current: %v %d/%d", err, m.creates, m.starts)
	}
	for _, file := range []string{createdReceiptPath(m), createdResourcePath(m)} {
		if createdRecordedID(t, file) != m.row.ID {
			t.Fatal("actual created ID not preserved before current check")
		}
	}
	m.calls = nil
	m.row.State.Status = "exited"
	m.row.State.ExitCode = 0
	reopened := *m.e
	result, err := reopened.ObserveOriginal(context.Background(), createdUnknownOperation(m))
	if err != nil || result.DeploymentID != m.row.ID || result.State != "completed" {
		t.Fatalf("original receipt recovery: %#v %v", result, err)
	}
	if len(m.calls) != 1 || !strings.HasSuffix(m.calls[0], m.row.ID) || m.creates != 1 || m.starts != 0 {
		t.Fatal("recovery used mutable name or executed")
	}
}
func TestIDEDeploymentCreatedIDAcknowledgmentSurvivesCancellationOrError(t *testing.T) {
	for _, kind := range []string{"cancel", "partial-error"} {
		t.Run(kind, func(t *testing.T) {
			m := publicIDEOCIFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			cause := errors.New("PUBLIC original create returned an uncertain acknowledgment")
			base := m.e.run
			m.e.run = func(c context.Context, args ...string) ([]byte, error) {
				body, err := base(c, args...)
				if args[0] == "create" {
					if kind == "cancel" {
						cancel()
					} else {
						return body, cause
					}
				}
				return body, err
			}
			_, err := m.e.ApplyExisting(ctx, m.p, bytes.NewReader(m.body), func() error { return ctx.Err() })
			if kind == "cancel" {
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("lost cancellation: %v", err)
				}
			} else if !errors.Is(err, cause) {
				t.Fatalf("lost original first cause: %v", err)
			}
			if m.creates != 1 || m.starts != 0 {
				t.Fatal("uncertain create was started or replayed")
			}
			for _, file := range []string{createdReceiptPath(m), createdResourcePath(m)} {
				if createdRecordedID(t, file) != m.row.ID {
					t.Fatal("acknowledged ID lost")
				}
			}
		})
	}
}
func TestIDEDeploymentCreatedReceiptPrecedesReservationPublication(t *testing.T) {
	m := publicIDEOCIFixture(t)
	base := m.e.run
	partial := []byte("PUBLIC first damaged reservation; retain me")
	m.e.run = func(c context.Context, args ...string) ([]byte, error) {
		body, err := base(c, args...)
		if args[0] == "create" {
			if e := os.WriteFile(createdResourcePath(m), partial, 0600); e != nil {
				t.Fatal(e)
			}
		}
		return body, err
	}
	if _, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err == nil || m.starts != 0 {
		t.Fatal("reservation failure permitted start")
	}
	if createdRecordedID(t, createdReceiptPath(m)) != m.row.ID {
		t.Fatal("independent receipt lost with reservation failure")
	}
	raw, err := os.ReadFile(createdResourcePath(m))
	if err != nil || !bytes.Equal(raw, partial) {
		t.Fatal("damaged original reservation overwritten")
	}
}
func TestIDEDeploymentCreatedPartialReceiptRemainsUnknown(t *testing.T) {
	m := publicIDEOCIFixture(t)
	base := m.e.run
	partial := []byte("PUBLIC partial receipt; retain me")
	m.e.run = func(c context.Context, args ...string) ([]byte, error) {
		body, err := base(c, args...)
		if args[0] == "create" {
			if e := os.WriteFile(createdReceiptPath(m), partial, 0600); e != nil {
				t.Fatal(e)
			}
		}
		return body, err
	}
	if _, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err == nil || m.starts != 0 {
		t.Fatal("partial receipt permitted start")
	}
	raw, err := os.ReadFile(createdReceiptPath(m))
	if err != nil || !bytes.Equal(raw, partial) {
		t.Fatal("partial receipt erased or rewritten")
	}
	m.calls = nil
	if _, err = m.e.ObserveOriginal(context.Background(), createdUnknownOperation(m)); err == nil || len(m.calls) != 0 {
		t.Fatal("corrupt receipt fell back to a container name")
	}
	if _, err = m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err == nil || m.creates != 1 {
		t.Fatal("uncertain creation replayed")
	}
}
func TestIDEDeploymentCreatedCrashBeforeReceiptNeverGuessesName(t *testing.T) {
	m := publicIDEOCIFixture(t)
	release, err := m.e.acquireResource(context.Background(), m.p, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	release()
	m.row.State.Status = "exited"
	m.row.State.ExitCode = 0
	if _, err = m.e.ObserveOriginal(context.Background(), createdUnknownOperation(m)); err == nil || len(m.calls) != 0 {
		t.Fatal("missing receipt promoted same-name container")
	}
	next := m.p
	next.RequestID = "PUBLIC_next_request_123456"
	next.ApprovalSHA256 = strings.Repeat("f", 64)
	unlock, err := m.e.acquireResource(context.Background(), next, func() error { return nil })
	if unlock != nil {
		unlock()
	}
	if !errors.Is(err, ErrIDEResourceBusy) || m.creates != 0 || m.starts != 0 {
		t.Fatal("receipt-less UNKNOWN freed a resource")
	}
}
func TestIDEDeploymentCreatedCrashAfterReceiptRecoversWithoutRepublishing(t *testing.T) {
	m := publicIDEOCIFixture(t)
	base := m.e.run
	var before []byte
	m.e.run = func(c context.Context, args ...string) ([]byte, error) {
		if args[0] == "create" {
			var err error
			before, err = os.ReadFile(createdResourcePath(m))
			if err != nil {
				t.Fatal(err)
			}
		}
		return base(c, args...)
	}
	if _, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	// Retain the actual first UNKNOWN bytes to model death after receipt sync but
	// before the reservation's ID publication. Do not mint an acknowledgment.
	if err := os.WriteFile(createdResourcePath(m), before, 0600); err != nil {
		t.Fatal(err)
	}
	m.calls = nil
	reopened := *m.e
	result, err := reopened.ObserveOriginal(context.Background(), createdUnknownOperation(m))
	if err != nil || result.DeploymentID != m.row.ID || result.State != "running" {
		t.Fatalf("receipt-only recovery: %#v %v", result, err)
	}
	if len(m.calls) != 1 || !strings.HasSuffix(m.calls[0], m.row.ID) || m.creates != 1 || m.starts != 1 {
		t.Fatal("restart looked up a name or replayed an effect")
	}
	if raw, err := os.ReadFile(createdResourcePath(m)); err != nil || !bytes.Equal(raw, before) {
		t.Fatal("query rewrote the original reservation")
	}
}
func TestIDEDeploymentCreatedAcknowledgmentCannotSelectReplacement(t *testing.T) {
	m := publicIDEOCIFixture(t)
	base := m.e.run
	original := m.row.ID
	m.e.run = func(c context.Context, args ...string) ([]byte, error) {
		body, err := base(c, args...)
		if args[0] == "create" {
			m.row.ID = strings.Repeat("e", 64)
		}
		return body, err
	}
	if _, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err == nil || m.starts != 0 {
		t.Fatal("different instance inspected as the create acknowledgment")
	}
	if createdRecordedID(t, createdReceiptPath(m)) != original {
		t.Fatal("original returned ID replaced")
	}
}
func TestIDEDeploymentCreatedMalformedIDNeverStarts(t *testing.T) {
	m := publicIDEOCIFixture(t)
	base := m.e.run
	m.e.run = func(c context.Context, args ...string) ([]byte, error) {
		body, err := base(c, args...)
		if args[0] == "create" {
			body = []byte("PUBLIC_not_an_immutable_container_ID")
		}
		return body, err
	}
	if _, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err == nil || m.starts != 0 {
		t.Fatal("malformed acknowledgment guessed from inspection")
	}
	if _, err := os.Lstat(createdReceiptPath(m)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("fabricated receipt exists")
	}
}
func TestIDEDeploymentCreatedReceiptBindsOriginalReservation(t *testing.T) {
	for _, field := range []string{"publisher", "artifact", "manifest", "approval", "runtime", "resource-ref"} {
		t.Run(field, func(t *testing.T) {
			m := publicIDEOCIFixture(t)
			if _, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err != nil {
				t.Fatal(err)
			}
			op := createdUnknownOperation(m)
			switch field {
			case "publisher":
				op.PublisherID = "PUBLIC_other"
			case "artifact":
				op.Binding.ContentDigest = strings.Repeat("e", 64)
			case "manifest":
				op.ManifestSHA256 = strings.Repeat("e", 64)
			case "approval":
				op.ApprovalSHA256 = strings.Repeat("e", 64)
			case "runtime":
				op.RuntimeSeconds++
			case "resource-ref":
				op.ResourceApprovalRef = "PUBLIC_other"
			}
			m.calls = nil
			if _, err := m.e.ObserveOriginal(context.Background(), op); err == nil || len(m.calls) != 0 {
				t.Fatal("different reservation borrowed an instance receipt")
			}
		})
	}
}
