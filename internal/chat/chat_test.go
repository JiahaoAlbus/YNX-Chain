package chat

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
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

const (
	aliceAddress = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	bobAddress   = "ynx1llllllllllllllllllllllllllllllllyj698f"
	chatAPIKey   = "test-chat-api-key-123456789"
)

type testDevice struct {
	device Device
	keys   nativewallet.DeviceKeys
}

func TestPersistentEncryptedChatLifecycle(t *testing.T) {
	now := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "chat", "state.json")
	service := newTestService(t, statePath, func() time.Time { return now })
	alice := registerTestDevice(t, service, aliceAddress, "alice-device", 0x11)
	bob := registerTestDevice(t, service, bobAddress, "bob-device", 0x22)

	replay := registrationRequest(aliceAddress, "alice-device", "register-alice", alice.keys)
	replayed, err := service.RegisterDevice(replay)
	if err != nil || !replayed.Replayed {
		t.Fatalf("replay registration: %+v %v", replayed, err)
	}
	replay.EncryptionPublicKey = nativewallet.EncodePublicKey(bob.keys.EncryptionPublic)
	replay.ProofSignature = nativewallet.Sign(alice.keys.SigningPrivate, DeviceRegistrationPayload(replay))
	if _, err := service.RegisterDevice(replay); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed registration replay should conflict: %v", err)
	}
	invalid := registrationRequest("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf", "evm-device", "register-evm", alice.keys)
	if _, err := service.RegisterDevice(invalid); !errors.Is(err, ErrInvalid) {
		t.Fatalf("EVM address accepted as native identity: %v", err)
	}
	badProof := registrationRequest(aliceAddress, "bad-proof-device", "register-bad-proof", alice.keys)
	badProof.ProofSignature = nativewallet.Sign(bob.keys.SigningPrivate, DeviceRegistrationPayload(badProof))
	if _, err := service.RegisterDevice(badProof); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("invalid private-key proof accepted: %v", err)
	}

	conversationResult, err := service.CreateConversation(alice.device, CreateConversationRequest{IdempotencyKey: "conversation-alice-bob", Members: []string{aliceAddress, bobAddress}})
	if err != nil {
		t.Fatal(err)
	}
	conversation := conversationResult.Record
	aad := []byte("ynx-chat-v1|" + conversation.ID + "|message-001")
	envelope, err := nativewallet.Encrypt(alice.keys.EncryptionPrivate, bob.keys.EncryptionPublic, []byte("private square coordination"), aad, bytes.NewReader(bytes.Repeat([]byte{0x33}, 24)))
	if err != nil {
		t.Fatal(err)
	}
	messageRequest := SendMessageRequest{MessageID: "message-001", Algorithm: envelope.Algorithm, Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext}
	messageResult, err := service.SendMessage(alice.device, conversation.ID, messageRequest)
	if err != nil || messageResult.Replayed {
		t.Fatalf("send message: %+v %v", messageResult, err)
	}
	messageReplay, err := service.SendMessage(alice.device, conversation.ID, messageRequest)
	if err != nil || !messageReplay.Replayed {
		t.Fatalf("message replay: %+v %v", messageReplay, err)
	}
	changed := messageRequest
	replacement := "A"
	if changed.Ciphertext[0] == 'A' {
		replacement = "B"
	}
	changed.Ciphertext = replacement + changed.Ciphertext[1:]
	if _, err := service.SendMessage(alice.device, conversation.ID, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed message replay should conflict: %v", err)
	}

	now = now.Add(time.Second)
	if _, err := service.Acknowledge(bob.device, conversation.ID, messageRequest.MessageID, "delivered"); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Second)
	read, err := service.Acknowledge(bob.device, conversation.ID, messageRequest.MessageID, "read")
	if err != nil || read.ReadAt[bobAddress].IsZero() {
		t.Fatalf("read acknowledgement: %+v %v", read, err)
	}

	stateData, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(stateData, []byte("private square coordination")) {
		t.Fatal("plaintext was persisted in chat state")
	}
	info, err := os.Stat(statePath)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("state mode: %v %v", info, err)
	}
	restarted := newTestService(t, statePath, func() time.Time { return now })
	if health := restarted.Health(); health.DeviceCount != 2 || health.ConversationCount != 1 || health.MessageCount != 1 || health.PlaintextStored {
		t.Fatalf("unexpected restarted health: %+v", health)
	}
	if _, err := restarted.RevokeDevice(alice.device, alice.device.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.AuthenticateDevice(alice.device.ID, http.MethodGet, "/chat/conversations/"+conversation.ID, now.Format(time.RFC3339), nativewallet.Sign(alice.keys.SigningPrivate, RequestSignaturePayload(http.MethodGet, "/chat/conversations/"+conversation.ID, now.Format(time.RFC3339), nil)), nil); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("revoked device authenticated: %v", err)
	}

	tampered := append([]byte(nil), stateData...)
	tampered[len(tampered)/2] ^= 1
	tamperPath := filepath.Join(t.TempDir(), "tampered.json")
	if err := os.WriteFile(tamperPath, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{StatePath: tamperPath, APIKey: chatAPIKey}); err == nil {
		t.Fatal("tampered persistent state was accepted")
	}
}

