package payproduct

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// Original Store/fact-fence tests only. No Source grant, Native keys, signing,
// network dispatch or funds are created by these projection fixtures.
func merchantFenceFixture(t *testing.T) (*Store, string, string, string) {
	t.Helper()
	s, err := OpenStore(filepath.Join(t.TempDir(), "original-state.json"), bytes.Repeat([]byte{0x43}, 32))
	if err != nil {
		t.Fatal(err)
	}
	principal := "0x1111111111111111111111111111111111111111"
	account, err := accountaddress.Encode(principal)
	if err != nil {
		t.Fatal(err)
	}
	id := "mrc_original_fence"
	at := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	if err = s.Update(func(data *Snapshot) error {
		data.Merchants[id] = Merchant{ID: id, CentralMerchantID: "original-central", PayoutAddress: account, Status: "active", CreatedAt: at}
		data.MerchantMembers[id+":"+account] = MerchantMember{ID: "mem_original", MerchantID: id, Account: account, Role: "owner", Status: "active", CreatedAt: at, UpdatedAt: at}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return s, id, principal, account
}
func TestNativeMerchantFenceLockSafeAndRevokedBeforeFinalCommit(t *testing.T) {
	s, id, principal, account := merchantFenceFixture(t)
	f, err := s.CaptureNativeMerchantFence(id, principal, principal, true)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		done <- s.Update(func(data *Snapshot) error {
			for i := 0; i < 100; i++ {
				if err := f.Current(); err != nil {
					return err
				}
			}
			if data.BusinessDispatches == nil {
				data.BusinessDispatches = map[string]BusinessDispatchRecord{}
			}
			data.BusinessDispatches["unrelated"] = BusinessDispatchRecord{Operation: "read-only-unit-reference"}
			return nil
		})
	}()
	select {
	case err = <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Current re-entered original Store lock")
	}
	if err = f.Current(); err != nil {
		t.Fatal("unrelated journal write invalidated merchant role", err)
	}
	if err = s.Update(func(data *Snapshot) error {
		m := data.MerchantMembers[id+":"+account]
		m.Status = "revoked"
		data.MerchantMembers[id+":"+account] = m
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	err = s.Update(func(data *Snapshot) error {
		if err := f.Current(); err != nil {
			return err
		}
		if data.BusinessDispatches == nil {
			data.BusinessDispatches = map[string]BusinessDispatchRecord{}
		}
		data.BusinessDispatches["stale-final-commit"] = BusinessDispatchRecord{}
		return nil
	})
	if !errors.Is(err, ErrNativeMerchantFenceUnavailable) {
		t.Fatal("revoked role reached final commit", err)
	}
	_ = s.View(func(data Snapshot) error {
		if _, ok := data.BusinessDispatches["stale-final-commit"]; ok {
			t.Fatal("denied mutation persisted")
		}
		return nil
	})
	cold, err := OpenStore(s.path, s.integrityKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = cold.CaptureNativeMerchantFence(id, principal, principal, true); !errors.Is(err, ErrNativeMerchantFenceUnavailable) {
		t.Fatal("cold Store forgot role revoke", err)
	}
}
func TestNativeMerchantFenceScopedCommitABAAndIndependentAssociation(t *testing.T) {
	s, id, principal, account := merchantFenceFixture(t)
	member, err := s.CaptureNativeMerchantFence(id, principal, principal, true)
	if err != nil {
		t.Fatal(err)
	}
	association, err := s.CaptureNativeMerchantFence(id, "original-product-principal", principal, false)
	if err != nil {
		t.Fatal(err)
	}
	// This fixture exercises the existing scoped Store commit, not authorization.
	child := &Store{parent: s, authorize: func() (func(*Snapshot) error, error) { return func(*Snapshot) error { return nil }, nil }, consume: func(*Snapshot) error { return nil }, afterCommit: func() {
		if member.Current() == nil {
			t.Error("afterCommit ran before role generation publication")
		}
	}}
	if err = child.Update(func(data *Snapshot) error {
		m := data.MerchantMembers[id+":"+account]
		m.Role = "viewer"
		data.MerchantMembers[id+":"+account] = m
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err = association.Current(); err != nil {
		t.Fatal("role-only change retired an independent association read", err)
	}
	if _, err = s.CaptureNativeMerchantFence(id, principal, principal, true); err == nil {
		t.Fatal("viewer acquired invoice role fence")
	}
	if err = s.Update(func(data *Snapshot) error {
		m := data.MerchantMembers[id+":"+account]
		m.Role = "owner"
		data.MerchantMembers[id+":"+account] = m
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if member.Current() == nil {
		t.Fatal("revoke/regrant revived old handle")
	}
	if _, err = s.CaptureNativeMerchantFence(id, principal, principal, true); err != nil {
		t.Fatal("fresh original role capture failed", err)
	}
	if err = s.Update(func(data *Snapshot) error {
		m := data.Merchants[id]
		m.Status = "inactive"
		data.Merchants[id] = m
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if association.Current() == nil {
		t.Fatal("inactive merchant retained an association read")
	}
}
func TestNativeMerchantFenceFailedPersistenceDoesNotPublishRevoke(t *testing.T) {
	s, id, principal, account := merchantFenceFixture(t)
	f, err := s.CaptureNativeMerchantFence(id, principal, principal, true)
	if err != nil {
		t.Fatal(err)
	}
	original := s.path
	blocked := filepath.Join(filepath.Dir(original), "existing-directory")
	if err = os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	s.path = blocked
	err = s.Update(func(data *Snapshot) error {
		m := data.MerchantMembers[id+":"+account]
		m.Status = "revoked"
		data.MerchantMembers[id+":"+account] = m
		return nil
	})
	s.path = original
	if err == nil {
		t.Fatal("failed durable write claimed successful revoke")
	}
	if err = f.Current(); err != nil {
		t.Fatal("failed write published an uncommitted authority state", err)
	}
	cold, err := OpenStore(original, s.integrityKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = cold.CaptureNativeMerchantFence(id, principal, principal, true); err != nil {
		t.Fatal("failed write changed original durable facts", err)
	}
}
func TestNativeMerchantFenceConcurrentCommitReads(t *testing.T) {
	s, id, principal, account := merchantFenceFixture(t)
	f, err := s.CaptureNativeMerchantFence(id, principal, principal, true)
	if err != nil {
		t.Fatal(err)
	}
	var readers sync.WaitGroup
	stop := make(chan struct{})
	for i := 0; i < 8; i++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_ = f.Current()
				}
			}
		}()
	}
	for i := 0; i < 8; i++ {
		if err = s.Update(func(data *Snapshot) error {
			m := data.MerchantMembers[id+":"+account]
			if m.Role == "owner" {
				m.Role = "finance"
			} else {
				m.Role = "owner"
			}
			data.MerchantMembers[id+":"+account] = m
			return nil
		}); err != nil {
			close(stop)
			readers.Wait()
			t.Fatal(err)
		}
	}
	close(stop)
	readers.Wait()
	if f.Current() == nil {
		t.Fatal("concurrent committed authority changes kept old handle")
	}
}
