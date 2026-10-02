package music

import (
	"bytes"
	"errors"
	"os"
	"testing"
)

func TestPlaybackCompletionReplayRemainsBoundToActorTrackAndSession(t *testing.T) {
	s := testService(t)
	owner, listener, other := testAccount(t, 1), testAccount(t, 2), testAccount(t, 3)
	first, second := publishTrack(t, s, owner, false), publishTrack(t, s, owner, false)
	_, original, err := s.SavePosition(listener, first.ID, "persistent-play-session", 1000, true)
	if err != nil || original == nil {
		t.Fatalf("initial completion failed: %#v %v", original, err)
	}
	before, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, usage, err := s.SavePosition(listener, second.ID, "persistent-play-session", 1200, true); !errors.Is(err, ErrConflict) || usage != nil {
		t.Fatalf("cross-track session reuse was not rejected: usage=%#v err=%v", usage, err)
	}
	after, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("conflicting completion changed history, accounting, or audit")
	}
	if len(s.state.Usage) != 1 || s.state.Idempotency[listener+":persistent-play-session"] != original.ID {
		t.Fatal("conflict changed inherited ledger key or created a second payable usage")
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	_, replay, err := restarted.SavePosition(listener, first.ID, "persistent-play-session", 1100, true)
	if err != nil || replay == nil || replay.ID != original.ID || replay.TrackID != first.ID {
		t.Fatalf("same-track legacy replay failed: %#v %v", replay, err)
	}
	_, independent, err := restarted.SavePosition(other, second.ID, "persistent-play-session", 1200, true)
	if err != nil || independent == nil || independent.Listener != other || independent.TrackID != second.ID || independent.ID == original.ID {
		t.Fatalf("separate actor's completion was not independently bound: %#v %v", independent, err)
	}
	if len(restarted.state.Usage) != 2 {
		t.Fatal("usage ledger has duplicate or missing independent records")
	}
}

func TestPlaybackCompletionCannotBypassExplicitPreferenceOrMissingLedgerRecord(t *testing.T) {
	s := testService(t)
	owner, listener := testAccount(t, 4), testAccount(t, 5)
	explicit := publishTrack(t, s, owner, true)
	if _, _, err := s.SavePosition(listener, explicit.ID, "forbidden-play", 1200, true); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("explicit playback accounting bypassed access rule: %v", err)
	}
	track := publishTrack(t, s, owner, false)
	if err := s.mutate(listener, "test_legacy_receipt", track.ID, nil, func(st *persistentState) error {
		st.Idempotency[listener+":missing-receipt"] = "use_missing"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, usage, err := s.SavePosition(listener, track.ID, "missing-receipt", 1200, true); !errors.Is(err, ErrConflict) || usage != nil {
		t.Fatalf("missing receipt became successful empty usage: %#v %v", usage, err)
	}
	if len(s.state.Usage) != 0 {
		t.Fatal("failed completion created an accounting record")
	}
}