func TestChatHTTPAuthenticationAndRoutes(t *testing.T) {
	now := time.Date(2026, 7, 14, 13, 0, 0, 0, time.UTC)
	service := newTestService(t, filepath.Join(t.TempDir(), "state.json"), func() time.Time { return now })
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()
	aliceKeys := generateKeys(t, 0x41)
	bobKeys := generateKeys(t, 0x42)

	registerHTTPDevice(t, server.URL, registrationRequest(aliceAddress, "alice-http", "register-alice-http", aliceKeys), http.StatusCreated)
	registerHTTPDevice(t, server.URL, registrationRequest(bobAddress, "bob-http", "register-bob-http", bobKeys), http.StatusCreated)
	createBody := mustJSON(t, CreateConversationRequest{IdempotencyKey: "http-conversation", Members: []string{aliceAddress, bobAddress}})
	response := signedHTTP(t, server.URL, http.MethodPost, "/chat/conversations", createBody, "alice-http", aliceKeys.SigningPrivate, now, chatAPIKey)
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create conversation status %d: %s", response.StatusCode, readAll(response.Body))
	}
	var created Result[Conversation]
	decodeJSON(t, response.Body, &created)

	envelope, err := nativewallet.Encrypt(aliceKeys.EncryptionPrivate, bobKeys.EncryptionPublic, []byte("hello"), []byte("http"), bytes.NewReader(bytes.Repeat([]byte{0x44}, 24)))
	if err != nil {
		t.Fatal(err)
	}
	messageBody := mustJSON(t, SendMessageRequest{MessageID: "http-message", Algorithm: envelope.Algorithm, Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext})
	messagePath := "/chat/conversations/" + created.Record.ID + "/messages"
	response = signedHTTP(t, server.URL, http.MethodPost, messagePath, messageBody, "alice-http", aliceKeys.SigningPrivate, now, chatAPIKey)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("send message status %d: %s", response.StatusCode, readAll(response.Body))
	}
	response.Body.Close()

	response = signedHTTP(t, server.URL, http.MethodGet, messagePath, nil, "bob-http", bobKeys.SigningPrivate, now, chatAPIKey)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list messages status %d: %s", response.StatusCode, readAll(response.Body))
	}
	response.Body.Close()
	ackPath := messagePath + "/http-message/read"
	response = signedHTTP(t, server.URL, http.MethodPost, ackPath, nil, "bob-http", bobKeys.SigningPrivate, now, chatAPIKey)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("ack status %d: %s", response.StatusCode, readAll(response.Body))
	}
	response.Body.Close()

	response = signedHTTP(t, server.URL, http.MethodGet, "/chat/conversations/"+created.Record.ID, nil, "alice-http", aliceKeys.SigningPrivate, now.Add(-10*time.Minute), chatAPIKey)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("stale signature status %d", response.StatusCode)
	}
	response.Body.Close()
	response = signedHTTP(t, server.URL, http.MethodGet, messagePath, nil, "bob-http", bobKeys.SigningPrivate, now, "wrong-service-key")
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("invalid service key status %d", response.StatusCode)
	}
	response.Body.Close()

	healthResponse, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer healthResponse.Body.Close()
	var health Health
	decodeJSON(t, healthResponse.Body, &health)
	if !health.OK || health.TruthfulStatus != "local-bounded-chat-core-not-remote-deployed" || health.PlaintextStored {
		t.Fatalf("untruthful health: %+v", health)
	}
}

