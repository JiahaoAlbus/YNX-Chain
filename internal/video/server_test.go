package video

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServerAuthStrictParsingAndModeratorBoundary(t *testing.T) {
	s, _ := fixture(t, nil)
	h := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner-token": "ynx1owner"}}).Handler()
	requestCounter := 0
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		requestCounter++
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		if method != http.MethodGet && method != http.MethodHead {
			r.Header.Set("Idempotency-Key", fmt.Sprintf("server-test-request-%04d", requestCounter))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request(http.MethodGet, "/health", "", ""); w.Code != http.StatusOK {
		t.Fatalf("health=%d", w.Code)
	}
	if w := request(http.MethodGet, "/v1/videos", "", ""); w.Code != http.StatusOK {
		t.Fatalf("public discovery=%d", w.Code)
	}
	if w := request(http.MethodGet, "/v1/history", "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("private route missing auth=%d", w.Code)
	}
	if w := request(http.MethodPost, "/v1/channels", "owner-token", `{"handle":"a","name":"A","unknown":true}`); w.Code != http.StatusBadRequest {
		t.Fatalf("unknown field accepted=%d %s", w.Code, w.Body.String())
	}
	if w := request(http.MethodPost, "/v1/reports/rpt_missing/moderate", "owner-token", `{"decision":"dismissed","explanation":"reviewed"}`); w.Code != http.StatusForbidden {
		t.Fatalf("moderator boundary=%d", w.Code)
	}
}

func TestHealthFailsClosedWhenMediaDependenciesAreMissing(t *testing.T) {
	s, err := NewService(Config{Root: t.TempDir(), IntegrityKey: []byte("test-video-integrity-key-32-bytes!!"), Scanner: CommandScanner{Command: "ynx-missing-scanner"}, Processor: FFmpegProcessor{FFmpeg: "ynx-missing-ffmpeg"}})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	NewServer(s, StaticTokenAuth{}).Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
	if w.Code != http.StatusServiceUnavailable || !strings.Contains(w.Body.String(), `"ok":false`) {
		t.Fatalf("unready media dependencies reported healthy: %d %s", w.Code, w.Body.String())
	}
}

func TestPublicDiscoveryDoesNotRequireWalletButPrivateRoutesDo(t *testing.T) {
	s, channel := fixture(t, nil)
	video := upload(t, s, channel, "Public discovery")
	if err := s.Publish(channel.Owner, video.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	server := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner-token": channel.Owner}})
	request := func(method, path, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	if w := request(http.MethodGet, "/v1/videos", ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), video.ID) {
		t.Fatalf("public discovery failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(http.MethodGet, "/v1/videos/"+video.ID, ""); w.Code != http.StatusOK {
		t.Fatalf("public watch metadata failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(http.MethodGet, "/v1/history", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("private history did not fail closed: %d %s", w.Code, w.Body.String())
	}
}

func TestPublishedMediaIsPublicButPrivateMediaIsNot(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "Public media")
	h := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner-token": c.Owner}}).Handler()
	request := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/media/"+v.ObjectKey, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request(); w.Code != http.StatusForbidden {
		t.Fatalf("private media leaked: %d", w.Code)
	}
	if err := s.Publish(c.Owner, v.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	if w := request(); w.Code != http.StatusOK || w.Body.Len() == 0 {
		t.Fatalf("published media unavailable without bearer: %d", w.Code)
	}
}

func TestAIStreamEndpointEmitsReviewState(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "AI stream")
	job, err := s.PrepareAI(c.Owner, v.ID, "summary", []string{"metadata"})
	if err != nil {
		t.Fatal(err)
	}
	h := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner-token": c.Owner}}).Handler()
	r := httptest.NewRequest(http.MethodPost, "/v1/ai/jobs/"+job.ID+"/stream", nil)
	r.Header.Set("Authorization", "Bearer owner-token")
	r.Header.Set("Idempotency-Key", "server-ai-stream-0001")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"state":"starting"`) || !strings.Contains(w.Body.String(), `"state":"review_required"`) {
		t.Fatalf("stream response incomplete: %d %s", w.Code, w.Body.String())
	}
}

func TestWriteIdempotencyReplaysAfterRestartAndRejectsMutation(t *testing.T) {
	s, channel := fixture(t, nil)
	video := upload(t, s, channel, "Idempotency")
	if err := s.Publish(channel.Owner, video.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	request := func(handler http.Handler, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/v1/videos/"+video.ID+"/comments", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer owner-token")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "persisted-comment-request-0001")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	auth := StaticTokenAuth{Tokens: map[string]string{"owner-token": channel.Owner}}
	first := request(NewServer(s, auth).Handler(), `{"body":"one persisted comment"}`)
	if first.Code != http.StatusOK {
		t.Fatalf("first write failed: %d %s", first.Code, first.Body.String())
	}
	restarted, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	second := request(NewServer(restarted, auth).Handler(), `{"body":"one persisted comment"}`)
	if second.Code != first.Code || second.Body.String() != first.Body.String() {
		t.Fatalf("replay mismatch: first=%d %q second=%d %q", first.Code, first.Body.String(), second.Code, second.Body.String())
	}
	comments, err := restarted.Comments(channel.Owner, video.ID)
	if err != nil || len(comments) != 1 {
		t.Fatalf("idempotent replay duplicated effect: %d %v", len(comments), err)
	}
	changed := request(NewServer(restarted, auth).Handler(), `{"body":"changed payload"}`)
	if changed.Code != http.StatusConflict {
		t.Fatalf("changed request reused key: %d %s", changed.Code, changed.Body.String())
	}
}
