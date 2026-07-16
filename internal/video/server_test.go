package video

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServerAuthStrictParsingAndModeratorBoundary(t *testing.T) {
	s, _ := fixture(t, nil)
	h := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner-token": "ynx1owner"}}).Handler()
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request(http.MethodGet, "/health", "", ""); w.Code != http.StatusOK {
		t.Fatalf("health=%d", w.Code)
	}
	if w := request(http.MethodGet, "/v1/videos", "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("missing auth=%d", w.Code)
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
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"state":"starting"`) || !strings.Contains(w.Body.String(), `"state":"review_required"`) {
		t.Fatalf("stream response incomplete: %d %s", w.Code, w.Body.String())
	}
}
