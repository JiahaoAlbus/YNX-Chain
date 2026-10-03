package music

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestPlaylistCreateLostReplyReplaysOriginalRecord(t *testing.T) {
	f := testFixture(t)
	svc := testService(t)
	auth := centralAuth(t, svc, f)
	defer auth.Close()
	track := publishTrack(t, svc, f.account, false)
	handler := NewServer(svc, "https://music.ynx.test", nil).Handler()
	body := map[string]any{"name": "Recovery playlist", "description": "Original description", "trackIDs": []string{track.ID}}
	first := protectedWithKey(t, handler, http.MethodPost, "/api/playlists", body, f, "playlist-lost-reply")
	if first.Code != 201 {
		t.Fatalf("first create: %d %s", first.Code, first.Body.String())
	}
	var original Playlist
	json.Unmarshal(first.Body.Bytes(), &original)
	// Client did not observe the first response. A retry still carries the same
	// saved intent, but obtains fresh normal request authentication.
	retry := protectedWithKey(t, handler, http.MethodPost, "/api/playlists", body, f, "playlist-lost-reply")
	var recovered Playlist
	json.Unmarshal(retry.Body.Bytes(), &recovered)
	if retry.Code != 201 || original.ID != recovered.ID || len(svc.Playlists(f.account)) != 1 {
		t.Fatalf("lost response minted duplicate: first=%s retry=%s count=%d", first.Body.String(), retry.Body.String(), len(svc.Playlists(f.account)))
	}
	body["name"] = "Changed retry body"
	conflict := protectedWithKey(t, handler, http.MethodPost, "/api/playlists", body, f, "playlist-lost-reply")
	if conflict.Code != 409 || len(svc.Playlists(f.account)) != 1 {
		t.Fatalf("changed intent reused key: %d %s", conflict.Code, conflict.Body.String())
	}
}

func TestPlaylistRecoverySurvivesConcurrencyRestartAndLaterEdits(t *testing.T) {
	svc := testService(t)
	actor := testAccount(t, 3)
	other := testAccount(t, 4)
	track := publishTrack(t, svc, actor, false)
	const key = "playlist-concurrent-intent"
	results := make(chan Playlist, 24)
	errs := make(chan error, 24)
	for i := 0; i < 24; i++ {
		go func() {
			p, err := svc.CreatePlaylistIdempotent(actor, "Original", "Retained", []string{track.ID}, key)
			results <- p
			errs <- err
		}()
	}
	var first Playlist
	for i := 0; i < 24; i++ {
		p := <-results
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
		if first.ID == "" {
			first = p
		}
		if first.ID != p.ID {
			t.Fatalf("duplicate concurrent IDs: %s %s", first.ID, p.ID)
		}
	}
	created := 0
	for _, event := range svc.state.Audit {
		if event.Type == "playlist_created" {
			created++
		}
	}
	if len(svc.Playlists(actor)) != 1 || created != 1 {
		t.Fatalf("creation not atomic: playlists=%d audit=%d", len(svc.Playlists(actor)), created)
	}
	if _, err := svc.UpdatePlaylist(actor, first.ID, "Later edit", "Keep this edit", nil); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(svc.cfg)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := reopened.CreatePlaylistIdempotent(actor, "Original", "Retained", []string{track.ID}, key)
	if err != nil || recovered.ID != first.ID || recovered.Name != "Later edit" || len(recovered.TrackIDs) != 0 {
		t.Fatalf("retry overwrote later edit: %#v %v", recovered, err)
	}
	if _, err := reopened.CreatePlaylistIdempotent(other, "Original", "Retained", nil, key); err != nil {
		t.Fatal(err)
	}
	if len(reopened.Playlists(other)) != 1 || reopened.Playlists(other)[0].ID == first.ID {
		t.Fatal("idempotency key crossed owners")
	}
	if err := reopened.VerifyIntegrity(); err != nil {
		t.Fatal(err)
	}
}
