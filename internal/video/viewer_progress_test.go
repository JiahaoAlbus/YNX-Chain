package video

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func viewerMutation(handler http.Handler, method, path, token, key, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", "viewer-test-"+key)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestExplicitSubscriptionSurvivesConcurrentTabsAndRestart(t *testing.T) {
	s, channel := fixture(t, nil)
	handler := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner": channel.Owner, "other": testAttackerAccount}}).Handler()
	path := "/v1/channels/" + channel.ID + "/subscription"
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if w := viewerMutation(handler, "PUT", path, "owner", fmt.Sprintf("subscribe-tab-%d", i), "{}"); w.Code != 200 {
				t.Errorf("explicit subscription: %d %s", w.Code, w.Body.String())
			}
		}(i)
	}
	wg.Wait()
	if w := viewerMutation(handler, "PUT", path, "other", "subscribe-other", "{}"); w.Code != 200 {
		t.Fatalf("other subscription: %d %s", w.Code, w.Body.String())
	}
	restarted, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	for _, actor := range []string{channel.Owner, testAttackerAccount} {
		items, err := restarted.Subscriptions(actor)
		if err != nil || len(items) != 1 {
			t.Fatalf("subscription lost after restart for %s: %+v %v", actor, items, err)
		}
	}
	if w := viewerMutation(handler, "PUT", path, "", "subscribe-guest", "{}"); w.Code != 401 {
		t.Fatalf("guest accepted: %d", w.Code)
	}
	if w := viewerMutation(handler, "PUT", "/v1/channels/chn_missing/subscription", "owner", "subscribe-missing", "{}"); w.Code != 404 {
		t.Fatalf("missing channel accepted: %d", w.Code)
	}
}

func TestPlaybackProgressAccumulatesOneViewAndCompletionAcrossRestart(t *testing.T) {
	s, channel := fixture(t, nil)
	v := upload(t, s, channel, "Playback progress")
	approveTestPublication(t, s, channel.Owner, v.ID)
	if err := s.Publish(channel.Owner, v.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	auth := StaticTokenAuth{Tokens: map[string]string{"owner": channel.Owner, "other": testAttackerAccount}}
	handler := NewServer(s, auth).Handler()
	path := "/v1/videos/" + v.ID + "/watch"
	playbackID := "86c396de-69d3-40b4-bc03-e1e7ba800680"
	body := func(seconds int, completed bool) string {
		return fmt.Sprintf(`{"playback_id":%q,"seconds":%d,"completed":%t}`, playbackID, seconds, completed)
	}
	for _, item := range []struct{ key, body string }{{"progress-batch-one", body(4, false)}, {"progress-batch-one", body(4, false)}, {"progress-batch-two", body(3, false)}, {"progress-complete", body(0, true)}} {
		if w := viewerMutation(handler, "POST", path, "owner", item.key, item.body); w.Code != 200 {
			t.Fatalf("progress: %d %s", w.Code, w.Body.String())
		}
	}
	restarted, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	history, err := restarted.History(channel.Owner)
	if err != nil || len(history) != 1 || history[0].Seconds != 7 || !history[0].Completed {
		t.Fatalf("progress not recovered: %+v %v", history, err)
	}
	a, err := restarted.Analytics(channel.Owner)
	if err != nil || a.Views != 1 || a.CompletedViews != 1 || a.WatchSeconds != 7 || a.Coverage.WatchEventCount != 1 {
		t.Fatalf("flushes fabricated views: %+v %v", a, err)
	}
	handler = NewServer(restarted, auth).Handler()
	// A completion marker cannot create a view with no observed playback.
	if w := viewerMutation(handler, "POST", path, "other", "progress-empty-complete", body(0, true)); w.Code != 200 {
		t.Fatalf("empty completion: %d %s", w.Code, w.Body.String())
	}
	other, err := restarted.History(testAttackerAccount)
	if err != nil || len(other) != 0 {
		t.Fatalf("zero-second view created: %+v %v", other, err)
	}
	if w := viewerMutation(handler, "POST", path, "other", "legacy-empty-complete", `{"seconds":0,"completed":true}`); w.Code != 200 {
		t.Fatalf("legacy empty completion: %d %s", w.Code, w.Body.String())
	}
	other, err = restarted.History(testAttackerAccount)
	if err != nil || len(other) != 0 {
		t.Fatalf("legacy zero-second view created: %+v %v", other, err)
	}
	// The same client ID in another account cannot join the owner's event.
	if w := viewerMutation(handler, "POST", path, "other", "progress-other-account", body(2, false)); w.Code != 200 {
		t.Fatalf("other playback: %d %s", w.Code, w.Body.String())
	}
	other, err = restarted.History(testAttackerAccount)
	if err != nil || len(other) != 1 || other[0].Seconds != 2 || other[0].Completed {
		t.Fatalf("account progress mixed: %+v %v", other, err)
	}
	// An older non-completion update must not undo the recorded completion.
	if w := viewerMutation(handler, "POST", path, "owner", "progress-after-restart", body(1, false)); w.Code != 200 {
		t.Fatalf("restart progress: %d %s", w.Code, w.Body.String())
	}
	history, _ = restarted.History(channel.Owner)
	if len(history) != 1 || history[0].Seconds != 8 || !history[0].Completed {
		t.Fatalf("completion reversed: %+v", history)
	}
}
