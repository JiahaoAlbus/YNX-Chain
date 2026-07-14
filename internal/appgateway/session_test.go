package appgateway

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type ownershipFixture struct {
	accountPrivate *secp256k1.PrivateKey
	accountPublic  string
	account        string
	devicePrivate  ed25519.PrivateKey
	devicePublic   string
	deviceID       string
}

func TestOwnershipSessionLifecyclePersistenceAndProtectedRoutes(t *testing.T) {
	chat, chatServer := startUpstream(t, "chat", "X-YNX-Chat-Key", testChatKey)
	square, squareServer := startUpstream(t, "square", "X-YNX-Square-Key", testSquareKey)
	now := time.Date(2026, 7, 14, 8, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "app-gateway", "state.json")
	cfg := testConfig(t, chatServer.URL, squareServer.URL, 100)
	cfg.StatePath = statePath
	cfg.Now = func() time.Time { return now }
	gateway, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(gateway).Handler())
	fixture := newOwnershipFixture(t, 0x31, 0x41, "device-primary")

	challenge := createHTTPChallenge(t, server.URL, fixture, testOrigin, http.StatusCreated)
	if challenge.Account != fixture.account || challenge.SignDoc.Account != fixture.account || challenge.SignDoc.ChainID != 6423 || challenge.SignDoc.Origin != testOrigin || challenge.Algorithms["account"] != "secp256k1-sha256-der-low-s" || len(challenge.Warnings) != 2 {
		t.Fatalf("challenge response: %+v", challenge)
	}
	session := verifyHTTPChallenge(t, server.URL, challenge, fixture, testOrigin, http.StatusCreated, false)
	if session.Account != fixture.account || session.DeviceID != fixture.deviceID || session.Token == "" {
		t.Fatalf("session response: %+v", session)
	}
	verifyHTTPChallenge(t, server.URL, challenge, fixture, testOrigin, http.StatusUnauthorized, false)

	stateBytes, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(stateBytes, []byte(session.Token)) || !bytes.Contains(stateBytes, []byte("tokenHash")) {
		t.Fatal("session token was stored in plaintext or token hash is missing")
	}
	if info, err := os.Stat(statePath); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("state mode: %v %v", info, err)
	}

	registration := map[string]any{"idempotencyKey": "register-primary", "account": fixture.account, "deviceId": fixture.deviceID, "signingPublicKey": fixture.devicePublic, "proofSignature": "upstream-validates-device-proof"}
	response := protectedRequest(t, server.URL, http.MethodPost, "/app/square/devices", registration, fixture.deviceID, session.Token, testOrigin)
	if response.Code != http.StatusCreated {
		t.Fatalf("registration status %d: %s", response.Code, response.Body.String())
	}
	response = protectedRequest(t, server.URL, http.MethodPost, "/app/square/posts", map[string]any{"idempotencyKey": "post-primary", "content": "ownership bound"}, fixture.deviceID, session.Token, testOrigin)
	if response.Code != http.StatusCreated {
		t.Fatalf("protected post status %d: %s", response.Code, response.Body.String())
	}
	response = protectedRequest(t, server.URL, http.MethodPost, "/app/chat/conversations", map[string]any{"idempotencyKey": "conversation-primary", "members": []string{fixture.account, fixture.account}}, fixture.deviceID, session.Token, testOrigin)
	if response.Code != http.StatusCreated {
		t.Fatalf("protected chat status %d: %s", response.Code, response.Body.String())
	}
	if len(square.snapshot()) != 2 || len(chat.snapshot()) != 1 {
		t.Fatalf("protected upstream calls square=%+v chat=%+v", square.snapshot(), chat.snapshot())
	}

	badRegistration := map[string]any{"idempotencyKey": "register-other", "account": fixture.account, "deviceId": "device-other", "signingPublicKey": fixture.devicePublic, "proofSignature": "x"}
	if got := protectedRequest(t, server.URL, http.MethodPost, "/app/chat/devices", badRegistration, fixture.deviceID, session.Token, testOrigin); got.Code != http.StatusUnauthorized {
		t.Fatalf("mismatched registration status %d: %s", got.Code, got.Body.String())
	}
	if got := protectedRequest(t, server.URL, http.MethodPost, "/app/square/posts", map[string]any{}, "device-other", session.Token, testOrigin); got.Code != http.StatusUnauthorized {
		t.Fatalf("wrong device status %d", got.Code)
	}
	if got := protectedRequest(t, server.URL, http.MethodPost, "/app/square/posts", map[string]any{}, fixture.deviceID, session.Token, "https://evil.example"); got.Code != http.StatusForbidden {
		t.Fatalf("wrong origin status %d", got.Code)
	}

	server.Close()
	restarted, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.AuthenticateSession(testOrigin, session.Token, fixture.deviceID); err != nil {
		t.Fatalf("persisted session not restored: %v", err)
	}
	restartedServer := httptest.NewServer(NewServer(restarted).Handler())
	defer restartedServer.Close()
	revoke := protectedRequest(t, restartedServer.URL, http.MethodPost, "/app/session/revoke", nil, fixture.deviceID, session.Token, testOrigin)
	if revoke.Code != http.StatusOK {
		t.Fatalf("revoke status %d: %s", revoke.Code, revoke.Body.String())
	}
	if _, err := restarted.AuthenticateSession(testOrigin, session.Token, fixture.deviceID); err == nil {
		t.Fatal("revoked session remained active")
	}
}

