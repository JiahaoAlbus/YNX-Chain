package social

import (
	"bytes"
	"errors"
	"path/filepath"
	"testing"
)

// Real Social state persistence and methods; synthetic current authority only.
func TestReactionColdReplayReturnsOriginalNotLatestDisplayResult(t *testing.T) {
	f := newFixture(t, 111)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.feed")
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	moment, _, err := s.CreateMoment(actor, "reaction-original-moment", "Original", "private", nil)
	if err != nil {
		t.Fatal(err)
	}
	original, replay, err := s.SetMomentReaction(actor, moment.ID, "original-like-key", "like", true)
	if err != nil || replay {
		t.Fatalf("first: %v replay=%v", err, replay)
	}
	latest, _, err := s.SetMomentReaction(actor, moment.ID, "later-love-key", "love", true)
	if err != nil {
		t.Fatal(err)
	}
	path, key := filepath.Join(t.TempDir(), "original-state.json"), bytes.Repeat([]byte{32}, 32)
	if err := saveState(path, &s.state, key); err != nil {
		t.Fatal(err)
	}
	cold, exists, err := loadState(path, key)
	if err != nil || !exists {
		t.Fatalf("cold: exists=%v err=%v", exists, err)
	}
	s.state = cold
	before := objectDigest(s.state)
	got, replay, err := s.SetMomentReaction(actor, moment.ID, "original-like-key", "like", true)
	if err != nil || !replay || got != original {
		t.Fatalf("original: got=%+v expected=%+v replay=%v err=%v", got, original, replay, err)
	}
	if s.state.MomentReactions[moment.ID+"|"+actor.Account] != latest || objectDigest(s.state) != before {
		t.Fatal("replay reverted later display or changed state")
	}
	if _, _, err := s.SetMomentReaction(actor, moment.ID, "original-like-key", "support", true); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed original: %v", err)
	}

	stateKey := idempotencyStateKey(actor.Account, "original-like-key")
	legacy := s.state.Idempotency[stateKey]
	legacy.ReactionResult = nil
	s.state.Idempotency[stateKey] = legacy
	before = objectDigest(s.state)
	if _, _, err := s.SetMomentReaction(actor, moment.ID, "original-like-key", "like", true); !errors.Is(err, ErrConflict) {
		t.Fatalf("legacy receipt substituted: %v", err)
	}
	if objectDigest(s.state) != before {
		t.Fatal("legacy receipt rewritten")
	}
	actor.revalidateProduct = func(string) error { return ErrUnauthorized }
	if _, _, err := s.SetMomentReaction(actor, moment.ID, "later-love-key", "love", true); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("stale original replay: %v", err)
	}
}
