package music

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestMusicWebCallbackServesWithoutRedirectOrCredentialReflection(t *testing.T) {
	handler := NewServer(testService(t), "https://music.ynxweb4.com", fstest.MapFS{"wallet-callback.html": {Data: []byte("<html>Music callback</html>")}}).Handler()
	request := httptest.NewRequest(http.MethodGet, "/wallet-auth/callback?approval=sensitive-return", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != 200 || recorder.Header().Get("Location") != "" || recorder.Header().Get("Cache-Control") != "no-store" || recorder.Header().Get("Referrer-Policy") != "no-referrer" || strings.Contains(recorder.Body.String(), "sensitive-return") || recorder.Body.String() != "<html>Music callback</html>" {
		t.Fatalf("unsafe callback: status %d headers %v body %q", recorder.Code, recorder.Header(), recorder.Body.String())
	}
}