func TestOwnershipChallengeRejectsWrongKeysHighSExpiryAndReplay(t *testing.T) {
	_, chatServer := startUpstream(t, "chat", "X-YNX-Chat-Key", testChatKey)
	_, squareServer := startUpstream(t, "square", "X-YNX-Square-Key", testSquareKey)
	now := time.Date(2026, 7, 14, 9, 0, 0, 0, time.UTC)
	cfg := testConfig(t, chatServer.URL, squareServer.URL, 100)
	cfg.Now = func() time.Time { return now }
	gateway, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(gateway).Handler())
	defer server.Close()
	owner := newOwnershipFixture(t, 0x51, 0x61, "device-owner")
	other := newOwnershipFixture(t, 0x52, 0x62, "device-other")

	challenge := createHTTPChallenge(t, server.URL, owner, testOrigin, http.StatusCreated)
	verifyHTTPChallengeWith(t, server.URL, challenge, owner, other.accountPrivate, owner.devicePrivate, testOrigin, http.StatusUnauthorized, false)
	verifyHTTPChallengeWith(t, server.URL, challenge, owner, owner.accountPrivate, other.devicePrivate, testOrigin, http.StatusUnauthorized, false)
	verifyHTTPChallengeWith(t, server.URL, challenge, owner, owner.accountPrivate, owner.devicePrivate, testOrigin, http.StatusUnauthorized, true)

	now = now.Add(6 * time.Minute)
	verifyHTTPChallenge(t, server.URL, challenge, owner, testOrigin, http.StatusUnauthorized, false)
	challenge = createHTTPChallenge(t, server.URL, owner, testOrigin, http.StatusCreated)
	session := verifyHTTPChallenge(t, server.URL, challenge, owner, testOrigin, http.StatusCreated, false)
	now = now.Add(31 * time.Minute)
	if _, err := gateway.AuthenticateSession(testOrigin, session.Token, owner.deviceID); err == nil {
		t.Fatal("expired session authenticated")
	}
}

func TestNativeMobileOwnershipSessionIsBoundSeparatelyFromBrowserOrigin(t *testing.T) {
	_, chatServer := startUpstream(t, "chat", "X-YNX-Chat-Key", testChatKey)
	square, squareServer := startUpstream(t, "square", "X-YNX-Square-Key", testSquareKey)
	gateway := newTestGateway(t, chatServer.URL, squareServer.URL, 100)
	server := httptest.NewServer(NewServer(gateway).Handler())
	defer server.Close()
	fixture := newOwnershipFixture(t, 0x81, 0x82, "mobile-device-primary")

	challenge := createNativeHTTPChallenge(t, server.URL, fixture, http.StatusCreated)
	if challenge.SignDoc.Origin != nativeMobileBinding {
		t.Fatalf("native sign document binding %q", challenge.SignDoc.Origin)
	}
	session := verifyNativeHTTPChallenge(t, server.URL, challenge, fixture, http.StatusCreated)
	if _, err := gateway.AuthenticateSession(nativeMobileBinding, session.Token, fixture.deviceID); err != nil {
		t.Fatalf("native session did not authenticate: %v", err)
	}

	registration := map[string]any{"idempotencyKey": "register-native-primary", "account": fixture.account, "deviceId": fixture.deviceID, "signingPublicKey": fixture.devicePublic, "proofSignature": "upstream-validates-device-proof"}
	response := protectedNativeRequest(t, server.URL, http.MethodPost, "/app/square/devices", registration, fixture.deviceID, session.Token)
	if response.Code != http.StatusCreated || len(square.snapshot()) != 1 {
		t.Fatalf("native registration status=%d upstream=%+v body=%s", response.Code, square.snapshot(), response.Body.String())
	}

	mixed := mustProtectedRequest(t, http.MethodPost, server.URL+"/app/square/posts", []byte(`{}`), fixture.deviceID, session.Token, testOrigin)
	mixed.Header.Set("X-YNX-Client", nativeMobileClient)
	mixedResponse, err := http.DefaultClient.Do(mixed)
	if err != nil {
		t.Fatal(err)
	}
	mixedResponse.Body.Close()
	if mixedResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("mixed browser/native binding status %d", mixedResponse.StatusCode)
	}

	revoke := protectedNativeRequest(t, server.URL, http.MethodPost, "/app/session/revoke", nil, fixture.deviceID, session.Token)
	if revoke.Code != http.StatusOK {
		t.Fatalf("native revoke status %d: %s", revoke.Code, revoke.Body.String())
	}
	if _, err := gateway.AuthenticateSession(nativeMobileBinding, session.Token, fixture.deviceID); err == nil {
		t.Fatal("revoked native session remained active")
	}
}

