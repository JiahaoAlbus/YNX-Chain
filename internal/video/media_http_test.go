package video

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestHLSMediaTypesRangesAndPublicationChanges(t *testing.T) {
	s, channel := fixture(t, nil)
	v := upload(t, s, channel, "HLS response")
	segmentKey := v.ID + "/segment-0000.ts"
	segmentPath, err := s.cfg.Objects.Resolve(segmentKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(segmentPath, []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	approveTestPublication(t, s, channel.Owner, v.ID)
	if err := s.Publish(channel.Owner, v.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	h := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner-token": channel.Owner}}).Handler()
	request := func(key, token, byteRange string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/media/"+key, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		r.Header.Set("Range", byteRange)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for key, mime := range map[string]string{segmentKey: "video/mp2t", v.ID + "/stream.m3u8": "application/vnd.apple.mpegurl"} {
		w := request(key, "", "")
		if w.Code != http.StatusOK || w.Header().Get("Content-Type") != mime || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("media response for %s: %d %v", key, w.Code, w.Header())
		}
	}
	w := request(segmentKey, "", "bytes=2-5")
	if w.Code != http.StatusPartialContent || w.Body.String() != "2345" || w.Header().Get("Content-Range") != "bytes 2-5/10" || w.Header().Get("Content-Type") != "video/mp2t" {
		t.Fatalf("HLS range response: %d %v %q", w.Code, w.Header(), w.Body.String())
	}
	if err := s.Publish(channel.Owner, v.ID, VisibilityPrivate); err != nil {
		t.Fatal(err)
	}
	if w := request(segmentKey, "", ""); w.Code != http.StatusForbidden {
		t.Fatalf("withdrawn media remains public: %d", w.Code)
	}
	if w := request(segmentKey, "owner-token", ""); w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("private owner media: %d %v", w.Code, w.Header())
	}
}
