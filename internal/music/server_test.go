package music

import (
	"bytes"
	"encoding/json"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type authFixture struct {
	account, sessionBinding, deviceKey string
}

func canonicalSession(f authFixture) walletSession {
	return walletSession{
		VerifierVersion: "wallet-auth-v1", SessionBinding: f.sessionBinding,
		ProductClientID: musicProductClient, BundleID: musicBundleID,
		ProductDeviceAlgorithm: "p256-sha256", RequestDigest: strings.Repeat("b", 64),
		Account: f.account, Scopes: []string{"music.creator", "music.library", "music.playback", "music.profile"},
		IssuedAt: "2026-07-18T00:00:00.000Z", ExpiresAt: "2030-07-18T00:00:00.000Z",
	}
}

func centralAuth(t *testing.T, service *Service, fixture authFixture) *httptest.Server {
	t.Helper()
	central := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer central-test-key" || r.Header.Get("X-YNX-Product-Client") != musicProductClient {
			t.Errorf("canonical central headers missing: %v", r.Header)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "headers"})
			return
		}
		switch r.URL.Path {
		case "/challenge":
			writeJSON(w, http.StatusCreated, walletChallengeResponse{Challenge: json.RawMessage(`{"version":"1"}`)})
		case "/session":
			writeJSON(w, http.StatusOK, canonicalSession(fixture))
		case "/introspect":
			var input walletIntrospectionRequest
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			active := input.SessionBinding == fixture.sessionBinding && input.ProductClientID == musicProductClient && input.BundleID == musicBundleID && input.ProductDeviceKey == fixture.deviceKey && len(input.RequiredScopes) == 1
			writeJSON(w, http.StatusOK, walletIntrospectionResponse{Active: active, Session: canonicalSession(fixture)})
		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "route"})
		}
	}))
	service.cfg.WalletChallengeURL = central.URL + "/challenge"
	service.cfg.WalletSessionURL = central.URL + "/session"
	service.cfg.WalletVerifyURL = central.URL + "/introspect"
	service.cfg.WalletGatewayKey = "central-test-key"
	return central
}

func testFixture(t *testing.T) authFixture {
	return authFixture{account: testAccount(t, 31), sessionBinding: strings.Repeat("a", 64), deviceKey: strings.Repeat("A", 44)}
}

func protected(t *testing.T, h http.Handler, method, target string, body any, f authFixture) *httptest.ResponseRecorder {
	return protectedWithKey(t, h, method, target, body, f, "")
}

