package social

import (
	"bytes"
	"errors"
	"path/filepath"
	"testing"
)

// Product authority is synthetic. Business deletion and signed state file
// persistence/cold decoding use the original Social implementations.
func TestMomentDeleteLostResponseColdRetryPreservesOriginalTombstone(t *testing.T) {
	f := newFixture(t, 109)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.feed")
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	moment, _, err := s.CreateMoment(actor, "delete-recovery-original", "Original", "private", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteMoment(actor, moment.ID); err != nil {
		t.Fatal(err)
	}

	path, key := filepath.Join(t.TempDir(), "original-state.json"), bytes.Repeat([]byte{31}, 32)
	if err := saveState(path, &s.state, key); err != nil {
		t.Fatal(err)
	}
	cold, exists, err := loadState(path, key)
	if err != nil || !exists {
		t.Fatalf("cold decode: exists=%v err=%v", exists, err)
	}
	s.state = cold
	before := objectDigest(s.state)
	if err := s.DeleteMoment(actor, moment.ID); err != nil {
		t.Fatalf("original retry: %v", err)
	}
	if objectDigest(s.state) != before {
		t.Fatal("retry changed original tombstone/audit")
	}
	if err := s.DeleteMoment(actor, "missing-original"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown object: %v", err)
	}

	// Even a readable current actor cannot learn another account's tombstone.
	retained := s.state.Moments[moment.ID]
	retained.Author = newFixture(t, 110).account
	s.state.Moments[moment.ID] = retained
	before = objectDigest(s.state)
	if err := s.DeleteMoment(actor, moment.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("different author: %v", err)
	}
	if objectDigest(s.state) != before {
		t.Fatal("different author mutated state")
	}

	retained.Author = actor.Account
	s.state.Moments[moment.ID] = retained
	actor.revalidateProduct = func(string) error { return ErrUnauthorized }
	before = objectDigest(s.state)
	if err := s.DeleteMoment(actor, moment.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("revoked actor replay: %v", err)
	}
	if objectDigest(s.state) != before {
		t.Fatal("revoked actor changed state")
	}
}