func TestOwnershipStateTamperFailsClosed(t *testing.T) {
	_, chatServer := startUpstream(t, "chat", "X-YNX-Chat-Key", testChatKey)
	_, squareServer := startUpstream(t, "square", "X-YNX-Square-Key", testSquareKey)
	cfg := testConfig(t, chatServer.URL, squareServer.URL, 100)
	gateway, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	fixture := newOwnershipFixture(t, 0x71, 0x72, "device-tamper")
	if _, err := gateway.CreateChallenge(testOrigin, ChallengeRequest{Account: fixture.account, DeviceID: fixture.deviceID, DeviceSigningPublicKey: fixture.devicePublic}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	data = bytes.Replace(data, []byte(`"status": "pending"`), []byte(`"status": "consumed"`), 1)
	if err := os.WriteFile(cfg.StatePath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "integrity verification failed") {
		t.Fatalf("tampered state accepted: %v", err)
	}
}

func newOwnershipFixture(t *testing.T, accountSeed, deviceSeed byte, deviceID string) ownershipFixture {
	t.Helper()
	accountPrivate := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{accountSeed}, 32))
	accountPublicBytes := accountPrivate.PubKey().SerializeCompressed()
	canonical, err := consensus.NativeAddress(accountPublicBytes)
	if err != nil {
		t.Fatal(err)
	}
	account, err := accountaddress.Encode(canonical)
	if err != nil {
		t.Fatal(err)
	}
	devicePrivate := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{deviceSeed}, ed25519.SeedSize))
	devicePublic := devicePrivate.Public().(ed25519.PublicKey)
	return ownershipFixture{accountPrivate: accountPrivate, accountPublic: hex.EncodeToString(accountPublicBytes), account: account, devicePrivate: devicePrivate, devicePublic: nativewallet.EncodePublicKey(devicePublic), deviceID: deviceID}
}

func createHTTPChallenge(t *testing.T, baseURL string, fixture ownershipFixture, origin string, want int) ChallengeResponse {
	t.Helper()
	body, _ := json.Marshal(ChallengeRequest{Account: fixture.account, DeviceID: fixture.deviceID, DeviceSigningPublicKey: fixture.devicePublic})
	response, err := http.DefaultClient.Do(mustRequest(t, http.MethodPost, baseURL+"/app/session/challenges", body, origin))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != want {
		t.Fatalf("challenge status %d want %d: %s", response.StatusCode, want, readAll(response.Body))
	}
	var challenge ChallengeResponse
	if want == http.StatusCreated {
		if err := json.NewDecoder(response.Body).Decode(&challenge); err != nil {
			t.Fatal(err)
		}
	}
	return challenge
}

func verifyHTTPChallenge(t *testing.T, baseURL string, challenge ChallengeResponse, fixture ownershipFixture, origin string, want int, highS bool) SessionResponse {
	t.Helper()
	return verifyHTTPChallengeWith(t, baseURL, challenge, fixture, fixture.accountPrivate, fixture.devicePrivate, origin, want, highS)
}

func verifyHTTPChallengeWith(t *testing.T, baseURL string, challenge ChallengeResponse, fixture ownershipFixture, accountPrivate *secp256k1.PrivateKey, devicePrivate ed25519.PrivateKey, origin string, want int, highS bool) SessionResponse {
	t.Helper()
	signBytes, err := base64.RawStdEncoding.DecodeString(challenge.SignBytes)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(signBytes)
	accountSignature := ecdsa.Sign(accountPrivate, digest[:])
	accountSignatureBytes := accountSignature.Serialize()
	if highS {
		r := accountSignature.R()
		s := accountSignature.S()
		s.Negate()
		accountSignatureBytes = serializeDERScalars(r, s)
	}
	requestBody, _ := json.Marshal(VerifyChallengeRequest{AccountPublicKey: hex.EncodeToString(accountPrivate.PubKey().SerializeCompressed()), AccountSignature: hex.EncodeToString(accountSignatureBytes), DeviceSignature: nativewallet.Sign(devicePrivate, signBytes)})
	response, err := http.DefaultClient.Do(mustRequest(t, http.MethodPost, baseURL+"/app/session/challenges/"+challenge.ChallengeID+"/verify", requestBody, origin))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != want {
		t.Fatalf("verify status %d want %d: %s", response.StatusCode, want, readAll(response.Body))
	}
	var session SessionResponse
	if want == http.StatusCreated {
		if err := json.NewDecoder(response.Body).Decode(&session); err != nil {
			t.Fatal(err)
		}
	}
	return session
}