func protectedWithKey(t *testing.T, h http.Handler, method, target string, body any, f authFixture, key string) *httptest.ResponseRecorder {
	t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	r := httptest.NewRequest(method, target, bytes.NewReader(raw))
	r.Header.Set("X-YNX-App-Session", f.sessionBinding)
	r.Header.Set("X-YNX-Product-Device-Key", f.deviceKey)
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

func TestServerRequiresCanonicalCentralSessionAndSecurityHeaders(t *testing.T) {
	service := testService(t)
	fixture := testFixture(t)
	central := centralAuth(t, service, fixture)
	defer central.Close()
	handler := NewServer(service, "https://music.ynx.test", nil).Handler()

	r := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	r.Header.Set("Authorization", "Bearer legacy-token")
	r.Header.Set("X-YNX-Device-ID", "legacy-device")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("legacy bearer/device headers accepted: %d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("Content-Security-Policy") == "" || w.Header().Get("Permissions-Policy") == "" {
		t.Fatal("security headers missing")
	}
	legacy := httptest.NewRecorder()
	handler.ServeHTTP(legacy, httptest.NewRequest(http.MethodPost, "/api/auth/challenges", nil))
	if legacy.Code != http.StatusNotFound && legacy.Code != http.StatusMethodNotAllowed {
		t.Fatalf("legacy challenge route still exposed: %d", legacy.Code)
	}
	if got := protected(t, handler, http.MethodGet, "/api/me", nil, fixture); got.Code != http.StatusOK {
		t.Fatalf("canonical session rejected: %d %s", got.Code, got.Body.String())
	}
}

func TestGuestCanDiscoverAndRangeStreamOnlyPublishedNonExplicitTracks(t *testing.T) {
	service := testService(t)
	creator := testAccount(t, 41)
	if _, err := service.UpsertProfile(creator, Profile{DisplayName: "Guest Trial Artist", ExplicitAllowed: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.OnboardCreator(creator, "Guest Trial Artist", "Owned test media"); err != nil {
		t.Fatal(err)
	}
	published := publishTrack(t, service, creator, false)
	draft, err := service.UploadTrack(creator, TrackUpload{Title: "Private Draft", ArtistName: "Guest Trial Artist", Audio: Upload{Reader: bytes.NewReader(toneWAV(1000))}, AudioProvenance: "repository-generated test tone", RightsBasis: "owned", Territories: []string{"TEST"}, EvidenceRef: "repository fixture"})
	if err != nil {
		t.Fatal(err)
	}
	explicit := publishTrack(t, service, creator, true)
	handler := NewServer(service, "https://music.ynx.test", nil).Handler()

	catalog := httptest.NewRecorder()
	handler.ServeHTTP(catalog, httptest.NewRequest(http.MethodGet, "/api/catalog", nil))
	if catalog.Code != http.StatusOK || !strings.Contains(catalog.Body.String(), published.ID) || strings.Contains(catalog.Body.String(), draft.ID) || strings.Contains(catalog.Body.String(), explicit.ID) {
		t.Fatalf("guest catalog boundary failed: %d %s", catalog.Code, catalog.Body.String())
	}

	mediaRequest := httptest.NewRequest(http.MethodGet, "/api/tracks/"+published.ID+"/media", nil)
	mediaRequest.Header.Set("Range", "bytes=0-31")
	media := httptest.NewRecorder()
	handler.ServeHTTP(media, mediaRequest)
	if media.Code != http.StatusPartialContent || media.Header().Get("Accept-Ranges") != "bytes" || media.Header().Get("Cache-Control") != "public, max-age=300" || media.Body.Len() != 32 {
		t.Fatalf("guest range playback failed: %d headers=%v bytes=%d", media.Code, media.Header(), media.Body.Len())
	}

	privateTrack := httptest.NewRecorder()
	handler.ServeHTTP(privateTrack, httptest.NewRequest(http.MethodGet, "/api/tracks/"+draft.ID, nil))
	if privateTrack.Code != http.StatusNotFound {
		t.Fatalf("guest accessed private draft: %d %s", privateTrack.Code, privateTrack.Body.String())
	}
	privateMedia := httptest.NewRecorder()
	handler.ServeHTTP(privateMedia, httptest.NewRequest(http.MethodGet, "/api/tracks/"+explicit.ID+"/media", nil))
	if privateMedia.Code != http.StatusForbidden {
		t.Fatalf("guest accessed explicit media: %d %s", privateMedia.Code, privateMedia.Body.String())
	}
}

func TestWalletCentralChallengeCompletionUnavailableReplayAndExactJSON(t *testing.T) {
	service := testService(t)
	handler := NewServer(service, "https://music.ynx.test", nil).Handler()
	request := map[string]any{"authorizationRequest": map[string]string{"version": "1"}, "walletApproval": map[string]string{"version": "1"}}
	raw, _ := json.Marshal(request)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/auth/wallet-v1/challenge", bytes.NewReader(raw)))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured challenge status=%d body=%s", w.Code, w.Body.String())
	}

	fixture := testFixture(t)
	central := centralAuth(t, service, fixture)
	defer central.Close()
	completion := map[string]any{"authorizationRequest": map[string]string{"version": "1"}, "walletApproval": map[string]string{"version": "1"}, "gatewayCompletion": map[string]any{"challenge": map[string]string{"version": "1"}, "deviceSignature": "proof"}}
	raw, _ = json.Marshal(completion)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/auth/wallet-v1/session", bytes.NewReader(raw)))
	if w.Code != http.StatusOK {
		t.Fatalf("central completion status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/auth/wallet-v1/session", bytes.NewReader(raw)))
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "replay") {
		t.Fatalf("replay status=%d body=%s", w.Code, w.Body.String())
	}
	bad := []byte(`{"authorizationRequest":{},"walletApproval":{},"gatewayCompletion":{},"legacyToken":"forbidden"}`)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/auth/wallet-v1/session", bytes.NewReader(bad)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unknown auth field accepted: %d %s", w.Code, w.Body.String())
	}
}

func TestPayAndTrustCentralIdempotencyAndTamperBoundaries(t *testing.T) {
	fixture := testFixture(t)
	svc := testService(t)
	auth := centralAuth(t, svc, fixture)
	defer auth.Close()
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
			writeJSON(w, 400, map[string]string{"error": "type"})
		}
	}))
	defer central.Close()
	svc.cfg.TrustGatewayURL, svc.cfg.TrustGatewayKey = central.URL, "trust-key"
	svc.cfg.PayGatewayURL, svc.cfg.PayGatewayKey = central.URL, "pay-key"
	handler := NewServer(svc, "https://music.ynx.test", nil).Handler()
	if missing := protected(t, handler, http.MethodPost, "/api/cases", map[string]string{"kind": "report", "trackID": track.ID, "reason": "rights evidence mismatch", "evidenceRef": "sha256:abc"}, fixture); missing.Code != 400 {
		t.Fatalf("Trust missing key=%d %s", missing.Code, missing.Body.String())
	}
	trust := protectedWithKey(t, handler, http.MethodPost, "/api/cases", map[string]string{"kind": "report", "trackID": track.ID, "reason": "rights evidence mismatch", "evidenceRef": "sha256:abc"}, fixture, "trust-1")
	if trust.Code != 201 || !strings.Contains(trust.Body.String(), "trust-central-1") {
		t.Fatalf("Trust central=%d %s", trust.Code, trust.Body.String())
	}
	tampered := protectedWithKey(t, handler, http.MethodPost, "/api/cases", map[string]string{"kind": "report", "trackID": track.ID, "reason": "changed rights evidence", "evidenceRef": "sha256:abc"}, fixture, "trust-1")
	if tampered.Code != 409 {
		t.Fatalf("Trust tamper=%d %s", tampered.Code, tampered.Body.String())
	}
	pay := protectedWithKey(t, handler, http.MethodPost, "/api/creator/settlements", map[string]string{"allocationID": allocation.ID, "payTo": fixture.account}, fixture, "pay-1")
	if pay.Code != 201 || !strings.Contains(pay.Body.String(), "requires_wallet_review") || !strings.Contains(pay.Body.String(), "pay-central-1") {
		t.Fatalf("Pay central=%d %s", pay.Code, pay.Body.String())
	}
}

