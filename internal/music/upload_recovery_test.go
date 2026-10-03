package music

import (
	"bytes"
	"errors"
	"os"
	"sync"
	"testing"
)

func TestUploadIntentConcurrentRestartConflictAndOwnerIsolation(t *testing.T) {
	s := testService(t)
	actor, other := testAccount(t, 3), testAccount(t, 4)
	for _, account := range []string{actor, other} {
		if _, err := s.OnboardCreator(account, "Original artist", ""); err != nil {
			t.Fatal(err)
		}
	}
	wav := toneWAV(500)
	request := func() TrackUpload {
		return TrackUpload{RequestKey: "music-upload-original-intent", Title: "Original content", ArtistName: "Original artist", Audio: Upload{Reader: bytes.NewReader(wav)}, AudioProvenance: "Original generated fixture", RightsBasis: "owned", Territories: []string{"WORLDWIDE"}, EvidenceRef: "Owned fixture evidence"}
	}
	var wait sync.WaitGroup
	results := make(chan Track, 16)
	errs := make(chan error, 16)
	for i := 0; i < 16; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			track, err := s.UploadTrack(actor, request())
			results <- track
			errs <- err
		}()
	}
	wait.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var original Track
	for track := range results {
		if original.ID == "" {
			original = track
		}
		if original.ID != track.ID {
			t.Fatal("concurrent upload duplicated original content")
		}
	}
	if len(s.state.Tracks) != 1 {
		t.Fatal("duplicate durable tracks")
	}
	files, err := os.ReadDir(s.cfg.MediaDir)
	if err != nil || len(files) != 1 {
		t.Fatalf("uncommitted candidate media leaked: %d %v", len(files), err)
	}
	if _, err = s.SetRelease(actor, original.ID, "published", ""); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := reopened.UploadTrack(actor, request())
	if err != nil || retry.ID != original.ID || retry.ReleaseState != "published" {
		t.Fatalf("cold retry replaced later release: %#v %v", retry, err)
	}
	changed := request()
	changed.Title = "Changed content"
	if _, err = reopened.UploadTrack(actor, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed title reused upload intent: %v", err)
	}
	changed = request()
	changed.Audio.Reader = bytes.NewReader(toneWAV(600))
	if _, err = reopened.UploadTrack(actor, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed audio reused upload intent: %v", err)
	}
	different, err := reopened.UploadTrack(other, request())
	if err != nil || different.ID == original.ID || different.Owner != other {
		t.Fatalf("upload intent crossed owners: %#v %v", different, err)
	}
	if len(reopened.state.Tracks) != 2 {
		t.Fatal("conflict or replay mutated content")
	}
	created := 0
	for _, event := range reopened.state.Audit {
		if event.Type == "track_uploaded" {
			created++
		}
	}
	if created != 2 {
		t.Fatalf("replay emitted duplicate upload audit: %d", created)
	}
	files, err = os.ReadDir(s.cfg.MediaDir)
	if err != nil || len(files) != 2 {
		t.Fatalf("replay/conflict candidate cleanup: %d %v", len(files), err)
	}
	if err = reopened.VerifyIntegrity(); err != nil {
		t.Fatal(err)
	}
}
