package music

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestMusicAIStreamRequiresCompleteBoundedTerminal(t *testing.T) {
	for _, tc := range []struct {
		name, wire string
		ok         bool
	}{{"valid", "event: token\ndata: {\"text\":\"real\"}\n\nevent: done\ndata: {}\n\n", true}, {"CRLF final", "event: token\r\ndata: {\"text\":\"real\"}\r\n\r\nevent: done\r\ndata: {}", true}, {"raw cap after completion", "event: token\ndata: {\"text\":\"real\"}\n\nevent: done\ndata: {}\n\n" + strings.Repeat(": x\r\n", 30000), false}, {"missing done", "event: token\ndata: {\"text\":\"partial\"}\n\n", false}, {"after done", "event: done\ndata: {}\n\nevent: token\ndata: {\"text\":\"late\"}\n\n", false}, {"malformed token", "event: token\ndata: nope\n\nevent: done\ndata: {}\n\n", false}, {"duplicate data", "event: token\ndata: {}\ndata: {}\n\n", false}, {"too much", "event: token\ndata: {\"text\":\"" + strings.Repeat("x", 12001) + "\"}\n\nevent: done\ndata: {}\n\n", false}} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := readMusicAIStream(strings.NewReader(tc.wire), nil)
			if (err == nil) != tc.ok {
				t.Fatalf("terminal validation: %v", err)
			}
		})
	}
}
func TestMusicAIActualV2StreamDurableRecoveryAndUnknown(t *testing.T) {
	for _, mode := range []string{"complete", "incomplete", "revoked", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			s := testService(t)
			actor := testAccount(t, 1)
			track := publishTrack(t, s, actor, false)
			p, err := s.CreateAIProposal(actor, "playlist", "Arrange tracks", "fixture", "fixture-model", []string{track.ID}, true)
			if err != nil {
				t.Fatal(err)
			}
			var calls, nonces atomic.Int32
			var revoked atomic.Bool
			upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("X-YNX-Music-Business-Proof-V2") != "" || r.Header.Get("X-YNX-AI-Key") != "fixture-key" {
					t.Error("consumer credentials forwarded")
				}
				if mode == "redirect" {
					http.Redirect(w, r, "/other", 307)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if mode == "revoked" {
					revoked.Store(true)
				}
				fmt.Fprint(w, "event: token\ndata: {\"text\":\"Original result\"}\n\n")
				if mode != "incomplete" {
					fmt.Fprint(w, "event: done\ndata: {}\n\n")
				}
			}))
			defer upstream.Close()
			s.cfg.HTTPClient = upstream.Client()
			s.cfg.AIGatewayURL = upstream.URL
			s.cfg.AIGatewayKey = "fixture-key"
			s.cfg.BusinessAuthority = fixtureBusinessAuthority(func(ctx context.Context, r *http.Request, scope string, b io.Reader, limit int64) (MusicBusinessGrant, error) {
				raw, err := io.ReadAll(b)
				g := testBusinessLease(actor, fmt.Sprintf("ai_stream_nonce_%05d", nonces.Add(1)), s.cfg.Now).grant
				g.BodyDigest = effectDigest(raw)
				g.Revalidate = func(context.Context) error {
					if revoked.Load() {
						return ErrUnauthorized
					}
					return nil
				}
				return g, err
			})
			invoke := func(service *Service) *httptest.ResponseRecorder {
				r := httptest.NewRequest("GET", "/api/ai/proposals/"+p.ID+"/stream", nil)
				r.Header.Set("X-YNX-Product-Session-Proof-V2", "fixture")
				r.Header.Set("X-YNX-Music-Business-Proof-V2", "fixture")
				w := httptest.NewRecorder()
				NewServer(service, "https://music.ynx.test", nil).Handler().ServeHTTP(w, r)
				return w
			}
			first := invoke(s)
			e := s.state.BusinessEffects[effectKey(actor, "ai", p.ID)]
			stored, _ := s.AIProposal(actor, p.ID)
			if mode == "complete" {
				if e.Status != "receipt" || stored.Status != "completed" || stored.Result != "Original result" || !strings.Contains(first.Body.String(), "event: done") {
					t.Fatalf("did not durably complete: %s %#v", first.Body.String(), stored)
				}
			} else {
				if e.Status != "dispatch_admitted" || stored.Status == "completed" || strings.Contains(first.Body.String(), "event: done") {
					t.Fatal("unknown result falsely complete")
				}
				if mode == "revoked" && bytes.Contains(first.Body.Bytes(), []byte("Original result")) {
					t.Fatal("revoked result leaked")
				}
			}
			revoked.Store(false)
			restored, err := New(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			second := invoke(restored)
			if calls.Load() != 1 {
				t.Fatal("restart resent AI computation")
			}
			if mode == "complete" && !strings.Contains(second.Body.String(), "Original result") {
				t.Fatal("saved result not recovered")
			}
			if mode != "complete" && second.Code != 409 {
				t.Fatalf("unknown outcome recovered falsely: %d", second.Code)
			}
		})
	}
}
func TestMusicV2MountCannotFallThroughLegacy(t *testing.T) {
	s := testService(t)
	s.cfg.BusinessAuthority = fixtureBusinessAuthority(func(context.Context, *http.Request, string, io.Reader, int64) (MusicBusinessGrant, error) {
		t.Fatal("unexpected V2 call")
		return MusicBusinessGrant{}, nil
	})
	r := httptest.NewRequest("GET", "/api/me", nil)
	r.Header.Set("X-YNX-App-Session", strings.Repeat("a", 64))
	r.Header.Set("X-YNX-Product-Device-Key", strings.Repeat("a", 44))
	w := httptest.NewRecorder()
	NewServer(s, "", nil).Handler().ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal("legacy fallback allowed")
	}
}
