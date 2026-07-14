package square

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

const (
	aliceAddress = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	bobAddress   = "ynx1llllllllllllllllllllllllllllllllyj698f"
	squareAPIKey = "test-square-api-key-123456789"
)

type testDevice struct {
	device Device
	keys   nativewallet.DeviceKeys
}

func TestSquarePersistentSocialLifecycle(t *testing.T) {
	now := time.Date(2026, 7, 14, 15, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "square", "state.json")
	service := newTestService(t, statePath, func() time.Time { return now })
	alice := registerTestDevice(t, service, aliceAddress, "alice-device", "register-alice", 0x11)
	bob := registerTestDevice(t, service, bobAddress, "bob-device", "register-bob", 0x22)

	bad := registrationRequest("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf", "evm-device", "register-evm", alice.keys)
	if _, err := service.RegisterDevice(bad); !errors.Is(err, ErrInvalid) {
		t.Fatalf("EVM identity accepted: %v", err)
	}
	postRequest := CreatePostRequest{IdempotencyKey: "post-first", Content: "YNX Square is backed by signed records.", Tags: []string{"chain", "ynx"}}
	created, err := service.CreatePost(alice.device, postRequest)
	if err != nil || created.Replayed {
		t.Fatalf("create post: %+v %v", created, err)
	}
	replay, err := service.CreatePost(alice.device, postRequest)
	if err != nil || !replay.Replayed || replay.Record.ID != created.Record.ID {
		t.Fatalf("post replay: %+v %v", replay, err)
	}
	changed := postRequest
	changed.Content = "changed content"
	if _, err := service.CreatePost(alice.device, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed post replay should conflict: %v", err)
	}

	now = now.Add(time.Second)
	second, err := service.CreatePost(bob.device, CreatePostRequest{IdempotencyKey: "post-second", Content: "Second real feed record."})
	if err != nil {
		t.Fatal(err)
	}
	feed, err := service.Feed(1, "")
	if err != nil || len(feed.Posts) != 1 || feed.Posts[0].ID != second.Record.ID || feed.NextCursor == "" {
		t.Fatalf("first feed page: %+v %v", feed, err)
	}
	next, err := service.Feed(1, feed.NextCursor)
	if err != nil || len(next.Posts) != 1 || next.Posts[0].ID != created.Record.ID {
		t.Fatalf("second feed page: %+v %v", next, err)
	}

	comment, err := service.CreateComment(bob.device, created.Record.ID, CreateCommentRequest{IdempotencyKey: "comment-first", Content: "Signed comment."})
	if err != nil || comment.Record.Author != bobAddress {
		t.Fatalf("create comment: %+v %v", comment, err)
	}
	reaction, err := service.SetReaction(bob.device, created.Record.ID, SetReactionRequest{IdempotencyKey: "reaction-first", Kind: "support", Active: true})
	if err != nil || !reaction.Record.Active {
		t.Fatalf("set reaction: %+v %v", reaction, err)
	}
	follow, err := service.SetFollow(bob.device, SetFollowRequest{IdempotencyKey: "follow-first", Account: aliceAddress, Active: true})
	if err != nil || !follow.Record.Active {
		t.Fatalf("set follow: %+v %v", follow, err)
	}
	following, err := service.Following(bobAddress)
	if err != nil || len(following) != 1 || following[0] != aliceAddress {
		t.Fatalf("following: %+v %v", following, err)
	}

	report, err := service.CreateReport(bob.device, CreateReportRequest{IdempotencyKey: "report-first", TargetType: "post", TargetID: created.Record.ID, Category: "spam", Detail: "review requested", EvidenceHashes: []string{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}})
	if err != nil || report.Record.Status != "pending_review" || report.Record.AppealRoute != "/trust/appeals" {
		t.Fatalf("create report: %+v %v", report, err)
	}
	if _, err := service.Report(alice.device, report.Record.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("another account read private report: %v", err)
	}

	post, err := service.Post(created.Record.ID)
	if err != nil || post.CommentCount != 1 || post.ReactionCount != 1 {
		t.Fatalf("post counters: %+v %v", post, err)
	}
	info, err := os.Stat(statePath)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("state mode: %v %v", info, err)
	}
	restarted := newTestService(t, statePath, func() time.Time { return now })
	health := restarted.Health()
	if health.PostCount != 2 || health.CommentCount != 1 || health.ActiveReactions != 1 || health.ActiveFollows != 1 || health.ReportCount != 1 || health.RemoteDeployed {
		t.Fatalf("restarted health: %+v", health)
	}

	data, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)/2] ^= 1
	tampered := filepath.Join(t.TempDir(), "tampered.json")
	if err := os.WriteFile(tampered, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(testConfig(tampered, func() time.Time { return now })); err == nil {
		t.Fatal("tampered state was accepted")
	}
}

