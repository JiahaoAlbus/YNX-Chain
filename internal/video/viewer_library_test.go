package video

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestViewerLibraryRemovalIsAccountScopedAndPersistent(t *testing.T) {
	s, channel := fixture(t, nil)
	video := upload(t, s, channel, "Library source")
	approveTestPublication(t, s, channel.Owner, video.ID)
	if err := s.Publish(channel.Owner, video.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	owner, other := testOwnerAccount, testAttackerAccount
	playlist, err := s.CreatePlaylist(owner, "Saved")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.AddToPlaylist(owner, playlist.ID, video.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Subscribe(owner, channel.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Subscribe(other, channel.ID); err != nil {
		t.Fatal(err)
	}
	for _, call := range []func() error{
		func() error { return s.DeletePlaylist(other, playlist.ID) },
		func() error { return s.RemoveFromPlaylist(other, playlist.ID, video.ID) },
	} {
		if err := call(); !errors.Is(err, ErrForbidden) {
			t.Fatalf("cross-account mutation accepted: %v", err)
		}
	}
	if err = s.RemoveFromPlaylist(owner, playlist.ID, video.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Unsubscribe(owner, channel.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Unsubscribe(owner, channel.ID); err != nil {
		t.Fatal("unsubscribe should be idempotent", err)
	}
	restarted, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	lists, err := restarted.Playlists(owner)
	if err != nil || len(lists) != 1 || len(lists[0].VideoIDs) != 0 {
		t.Fatalf("removed entry restored: %+v %v", lists, err)
	}
	subscriptions, err := restarted.Subscriptions(owner)
	if err != nil || len(subscriptions) != 0 {
		t.Fatalf("removed subscription restored: %+v %v", subscriptions, err)
	}
	otherSubscriptions, err := restarted.Subscriptions(other)
	if err != nil || len(otherSubscriptions) != 1 {
		t.Fatalf("another account was modified: %+v %v", otherSubscriptions, err)
	}
	if err = restarted.DeletePlaylist(owner, playlist.ID); err != nil {
		t.Fatal(err)
	}
	final, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	lists, err = final.Playlists(owner)
	if err != nil || len(lists) != 0 {
		t.Fatalf("deleted list restored: %+v %v", lists, err)
	}
	if _, err = final.Video("", video.ID); err != nil {
		t.Fatal("source video was removed by library operation", err)
	}
}

func TestLibraryCannotSaveAnotherAccountsPrivateVideo(t *testing.T) {
	s, channel := fixture(t, nil)
	private := upload(t, s, channel, "Private source")
	playlist, err := s.CreatePlaylist(testAttackerAccount, "Saved")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.AddToPlaylist(testAttackerAccount, playlist.ID, private.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("private video was added: %v", err)
	}
	lists, err := s.Playlists(testAttackerAccount)
	if err != nil || len(lists) != 1 || len(lists[0].VideoIDs) != 0 {
		t.Fatalf("private video ID leaked into library: %+v %v", lists, err)
	}
}

func TestViewerLibraryDeleteHTTPRoutes(t *testing.T) {
	s, channel := fixture(t, nil)
	video := upload(t, s, channel, "Owned source")
	playlist, err := s.CreatePlaylist(channel.Owner, "Saved")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.AddToPlaylist(channel.Owner, playlist.ID, video.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Subscribe(channel.Owner, channel.ID); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner": channel.Owner, "other": testAttackerAccount}}).Handler()
	counter := 0
	call := func(path, token string) int {
		counter++
		r := httptest.NewRequest(http.MethodDelete, path, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		r.Header.Set("Idempotency-Key", fmt.Sprintf("library-delete-%04d", counter))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Code
	}
	for _, item := range []struct {
		path, token string
		want        int
	}{
		{"/v1/playlists/" + playlist.ID, "", 401},
		{"/v1/playlists/" + playlist.ID, "other", 403},
		{"/v1/playlists/" + playlist.ID + "/videos/" + video.ID, "other", 403},
		{"/v1/playlists/" + playlist.ID + "/videos/" + video.ID, "owner", 200},
		{"/v1/playlists/" + playlist.ID + "/videos/" + video.ID, "owner", 404},
		{"/v1/channels/" + channel.ID + "/subscription", "owner", 200},
		{"/v1/playlists/" + playlist.ID, "owner", 200},
		{"/v1/playlists/" + playlist.ID, "owner", 404},
	} {
		if got := call(item.path, item.token); got != item.want {
			t.Fatalf("%s %s: got %d want %d", item.token, item.path, got, item.want)
		}
	}
}
