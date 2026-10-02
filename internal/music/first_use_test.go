package music

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestFreshVerifiedAccountSnapshotPersistsIdentityAndEmptyCollections(t *testing.T) {
	s := testService(t)
	fixture := testFixture(t)
	central := centralAuth(t, s, fixture)
	defer central.Close()
	other := testAccount(t, 8)
	if _, err := s.OnboardCreator(other, "Other Creator", "Retained biography"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePlaylist(other, "Private empty playlist", "", nil); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(s, "", nil).Handler()
	response := protected(t, handler, http.MethodGet, "/api/me?account="+other, nil, fixture)
	if response.Code != http.StatusOK {
		t.Fatalf("first authenticated snapshot = %d: %s", response.Code, response.Body.String())
	}
	var snapshot struct {
		Profile       Profile                    `json:"profile"`
		Listener      map[string]json.RawMessage `json:"listener"`
		Playlists     []Playlist                 `json:"playlists"`
		CreatorTracks []Track                    `json:"creatorTracks"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Profile.Account != fixture.account || snapshot.Profile.CreatorStatus != "listener" || !snapshot.Profile.PrivateHistory {
		t.Fatalf("new identity or private defaults are incorrect: %#v", snapshot.Profile)
	}
	for _, key := range []string{"favorites", "queue", "history"} {
		if !bytes.Equal(snapshot.Listener[key], []byte("[]")) {
			t.Errorf("listener.%s must be an empty array, got %s", key, snapshot.Listener[key])
		}
	}
	for _, key := range []string{"downloads", "positions"} {
		if !bytes.Equal(snapshot.Listener[key], []byte("{}")) {
			t.Errorf("listener.%s must be an empty object, got %s", key, snapshot.Listener[key])
		}
	}
	if len(snapshot.Playlists) != 0 || len(snapshot.CreatorTracks) != 0 {
		t.Fatal("another account's private creator/playlist data appeared in new workspace")
	}
	before, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	if got := protected(t, handler, http.MethodGet, "/api/me", nil, fixture); got.Code != http.StatusOK {
		t.Fatalf("repeat snapshot = %d", got.Code)
	}
	after, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("repeat sign-in mutated an existing workspace")
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	profile, err := restarted.Profile(fixture.account)
	if err != nil || profile.Account != fixture.account || !profile.CreatedAt.Equal(snapshot.Profile.CreatedAt) {
		t.Fatalf("first-use identity did not survive service restart: %#v %v", profile, err)
	}
	if _, err := restarted.Snapshot(fixture.account); err != nil {
		t.Fatal(err)
	}
	otherProfile, err := restarted.Profile(other)
	if err != nil || otherProfile.DisplayName != "Other Creator" || otherProfile.CreatorStatus != "active" {
		t.Fatal("new account initialization modified another profile")
	}
}

func TestFreshAccountInitializationFailureReturnsErrorWithoutMemoryCommit(t *testing.T) {
	s := testService(t)
	fixture := testFixture(t)
	central := centralAuth(t, s, fixture)
	defer central.Close()
	blocker := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("retain"), 0o600); err != nil {
		t.Fatal(err)
	}
	s.cfg.StatePath = filepath.Join(blocker, "state.json")
	response := protected(t, NewServer(s, "", nil).Handler(), http.MethodGet, "/api/me", nil, fixture)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("failed persistence returned %d instead of error: %s", response.Code, response.Body.String())
	}
	if _, err := s.Profile(fixture.account); !errors.Is(err, ErrNotFound) {
		t.Fatalf("failed initialization exposed a profile in memory: %v", err)
	}
	if len(s.state.Listeners) != 0 || len(s.state.Audit) != 0 {
		t.Fatal("failed initialization changed listener or audit")
	}
	if _, err := s.Snapshot("unverified-client-name"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("unverified account text accepted: %v", err)
	}
}

func TestConcurrentFirstUseInitializesOnlyOnceAndPreservesLaterOnboarding(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 7)
	var workers sync.WaitGroup
	failures := make(chan error, 12)
	for i := 0; i < 12; i++ {
		workers.Add(1)
		go func() { defer workers.Done(); _, err := s.Snapshot(actor); failures <- err }()
	}
	workers.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(s.state.Audit) != 1 || len(s.state.Profiles) != 1 || len(s.state.Listeners) != 1 {
		t.Fatalf("first-use wrote duplicate state/audit: profiles=%d listeners=%d audit=%d", len(s.state.Profiles), len(s.state.Listeners), len(s.state.Audit))
	}
	profile, err := s.OnboardCreator(actor, "Actual Artist", "Artist supplied biography")
	if err != nil || profile.DisplayName != "Actual Artist" || profile.Bio != "Artist supplied biography" || profile.CreatorStatus != "active" || !profile.PrivateHistory {
		t.Fatalf("onboarding after default profile did not retain user input/preferences: %#v %v", profile, err)
	}
	if _, err := s.OnboardCreator(actor, "", ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid creator name accepted: %v", err)
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	profile, err = restarted.Profile(actor)
	if err != nil || profile.DisplayName != "Actual Artist" || profile.CreatorStatus != "active" {
		t.Fatal("onboarding did not survive restart")
	}
}
