package exchangeproduct

import (
	"errors"
	"os"
	"testing"
)

// These tests exercise the existing file-CAS service with isolated test Wallet
// sessions, not a public Wallet approval or a new write-scope grant.
func TestOwnedSupportIdempotencyIsolationAndRestart(t *testing.T) {
	s, _, path := newTestService(t)
	a := accountSession(t, s, alice, "support-alice", "exchange:read")
	b := accountSession(t, s, bob, "support-bob", "exchange:read")
	const category, message, key = "account", "Please review my account settings.", "owned-support-retry"
	created, err := s.CreateSupport(a.session, category, message, key)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, service := range []*Service{s, reopenSupportService(t, s.cfg)} {
		retry, err := service.CreateSupport(a.session, category, message, key)
		if err != nil || retry != created {
			t.Fatalf("same-owner retry changed record: %v", err)
		}
		other, err := service.CreateSupport(b.session, category, message, key)
		if !errors.Is(err, ErrConflict) || other != (SupportCase{}) {
			t.Fatalf("cross-owner retry must return conflict without a case; conflict=%v returnedCase=%v", errors.Is(err, ErrConflict), other != (SupportCase{}))
		}
		if _, err := service.CreateSupport(a.session, category, message+" Changed.", key); !errors.Is(err, ErrConflict) {
			t.Fatal("changed intent reused key")
		}
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("retries changed durable state or audit")
	}
}

func reopenSupportService(t *testing.T, cfg Config) *Service {
	t.Helper()
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestOwnedSupportMissingRecordFailsClosed(t *testing.T) {
	s, _, _ := newTestService(t)
	a := accountSession(t, s, alice, "support-missing", "exchange:read")
	const key = "owned-support-missing"
	created, err := s.CreateSupport(a.session, "account", "Please review my account settings.", key)
	if err != nil {
		t.Fatal(err)
	}
	// A dangling idempotency reference must never produce a successful empty case.
	delete(s.state.Support, created.ID)
	before := digest(s.state)
	result, err := s.CreateSupport(a.session, "account", "Please review my account settings.", key)
	if !errors.Is(err, ErrConflict) || result != (SupportCase{}) {
		t.Fatal("missing referenced case did not fail closed")
	}
	if digest(s.state) != before {
		t.Fatal("failed retry mutated state")
	}
}

func TestOwnedSupportCASFailureRecoversAuthoritativeOwner(t *testing.T) {
	s, _, path := newTestService(t)
	a := accountSession(t, s, alice, "support-cas-alice", "exchange:read")
	b := accountSession(t, s, bob, "support-cas-bob", "exchange:read")
	stale := reopenSupportService(t, s.cfg)
	winner, err := s.CreateSupport(a.session, "account", "Please review my account settings.", "owned-support-winner")
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	result, err := stale.CreateSupport(b.session, "account", "Please review my account settings.", "owned-support-stale")
	if !errors.Is(err, ErrConflict) || result != (SupportCase{}) {
		t.Fatal("stale CAS unexpectedly committed")
	}
	if len(stale.state.Support) != 1 || stale.state.Support[winner.ID] != winner {
		t.Fatal("CAS failure did not recover authoritative records")
	}
	if _, exists := stale.state.Idempotency["owned-support-stale"]; exists {
		t.Fatal("failed CAS retained retry record")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("failed CAS changed persisted state")
	}
	created, err := stale.CreateSupport(b.session, "account", "Please review my account settings.", "owned-support-stale")
	if err != nil || created.Account != bob {
		t.Fatalf("explicit retry after CAS recovery failed: %v", err)
	}
	restarted := reopenSupportService(t, s.cfg)
	if len(restarted.state.Support) != 2 || restarted.state.Support[winner.ID] != winner || restarted.state.Support[created.ID] != created {
		t.Fatal("restart lost owned cases")
	}
}
