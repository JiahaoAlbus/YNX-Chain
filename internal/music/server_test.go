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
	"strings"
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

func TestWalletCentralExchangeUnavailableAndReplayRejected(t *testing.T) {
	service := testService(t)
	server := NewServer(service, testAuth(t), "https://music.ynx.test", nil).Handler()
	body := map[string]string{"response": strings.Repeat("r", 64), "expectedNonce": strings.Repeat("n", 32), "productClientId": musicProductClient, "bundleId": musicBundleID}
	raw, _ := json.Marshal(body)
	w := httptest.NewRecorder()
	server.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/auth/wallet-v1/session", bytes.NewReader(raw)))
	if w.Code != http.StatusServiceUnavailable || !strings.Contains(w.Body.String(), "Wallet Gateway unavailable") {
		t.Fatalf("unavailable boundary status=%d body=%s", w.Code, w.Body.String())
	}

	fixture, _ := signedSession(t, testAuth(t), "https://music.ynx.test")
	central := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer central-test-key" {
			t.Error("central bearer missing")
		}
		writeJSON(w, http.StatusOK, walletSession{Token: "central-session", Account: fixture.account, DeviceID: "music-device", ExpiresAt: "2030-01-01T00:00:00.000Z"})
	}))
	defer central.Close()
	service.cfg.WalletSessionURL, service.cfg.WalletGatewayKey = central.URL, "central-test-key"
	w = httptest.NewRecorder()
	server.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/auth/wallet-v1/session", bytes.NewReader(raw)))
	if w.Code != http.StatusOK {
		t.Fatalf("central exchange status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	server.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/auth/wallet-v1/session", bytes.NewReader(raw)))
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "replay") {
		t.Fatalf("replay status=%d body=%s", w.Code, w.Body.String())
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
	return protectedWithKey(t, h, method, target, body, f, s, "")
}
func protectedWithKey(t *testing.T, h http.Handler, method, target string, body any, f authFixture, s appgateway.SessionResponse, key string) *httptest.ResponseRecorder {
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
	if key != "" {
		r.Header.Set("Idempotency-Key", key)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestPayAndTrustCentralIdempotencyAndTamperBoundaries(t *testing.T) {
	gateway := testAuth(t)
	fixture, session := signedSession(t, gateway, "https://music.ynx.test")
	svc := testService(t)
	track := publishTrack(t, svc, fixture.account, false)
	listener := testAccount(t, 12)
	_, _ = svc.UpsertProfile(listener, Profile{DisplayName: "Listener"})
	_, usage, err := svc.SavePosition(listener, track.ID, "central-usage", 1200, true)
	if err != nil {
		t.Fatal(err)
	}
	allocation, err := svc.Allocate(fixture.account, "external-source", 1000, []string{usage.ID})
	if err != nil {
		t.Fatal(err)
	}
	central := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var q map[string]any
		if err := json.NewDecoder(r.Body).Decode(&q); err != nil {
			t.Fatal(err)
		}
		switch q["type"] {
		case "open_case":
			writeJSON(w, 200, map[string]string{"id": "trust-central-1"})
		case "music_creator_settlement":
			writeJSON(w, 200, map[string]string{"id": "pay-central-1", "reviewUri": "ynxpay://settlement/review?intent=pay-central-1", "status": "requires_wallet_review"})
		default:
			t.Errorf("unexpected central type %v", q["type"])
			writeJSON(w, 400, map[string]string{"error": "type"})
		}
	}))
	defer central.Close()
	svc.cfg.TrustGatewayURL = central.URL
	svc.cfg.TrustGatewayKey = "trust-key"
	svc.cfg.PayGatewayURL = central.URL
	svc.cfg.PayGatewayKey = "pay-key"
	handler := NewServer(svc, gateway, "https://music.ynx.test", nil).Handler()
	missing := protected(t, handler, http.MethodPost, "/api/cases", map[string]string{"kind": "report", "trackID": track.ID, "reason": "rights evidence mismatch", "evidenceRef": "sha256:abc"}, fixture, session)
	if missing.Code != 400 {
		t.Fatalf("Trust missing key=%d %s", missing.Code, missing.Body.String())
	}
	trust := protectedWithKey(t, handler, http.MethodPost, "/api/cases", map[string]string{"kind": "report", "trackID": track.ID, "reason": "rights evidence mismatch", "evidenceRef": "sha256:abc"}, fixture, session, "trust-1")
	if trust.Code != 201 || !strings.Contains(trust.Body.String(), "trust-central-1") {
		t.Fatalf("Trust central=%d %s", trust.Code, trust.Body.String())
	}
	tampered := protectedWithKey(t, handler, http.MethodPost, "/api/cases", map[string]string{"kind": "report", "trackID": track.ID, "reason": "changed rights evidence", "evidenceRef": "sha256:abc"}, fixture, session, "trust-1")
	if tampered.Code != 409 {
		t.Fatalf("Trust tamper=%d %s", tampered.Code, tampered.Body.String())
	}
	pay := protectedWithKey(t, handler, http.MethodPost, "/api/creator/settlements", map[string]string{"allocationID": allocation.ID, "payTo": fixture.account}, fixture, session, "pay-1")
	if pay.Code != 201 || !strings.Contains(pay.Body.String(), "requires_wallet_review") || !strings.Contains(pay.Body.String(), "pay-central-1") {
		t.Fatalf("Pay central=%d %s", pay.Code, pay.Body.String())
	}
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
