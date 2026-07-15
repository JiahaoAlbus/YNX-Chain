package music

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/appgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

func testAuth(t *testing.T) *appgateway.Gateway {
	t.Helper()
	g, e := appgateway.New(appgateway.Config{ChatURL: "http://127.0.0.1:1", ChatAPIKey: "0123456789abcdef", SquareURL: "http://127.0.0.1:2", SquareAPIKey: "0123456789abcdef", PayURL: "http://127.0.0.1:3", PayAPIKey: "0123456789abcdef", AllowedOrigins: []string{"https://music.ynx.test"}, MaxBodyBytes: 1 << 20, MaxResponseBytes: 1 << 20, RateLimitMax: 100, RateLimitWindow: time.Minute, StatePath: filepath.Join(t.TempDir(), "auth.json"), ChainID: 6423, ChallengeTTL: 5 * time.Minute, SessionTTL: time.Hour})
	if e != nil {
		t.Fatal(e)
	}
	return g
}
func TestServerAuthorizationAndSecurityHeaders(t *testing.T) {
	s := NewServer(testService(t), testAuth(t), "https://music.ynx.test", nil)
	r := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated API status %d", w.Code)
	}
	if w.Header().Get("Content-Security-Policy") == "" || w.Header().Get("Permissions-Policy") == "" {
		t.Fatal("security headers missing")
	}
}

type authFixture struct {
	account, deviceID, devicePublic, accountPublic string
	accountPrivate                                 *secp256k1.PrivateKey
	devicePrivate                                  ed25519.PrivateKey
}

func signedSession(t *testing.T, g *appgateway.Gateway, binding string) (authFixture, appgateway.SessionResponse) {
	t.Helper()
	ap := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x31}, 32))
	pub := ap.PubKey().SerializeCompressed()
	canonical, e := consensus.NativeAddress(pub)
	if e != nil {
		t.Fatal(e)
	}
	account, e := accountaddress.Encode(canonical)
	if e != nil {
		t.Fatal(e)
	}
	dp := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x42}, ed25519.SeedSize))
	f := authFixture{account: account, deviceID: "music-test-device", devicePublic: nativewallet.EncodePublicKey(dp.Public().(ed25519.PublicKey)), accountPublic: hex.EncodeToString(pub), accountPrivate: ap, devicePrivate: dp}
	ch, e := g.CreateChallenge(binding, appgateway.ChallengeRequest{Account: f.account, DeviceID: f.deviceID, DeviceSigningPublicKey: f.devicePublic})
	if e != nil {
		t.Fatal(e)
	}
	signBytes, e := base64.RawStdEncoding.DecodeString(ch.SignBytes)
	if e != nil {
		t.Fatal(e)
	}
	digest := sha256.Sum256(signBytes)
	session, e := g.VerifyChallenge(binding, ch.ChallengeID, appgateway.VerifyChallengeRequest{AccountPublicKey: f.accountPublic, AccountSignature: hex.EncodeToString(ecdsa.Sign(ap, digest[:]).Serialize()), DeviceSignature: nativewallet.Sign(dp, signBytes)})
	if e != nil {
		t.Fatal(e)
	}
	return f, session
}
func protected(t *testing.T, h http.Handler, method, target string, body any, f authFixture, s appgateway.SessionResponse) *httptest.ResponseRecorder {
	t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	r := httptest.NewRequest(method, target, bytes.NewReader(raw))
	r.Header.Set("Authorization", "Bearer "+s.Token)
	r.Header.Set("X-YNX-Device-ID", f.deviceID)
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestAuthorizedRangePlaybackAndAIGatewayReview(t *testing.T) {
	gateway := testAuth(t)
	fixture, session := signedSession(t, gateway, "https://music.ynx.test")
	svc := testService(t)
	track := publishTrack(t, svc, fixture.account, false)
	svc.UpdateLibrary(fixture.account, []string{track.ID}, nil, nil)
	proposal, e := svc.CreateAIProposal(fixture.account, "playlist", "sequence my owned tone", "ynx-ai-gateway", "test-model", []string{track.ID}, true)
	if e != nil {
		t.Fatal(e)
	}
	ai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ai/stream" {
			w.Header().Set("Content-Type", "text/event-stream")
			w.Write([]byte("event: token\ndata: {\"text\":\"Repository tone first\"}\n\nevent: done\ndata: {}\n\n"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}))
	defer ai.Close()
	svc.cfg.AIGatewayURL = ai.URL
	svc.cfg.AIGatewayKey = "server-side-key"
	server := NewServer(svc, gateway, "https://music.ynx.test", nil).Handler()
	r := httptest.NewRequest(http.MethodGet, "/api/tracks/"+track.ID+"/media", nil)
	r.Header.Set("Authorization", "Bearer "+session.Token)
	r.Header.Set("X-YNX-Device-ID", fixture.deviceID)
	r.Header.Set("Range", "bytes=0-31")
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != http.StatusPartialContent || w.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("range media status=%d headers=%v", w.Code, w.Header())
	}
	stream := protected(t, server, http.MethodGet, "/api/ai/proposals/"+proposal.ID+"/stream", nil, fixture, session)
	if stream.Code != http.StatusOK {
		t.Fatalf("AI stream status %d: %s", stream.Code, stream.Body.String())
	}
	stored, e := svc.AIProposal(fixture.account, proposal.ID)
	if e != nil || stored.Status != "completed" || stored.Result != "Repository tone first" {
		t.Fatalf("AI result not audited: %#v %v", stored, e)
	}
	review := protected(t, server, http.MethodPost, "/api/ai/proposals/"+proposal.ID+"/review", map[string]string{"action": "apply", "name": "Reviewed tone"}, fixture, session)
	if review.Code != http.StatusOK {
		t.Fatalf("AI apply status %d: %s", review.Code, review.Body.String())
	}
	if len(svc.Playlists(fixture.account)) != 1 {
		t.Fatal("reviewed AI playlist was not applied")
	}
}
