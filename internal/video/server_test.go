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