func mustRequest(t *testing.T, method, url string, body []byte, origin string) *http.Request {
	t.Helper()
	request, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", origin)
	request.Header.Set("Content-Type", "application/json")
	return request
}

func protectedRequest(t *testing.T, baseURL, method, path string, value any, deviceID, token, origin string) *httptest.ResponseRecorder {
	t.Helper()
	var body []byte
	if value != nil {
		body, _ = json.Marshal(value)
	}
	recorder := httptest.NewRecorder()
	response, err := http.DefaultClient.Do(mustProtectedRequest(t, method, baseURL+path, body, deviceID, token, origin))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	recorder.Code = response.StatusCode
	recorder.HeaderMap = response.Header.Clone()
	_, _ = recorder.Body.ReadFrom(response.Body)
	return recorder
}

func createNativeHTTPChallenge(t *testing.T, baseURL string, fixture ownershipFixture, want int) ChallengeResponse {
	t.Helper()
	body, _ := json.Marshal(ChallengeRequest{Account: fixture.account, DeviceID: fixture.deviceID, DeviceSigningPublicKey: fixture.devicePublic})
	request := mustRequest(t, http.MethodPost, baseURL+"/app/session/challenges", body, "")
	request.Header.Set("X-YNX-Client", nativeMobileClient)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != want {
		t.Fatalf("native challenge status %d want %d: %s", response.StatusCode, want, readAll(response.Body))
	}
	var challenge ChallengeResponse
	if want == http.StatusCreated {
		if err := json.NewDecoder(response.Body).Decode(&challenge); err != nil {
			t.Fatal(err)
		}
	}
	return challenge
}

func verifyNativeHTTPChallenge(t *testing.T, baseURL string, challenge ChallengeResponse, fixture ownershipFixture, want int) SessionResponse {
	t.Helper()
	signBytes, err := base64.RawStdEncoding.DecodeString(challenge.SignBytes)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(signBytes)
	body, _ := json.Marshal(VerifyChallengeRequest{
		AccountPublicKey: fixture.accountPublic,
		AccountSignature: hex.EncodeToString(ecdsa.Sign(fixture.accountPrivate, digest[:]).Serialize()),
		DeviceSignature:  nativewallet.Sign(fixture.devicePrivate, signBytes),
	})
	request := mustRequest(t, http.MethodPost, baseURL+"/app/session/challenges/"+challenge.ChallengeID+"/verify", body, "")
	request.Header.Set("X-YNX-Client", nativeMobileClient)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != want {
		t.Fatalf("native verify status %d want %d: %s", response.StatusCode, want, readAll(response.Body))
	}
	var session SessionResponse
	if want == http.StatusCreated {
		if err := json.NewDecoder(response.Body).Decode(&session); err != nil {
			t.Fatal(err)
		}
	}
	return session
}

func protectedNativeRequest(t *testing.T, baseURL, method, path string, value any, deviceID, token string) *httptest.ResponseRecorder {
	t.Helper()
	var body []byte
	if value != nil {
		body, _ = json.Marshal(value)
	}
	request := mustProtectedRequest(t, method, baseURL+path, body, deviceID, token, "")
	request.Header.Set("X-YNX-Client", nativeMobileClient)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	recorder := httptest.NewRecorder()
	recorder.Code = response.StatusCode
	recorder.HeaderMap = response.Header.Clone()
	_, _ = recorder.Body.ReadFrom(response.Body)
	return recorder
}

func mustProtectedRequest(t *testing.T, method, url string, body []byte, deviceID, token, origin string) *http.Request {
	t.Helper()
	request := mustRequest(t, method, url, body, origin)
	request.Header.Set("X-YNX-Device-ID", deviceID)
	request.Header.Set("X-YNX-App-Session", token)
	return request
}

func serializeDERScalars(r, s secp256k1.ModNScalar) []byte {
	rBytes := derInteger(r.Bytes())
	sBytes := derInteger(s.Bytes())
	result := []byte{0x30, byte(4 + len(rBytes) + len(sBytes)), 0x02, byte(len(rBytes))}
	result = append(result, rBytes...)
	result = append(result, 0x02, byte(len(sBytes)))
	return append(result, sBytes...)
}

func derInteger(value [32]byte) []byte {
	bytesValue := value[:]
	for len(bytesValue) > 1 && bytesValue[0] == 0 {
		bytesValue = bytesValue[1:]
	}
	result := append([]byte(nil), bytesValue...)
	if result[0]&0x80 != 0 {
		result = append([]byte{0}, result...)
	}
	return result
}