func newTestService(t *testing.T, statePath string, now func() time.Time) *Service {
	t.Helper()
	service, err := New(Config{StatePath: statePath, APIKey: chatAPIKey, Now: now})
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

func registrationRequest(account, deviceID, idempotencyKey string, keys nativewallet.DeviceKeys) RegisterDeviceRequest {
	req := RegisterDeviceRequest{Account: account, DeviceID: deviceID, IdempotencyKey: idempotencyKey, SigningPublicKey: nativewallet.EncodePublicKey(keys.SigningPublic), EncryptionPublicKey: nativewallet.EncodePublicKey(keys.EncryptionPublic)}
	req.ProofSignature = nativewallet.Sign(keys.SigningPrivate, DeviceRegistrationPayload(req))
	return req
}

func registerTestDevice(t *testing.T, service *Service, account, deviceID string, seed byte) testDevice {
	t.Helper()
	keys := generateKeys(t, seed)
	result, err := service.RegisterDevice(registrationRequest(account, deviceID, "register-"+deviceID[:strings.Index(deviceID, "-")], keys))
	if err != nil {
		t.Fatal(err)
	}
	return testDevice{device: result.Record, keys: keys}
}

func registerHTTPDevice(t *testing.T, baseURL string, request RegisterDeviceRequest, want int) {
	t.Helper()
	body := mustJSON(t, request)
	httpRequest, _ := http.NewRequest(http.MethodPost, baseURL+"/chat/devices", bytes.NewReader(body))
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("X-YNX-Chat-Key", chatAPIKey)
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != want {
		t.Fatalf("register status %d: %s", response.StatusCode, readAll(response.Body))
	}
}

func signedHTTP(t *testing.T, baseURL, method, path string, body []byte, deviceID string, private ed25519.PrivateKey, at time.Time, serviceKey string) *http.Response {
	t.Helper()
	timestamp := at.Format(time.RFC3339)
	request, _ := http.NewRequest(method, baseURL+path, bytes.NewReader(body))
	request.Header.Set("X-YNX-Chat-Key", serviceKey)
	request.Header.Set("X-YNX-Device-ID", deviceID)
	request.Header.Set("X-YNX-Timestamp", timestamp)
	request.Header.Set("X-YNX-Device-Signature", nativewallet.Sign(private, RequestSignaturePayload(method, path, timestamp, body)))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
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

func TestValidateConfig(t *testing.T) {
	tests := []Config{{}, {StatePath: "state.json", APIKey: "short"}, {StatePath: "state.json", APIKey: chatAPIKey, MaxCiphertextBytes: 1}, {StatePath: "state.json", APIKey: chatAPIKey, MaxCiphertextBytes: 2 * 1024 * 1024}}
	for index, cfg := range tests {
		if err := ValidateConfig(cfg); err == nil {
			t.Fatalf("invalid config %d accepted: %+v", index, cfg)
		}
	}
	if err := ValidateConfig(Config{StatePath: "state.json", APIKey: chatAPIKey}); err != nil {
		t.Fatal(err)
	}
}