func TestSquareHTTPRoutesAndSignedMutations(t *testing.T) {
	now := time.Date(2026, 7, 14, 16, 0, 0, 0, time.UTC)
	service := newTestService(t, filepath.Join(t.TempDir(), "state.json"), func() time.Time { return now })
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()
	aliceKeys := generateKeys(t, 0x31)
	bobKeys := generateKeys(t, 0x32)
	registerHTTPDevice(t, server.URL, registrationRequest(aliceAddress, "alice-http", "register-alice-http", aliceKeys))
	registerHTTPDevice(t, server.URL, registrationRequest(bobAddress, "bob-http", "register-bob-http", bobKeys))

	postBody := mustJSON(t, CreatePostRequest{IdempotencyKey: "http-post", Content: "Live Square HTTP post", Tags: []string{"ynx"}})
	response := signedHTTP(t, server.URL, http.MethodPost, "/square/posts", postBody, "alice-http", aliceKeys.SigningPrivate, now, squareAPIKey)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("post status %d: %s", response.StatusCode, readAll(response.Body))
	}
	var postResult Result[Post]
	decodeJSON(t, response.Body, &postResult)
	response.Body.Close()

	commentBody := mustJSON(t, CreateCommentRequest{IdempotencyKey: "http-comment", Content: "HTTP comment"})
	response = signedHTTP(t, server.URL, http.MethodPost, "/square/posts/"+postResult.Record.ID+"/comments", commentBody, "bob-http", bobKeys.SigningPrivate, now, squareAPIKey)
	assertStatus(t, response, http.StatusCreated)
	reactionBody := mustJSON(t, SetReactionRequest{IdempotencyKey: "http-reaction", Kind: "like", Active: true})
	response = signedHTTP(t, server.URL, http.MethodPost, "/square/posts/"+postResult.Record.ID+"/reactions", reactionBody, "bob-http", bobKeys.SigningPrivate, now, squareAPIKey)
	assertStatus(t, response, http.StatusCreated)
	followBody := mustJSON(t, SetFollowRequest{IdempotencyKey: "http-follow", Account: aliceAddress, Active: true})
	response = signedHTTP(t, server.URL, http.MethodPost, "/square/follows", followBody, "bob-http", bobKeys.SigningPrivate, now, squareAPIKey)
	assertStatus(t, response, http.StatusCreated)
	reportBody := mustJSON(t, CreateReportRequest{IdempotencyKey: "http-report", TargetType: "post", TargetID: postResult.Record.ID, Category: "spam", Detail: "bounded report"})
	response = signedHTTP(t, server.URL, http.MethodPost, "/square/reports", reportBody, "bob-http", bobKeys.SigningPrivate, now, squareAPIKey)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("report status %d: %s", response.StatusCode, readAll(response.Body))
	}
	var reportResult Result[Report]
	decodeJSON(t, response.Body, &reportResult)
	response.Body.Close()

	for _, path := range []string{"/square/feed?limit=20", "/square/posts/" + postResult.Record.ID, "/square/posts/" + postResult.Record.ID + "/comments", "/square/profiles/" + bobAddress + "/following"} {
		request, _ := http.NewRequest(http.MethodGet, server.URL+path, nil)
		request.Header.Set("X-YNX-Square-Key", squareAPIKey)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		assertStatus(t, response, http.StatusOK)
	}
	response = signedHTTP(t, server.URL, http.MethodGet, "/square/reports/"+reportResult.Record.ID, nil, "bob-http", bobKeys.SigningPrivate, now, squareAPIKey)
	assertStatus(t, response, http.StatusOK)

	response = signedHTTP(t, server.URL, http.MethodPost, "/square/posts", postBody, "alice-http", aliceKeys.SigningPrivate, now.Add(-10*time.Minute), squareAPIKey)
	assertStatus(t, response, http.StatusUnauthorized)
	response = signedHTTP(t, server.URL, http.MethodPost, "/square/posts", postBody, "alice-http", aliceKeys.SigningPrivate, now, "wrong-key")
	assertStatus(t, response, http.StatusUnauthorized)

	healthResponse, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	var health Health
	decodeJSON(t, healthResponse.Body, &health)
	healthResponse.Body.Close()
	if !health.OK || health.NativeIdentity != "ynx1" || health.TruthfulStatus != "local-bounded-square-core-not-remote-deployed" || health.PostCount != 1 {
		t.Fatalf("health: %+v", health)
	}
}