func TestAuthorizedRangePlaybackAndAIGatewayReview(t *testing.T) {
	fixture := testFixture(t)
	svc := testService(t)
	auth := centralAuth(t, svc, fixture)
	defer auth.Close()
	track := publishTrack(t, svc, fixture.account, false)
	svc.UpdateLibrary(fixture.account, []string{track.ID}, nil, nil)
	proposal, err := svc.CreateAIProposal(fixture.account, "playlist", "sequence my owned tone", "ynx-ai-gateway", "test-model", []string{track.ID}, true)
	if err != nil {
		t.Fatal(err)
	}
	ai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ai/stream" {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("event: token\ndata: {\"text\":\"Repository tone first\"}\n\nevent: done\ndata: {}\n\n"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
	defer ai.Close()
	svc.cfg.AIGatewayURL, svc.cfg.AIGatewayKey = ai.URL, "server-side-key"
	server := NewServer(svc, "https://music.ynx.test", nil).Handler()
	r := httptest.NewRequest(http.MethodGet, "/api/tracks/"+track.ID+"/media", nil)
	r.Header.Set("X-YNX-App-Session", fixture.sessionBinding)
	r.Header.Set("X-YNX-Product-Device-Key", fixture.deviceKey)
	r.Header.Set("Range", "bytes=0-31")
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != http.StatusPartialContent || w.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("range media status=%d headers=%v", w.Code, w.Header())
	}
	stream := protected(t, server, http.MethodGet, "/api/ai/proposals/"+proposal.ID+"/stream", nil, fixture)
	if stream.Code != http.StatusOK {
		t.Fatalf("AI stream status %d: %s", stream.Code, stream.Body.String())
	}
	stored, err := svc.AIProposal(fixture.account, proposal.ID)
	if err != nil || stored.Status != "completed" || stored.Result != "Repository tone first" {
		t.Fatalf("AI result not audited: %#v %v", stored, err)
	}
	review := protected(t, server, http.MethodPost, "/api/ai/proposals/"+proposal.ID+"/review", map[string]string{"action": "apply", "name": "Reviewed tone"}, fixture)
	if review.Code != http.StatusOK || len(svc.Playlists(fixture.account)) != 1 {
		t.Fatalf("AI review failed: %d %s", review.Code, review.Body.String())
	}
}

func TestWalletSessionValidationProperties(t *testing.T) {
	fixture := testFixture(t)
	scopes := []string{"music.creator", "music.library", "music.playback", "music.profile"}
	rng := rand.New(rand.NewSource(6423))
	for i := 0; i < 500; i++ {
		session := canonicalSession(fixture)
		rng.Shuffle(len(scopes), func(a, b int) { scopes[a], scopes[b] = scopes[b], scopes[a] })
		session.Scopes = append([]string(nil), scopes...)
		for _, scope := range scopes {
			if !session.valid(scope) {
				t.Fatalf("valid scope rejected at iteration %d: %s", i, scope)
			}
		}
		session.ExpiresAt = session.IssuedAt
		if session.valid("music.profile") {
			t.Fatalf("non-increasing validity window accepted at iteration %d", i)
		}
	}
}

func FuzzWalletSessionFailClosed(f *testing.F) {
	fixture := authFixture{account: "0x1111111111111111111111111111111111111111", sessionBinding: strings.Repeat("a", 64), deviceKey: strings.Repeat("A", 44)}
	for _, seed := range []string{"", "a", strings.Repeat("a", 63), strings.Repeat("a", 65), strings.Repeat("z", 64), "../../session"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, attackerValue string) {
		session := canonicalSession(fixture)
		session.SessionBinding = attackerValue
		if attackerValue != strings.Repeat("a", 64) && session.valid("music.profile") {
			t.Fatalf("malformed or attacker-controlled binding validated: %q", attackerValue)
		}
	})
}