func testConfig(path string, now func() time.Time) Config {
	return Config{StatePath: path, APIKey: squareAPIKey, MaxBodyBytes: 16 * 1024, RateLimitWindow: time.Minute, RateLimitMax: 120, Now: now}
}

func newTestService(t *testing.T, path string, now func() time.Time) *Service {
	t.Helper()
	service, err := New(testConfig(path, now))
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func generateKeys(t *testing.T, seed byte) nativewallet.DeviceKeys {
	t.Helper()
	keys, err := nativewallet.GenerateDeviceKeys(bytes.NewReader(bytes.Repeat([]byte{seed}, 256)))
	if err != nil {
		t.Fatal(err)
	}
	return keys
}

func registrationRequest(account, deviceID, idempotency string, keys nativewallet.DeviceKeys) RegisterDeviceRequest {
	req := RegisterDeviceRequest{Account: account, DeviceID: deviceID, IdempotencyKey: idempotency, SigningPublicKey: nativewallet.EncodePublicKey(keys.SigningPublic)}
	req.ProofSignature = nativewallet.Sign(keys.SigningPrivate, DeviceRegistrationPayload(req))
	return req
}

func registerTestDevice(t *testing.T, service *Service, account, deviceID, idempotency string, seed byte) testDevice {
	t.Helper()
	keys := generateKeys(t, seed)
	result, err := service.RegisterDevice(registrationRequest(account, deviceID, idempotency, keys))
	if err != nil {
		t.Fatal(err)
	}
	return testDevice{device: result.Record, keys: keys}
}

func registerHTTPDevice(t *testing.T, baseURL string, request RegisterDeviceRequest) {
	t.Helper()
	body := mustJSON(t, request)
	httpRequest, _ := http.NewRequest(http.MethodPost, baseURL+"/square/devices", bytes.NewReader(body))
	httpRequest.Header.Set("X-YNX-Square-Key", squareAPIKey)
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatal(err)
	}
	assertStatus(t, response, http.StatusCreated)
}

func signedHTTP(t *testing.T, baseURL, method, path string, body []byte, deviceID string, private ed25519.PrivateKey, at time.Time, serviceKey string) *http.Response {
	t.Helper()
	timestamp := at.Format(time.RFC3339)
	request, _ := http.NewRequest(method, baseURL+path, bytes.NewReader(body))
	request.Header.Set("X-YNX-Square-Key", serviceKey)
	request.Header.Set("X-YNX-Device-ID", deviceID)
	request.Header.Set("X-YNX-Timestamp", timestamp)
	request.Header.Set("X-YNX-Device-Signature", nativewallet.Sign(private, RequestSignaturePayload(method, path, timestamp, body)))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func assertStatus(t *testing.T, response *http.Response, want int) {
	t.Helper()
	defer response.Body.Close()
	if response.StatusCode != want {
		t.Fatalf("status %d want %d: %s", response.StatusCode, want, readAll(response.Body))
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func decodeJSON(t *testing.T, reader io.Reader, value any) {
	t.Helper()
	if err := json.NewDecoder(reader).Decode(value); err != nil {
		t.Fatal(err)
	}
}

func readAll(reader io.Reader) string {
	data, _ := io.ReadAll(reader)
	return string(data)
}
