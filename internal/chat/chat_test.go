package chat

import (
	"bytes"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/sha256"
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

func TestMobileChatEncryptionVector(t *testing.T) {
	aliceSecret := bytes.Repeat([]byte{0x41}, 32)
	bobSecret := bytes.Repeat([]byte{0x42}, 32)
	alicePrivate := sha256.Sum256(append([]byte("YNX_CHAT_ENCRYPTION_KEY_V1\n"), aliceSecret...))
	bobPrivate := sha256.Sum256(append([]byte("YNX_CHAT_ENCRYPTION_KEY_V1\n"), bobSecret...))
	aliceKey, err := ecdh.X25519().NewPrivateKey(alicePrivate[:])
	if err != nil {
		t.Fatal(err)
	}
	bobKey, err := ecdh.X25519().NewPrivateKey(bobPrivate[:])
	if err != nil {
		t.Fatal(err)
	}
	if got := nativewallet.EncodePublicKey(aliceKey.PublicKey().Bytes()); got != "+QxS9u2JoARjv3sLy26eC2dI+7nOQz+RRPzqlFmovEI" {
		t.Fatalf("mobile Alice encryption public key mismatch: %s", got)
	}
	if got := nativewallet.EncodePublicKey(bobKey.PublicKey().Bytes()); got != "6WVQ++QAF0ooHRrQW2ym8KVsNrD2IrkoQ7AC0jD9GWk" {
		t.Fatalf("mobile Bob encryption public key mismatch: %s", got)
	}
	envelope := nativewallet.EncryptedEnvelope{
		Algorithm:  "x25519-hkdf-sha256-xchacha20poly1305",
		Nonce:      "MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMz",
		Ciphertext: "hWJma27C1qBVFMbUQK01kiRzNG9vThV16xvrGKVb8WD7DLI",
	}
	plaintext, err := nativewallet.Decrypt(bobPrivate[:], aliceKey.PublicKey().Bytes(), []byte("ynx-chat-v1|conv_mobile_vector|message_mobile_vector"), envelope)
	if err != nil || string(plaintext) != "native chat message" {
		t.Fatalf("decrypt mobile Chat vector: %q %v", plaintext, err)
	}
}

func TestMobileMultiDeviceEnvelopeVector(t *testing.T) {
	senderPrivate := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x41}, ed25519.SeedSize))
	req := SendMessageRequest{
		MessageID: "message_multi_vector",
		Envelopes: []MessageEnvelope{
			{RecipientAccount: bobAddress, RecipientDeviceID: "bob-phone", Algorithm: messageAlgorithm, EphemeralPublicKey: "/y7kVgHsG2cxDHeQQEWFrmlzMe7hwfjPJBlzHB//Pms", Nonce: "KyIspY1eGst2yX8X9O4DdOnlLYx8BeID", Ciphertext: "ppnLcfWhGrFmXB/wkXZ34+x0UE0qbLLOhKFVQ8Z2uon2BsuRZ//A0Q", CiphertextHash: "4d992ed906ec07c6e04020740216f9f95af2a6ebde3dc6e7514a263036996105"},
			{RecipientAccount: bobAddress, RecipientDeviceID: "bob-tablet", Algorithm: messageAlgorithm, EphemeralPublicKey: "/y7kVgHsG2cxDHeQQEWFrmlzMe7hwfjPJBlzHB//Pms", Nonce: "GQV7Yr4xKdVoUW+nEvtJLMd150+LF2Yt", Ciphertext: "sEq8c0gf2yOph3xLZPBMLjuBijpkSKvcrQzfbZtMUlXFqOLJL7uScw", CiphertextHash: "8ea95b65259407971e96c028c30e3623809a90448ff0cb761c99860e560d4615"},
		},
		SenderSignature: "eQQoXodUn0aY7FU1Ruy4G6SFZuFGyXkRXUzveFhHtTQvDPXvvDJaqfPGFnsVwZoecHI4Mme1goaQ/H2wyg/9Aw",
	}
	if !nativewallet.Verify(nativewallet.EncodePublicKey(senderPrivate.Public().(ed25519.PublicKey)), MessageSignaturePayload("conv_multi_vector", aliceAddress, "alice-mobile", req), req.SenderSignature) {
		t.Fatal("mobile multi-device sender signature does not match Go canonical payload")
	}
	ephemeralPublic, err := nativewallet.DecodePublicKey(req.Envelopes[0].EphemeralPublicKey, 32)
	if err != nil {
		t.Fatal(err)
	}
	for index, seed := range []byte{0x42, 0x43} {
		deviceSecret := bytes.Repeat([]byte{seed}, 32)
		devicePrivate := sha256.Sum256(append([]byte("YNX_CHAT_ENCRYPTION_KEY_V1\n"), deviceSecret...))
		envelope := req.Envelopes[index]
		aad := MessageEnvelopeAAD("conv_multi_vector", req.MessageID, "alice-mobile", envelope.RecipientAccount, envelope.RecipientDeviceID, envelope.Algorithm, envelope.EphemeralPublicKey)
		plaintext, err := nativewallet.Decrypt(devicePrivate[:], ephemeralPublic, aad, nativewallet.EncryptedEnvelope{Algorithm: envelope.Algorithm, Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext})
		if err != nil || string(plaintext) != "multi device native chat" {
			t.Fatalf("decrypt mobile envelope %s: %q %v", envelope.RecipientDeviceID, plaintext, err)
		}
	}
}

func TestPersistentEncryptedChatLifecycle(t *testing.T) {
	now := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "chat", "state.json")
	service := newTestService(t, statePath, func() time.Time { return now })
	alice := registerTestDevice(t, service, aliceAddress, "alice-device", 0x11)
	bob := registerTestDevice(t, service, bobAddress, "bob-device", 0x22)
	if _, err := service.Devices(alice.device, bobAddress); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("device directory allowed before a shared conversation: %v", err)
	}

	replay := registrationRequest(aliceAddress, "alice-device", "register-alice-device", alice.keys)
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
	conversations := service.Conversations(alice.device)
	if len(conversations) != 1 || conversations[0].ID != conversation.ID {
		t.Fatalf("conversation list: %+v", conversations)
	}
	devices, err := service.Devices(alice.device, bobAddress)
	if err != nil || len(devices) != 1 || devices[0].ID != bob.device.ID || devices[0].Status != "active" {
		t.Fatalf("active member devices: %+v %v", devices, err)
	}
	messageRequest := encryptedMessageRequest(t, conversation.ID, "message-001", alice, []testDevice{alice, bob}, "private square coordination", 0x33)
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
	if changed.Envelopes[0].Ciphertext[0] == 'A' {
		replacement = "B"
	}
	changed.Envelopes = append([]MessageEnvelope(nil), changed.Envelopes...)
	changed.Envelopes[0].Ciphertext = replacement + changed.Envelopes[0].Ciphertext[1:]
	if _, err := service.SendMessage(alice.device, conversation.ID, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed message replay should conflict: %v", err)
	}

	now = now.Add(time.Second)
	if _, err := service.Acknowledge(bob.device, conversation.ID, messageRequest.MessageID, "delivered"); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Second)
	read, err := service.Acknowledge(bob.device, conversation.ID, messageRequest.MessageID, "read")
	if err != nil || read.ReadAt[bob.device.ID].IsZero() {
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
	devices, err = restarted.Devices(bob.device, aliceAddress)
	if err != nil || len(devices) != 1 || devices[0].Status != "revoked" {
		t.Fatalf("revoked historical device directory: %+v %v", devices, err)
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

func TestMultiDeviceEnvelopeCoverageAndPerDeviceAcknowledgements(t *testing.T) {
	now := time.Date(2026, 7, 14, 12, 30, 0, 0, time.UTC)
	service := newTestService(t, filepath.Join(t.TempDir(), "state.json"), func() time.Time { return now })
	alicePrimary := registerTestDevice(t, service, aliceAddress, "alice-primary", 0x51)
	aliceTablet := registerTestDevice(t, service, aliceAddress, "alice-tablet", 0x52)
	bobPrimary := registerTestDevice(t, service, bobAddress, "bob-primary", 0x53)
	bobTablet := registerTestDevice(t, service, bobAddress, "bob-tablet", 0x54)

	created, err := service.CreateConversation(alicePrimary.device, CreateConversationRequest{IdempotencyKey: "conversation-multi-device", Members: []string{aliceAddress, bobAddress}})
	if err != nil {
		t.Fatal(err)
	}
	recipients := []testDevice{alicePrimary, aliceTablet, bobPrimary, bobTablet}
	request := encryptedMessageRequest(t, created.Record.ID, "message-multi-device", alicePrimary, recipients, "fan-out continuity", 0x61)
	result, err := service.SendMessage(alicePrimary.device, created.Record.ID, request)
	if err != nil || len(result.Record.Envelopes) != len(recipients) || result.Record.ProtocolVersion != messageProtocolVersion {
		t.Fatalf("multi-device message: %+v %v", result, err)
	}
	for _, recipient := range recipients {
		var envelope MessageEnvelope
		for _, candidate := range result.Record.Envelopes {
			if candidate.RecipientDeviceID == recipient.device.ID {
				envelope = candidate
				break
			}
		}
		ephemeralPublic, err := nativewallet.DecodePublicKey(envelope.EphemeralPublicKey, 32)
		if err != nil {
			t.Fatal(err)
		}
		aad := MessageEnvelopeAAD(created.Record.ID, request.MessageID, alicePrimary.device.ID, recipient.device.Account, recipient.device.ID, envelope.Algorithm, envelope.EphemeralPublicKey)
		plaintext, err := nativewallet.Decrypt(recipient.keys.EncryptionPrivate, ephemeralPublic, aad, nativewallet.EncryptedEnvelope{Algorithm: envelope.Algorithm, Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext})
		if err != nil || string(plaintext) != "fan-out continuity" {
			t.Fatalf("decrypt %s: %q %v", recipient.device.ID, plaintext, err)
		}
	}

	missing := request
	missing.MessageID = "message-missing-device"
	missing.Envelopes = append([]MessageEnvelope(nil), missing.Envelopes[:len(missing.Envelopes)-1]...)
	missing.SenderSignature = nativewallet.Sign(alicePrimary.keys.SigningPrivate, MessageSignaturePayload(created.Record.ID, aliceAddress, alicePrimary.device.ID, missing))
	if _, err := service.SendMessage(alicePrimary.device, created.Record.ID, missing); !errors.Is(err, ErrConflict) {
		t.Fatalf("missing active-device envelope accepted: %v", err)
	}

	duplicate := request
	duplicate.MessageID = "message-duplicate-device"
	duplicate.Envelopes = append([]MessageEnvelope(nil), duplicate.Envelopes...)
	duplicate.Envelopes[1] = duplicate.Envelopes[0]
	duplicate.SenderSignature = nativewallet.Sign(alicePrimary.keys.SigningPrivate, MessageSignaturePayload(created.Record.ID, aliceAddress, alicePrimary.device.ID, duplicate))
	if _, err := service.SendMessage(alicePrimary.device, created.Record.ID, duplicate); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate recipient envelope accepted: %v", err)
	}

	mixedKey := request
	mixedKey.MessageID = "message-mixed-ephemeral"
	mixedKey.Envelopes = append([]MessageEnvelope(nil), mixedKey.Envelopes...)
	mixedKey.Envelopes[1].EphemeralPublicKey = nativewallet.EncodePublicKey(bobPrimary.keys.EncryptionPublic)
	mixedKey.SenderSignature = nativewallet.Sign(alicePrimary.keys.SigningPrivate, MessageSignaturePayload(created.Record.ID, aliceAddress, alicePrimary.device.ID, mixedKey))
	if _, err := service.SendMessage(alicePrimary.device, created.Record.ID, mixedKey); !errors.Is(err, ErrInvalid) {
		t.Fatalf("mixed message ephemeral keys accepted: %v", err)
	}

	duplicateNonce := request
	duplicateNonce.MessageID = "message-duplicate-nonce"
	duplicateNonce.Envelopes = append([]MessageEnvelope(nil), duplicateNonce.Envelopes...)
	duplicateNonce.Envelopes[1].Nonce = duplicateNonce.Envelopes[0].Nonce
	duplicateNonce.SenderSignature = nativewallet.Sign(alicePrimary.keys.SigningPrivate, MessageSignaturePayload(created.Record.ID, aliceAddress, alicePrimary.device.ID, duplicateNonce))
	if _, err := service.SendMessage(alicePrimary.device, created.Record.ID, duplicateNonce); !errors.Is(err, ErrInvalid) {
		t.Fatalf("duplicate envelope nonce accepted: %v", err)
	}

	badHash := request
	badHash.MessageID = "message-bad-hash"
	badHash.Envelopes = append([]MessageEnvelope(nil), badHash.Envelopes...)
	badHash.Envelopes[0].CiphertextHash = strings.Repeat("0", 64)
	badHash.SenderSignature = nativewallet.Sign(alicePrimary.keys.SigningPrivate, MessageSignaturePayload(created.Record.ID, aliceAddress, alicePrimary.device.ID, badHash))
	if _, err := service.SendMessage(alicePrimary.device, created.Record.ID, badHash); !errors.Is(err, ErrInvalid) {
		t.Fatalf("incorrect ciphertext hash accepted: %v", err)
	}

	badSignature := request
	badSignature.MessageID = "message-bad-signature"
	badSignature.SenderSignature = nativewallet.Sign(bobPrimary.keys.SigningPrivate, MessageSignaturePayload(created.Record.ID, aliceAddress, alicePrimary.device.ID, badSignature))
	if _, err := service.SendMessage(alicePrimary.device, created.Record.ID, badSignature); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("incorrect sender signature accepted: %v", err)
	}

	now = now.Add(time.Second)
	firstAck, err := service.Acknowledge(bobPrimary.device, created.Record.ID, request.MessageID, "read")
	if err != nil || firstAck.ReadAt[bobPrimary.device.ID].IsZero() || !firstAck.ReadAt[bobTablet.device.ID].IsZero() {
		t.Fatalf("first per-device acknowledgement: %+v %v", firstAck.ReadAt, err)
	}
	now = now.Add(time.Second)
	secondAck, err := service.Acknowledge(bobTablet.device, created.Record.ID, request.MessageID, "read")
	if err != nil || secondAck.ReadAt[bobTablet.device.ID].IsZero() || len(secondAck.ReadAt) != 2 {
		t.Fatalf("second per-device acknowledgement: %+v %v", secondAck.ReadAt, err)
	}
}

func TestAuthorizedDeviceRotationAndRecoveryPersistence(t *testing.T) {
	now := time.Date(2026, 7, 14, 12, 45, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "state.json")
	service := newTestService(t, statePath, func() time.Time { return now })
	alicePrimary := registerTestDevice(t, service, aliceAddress, "alice-primary", 0x71)
	aliceBackup := registerTestDevice(t, service, aliceAddress, "alice-backup", 0x72)
	bob := registerTestDevice(t, service, bobAddress, "bob-primary", 0x73)
	newKeys := generateKeys(t, 0x74)
	request := rotationRequest(aliceBackup, alicePrimary.device.ID, "alice-recovered", "rotate-alice-primary", newKeys)

	result, err := service.RotateDevice(aliceBackup.device, alicePrimary.device.ID, request)
	if err != nil || result.Replayed || result.Record.AuthorizingDeviceID != aliceBackup.device.ID || result.Record.ReplacedDeviceID != alicePrimary.device.ID || result.Record.NewDeviceID != request.NewDeviceID {
		t.Fatalf("device recovery rotation: %+v %v", result, err)
	}
	replay, err := service.RotateDevice(aliceBackup.device, alicePrimary.device.ID, request)
	if err != nil || !replay.Replayed || replay.Record.ID != result.Record.ID {
		t.Fatalf("device rotation replay: %+v %v", replay, err)
	}
	devices, err := service.Devices(aliceBackup.device, aliceAddress)
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]string{}
	for _, device := range devices {
		statuses[device.ID] = device.Status
	}
	if statuses[alicePrimary.device.ID] != "revoked" || statuses[aliceBackup.device.ID] != "active" || statuses[request.NewDeviceID] != "active" {
		t.Fatalf("rotation device statuses: %+v", statuses)
	}
	if _, err := service.AuthenticateDevice(alicePrimary.device.ID, http.MethodGet, "/chat/device-rotations", now.Format(time.RFC3339), nativewallet.Sign(alicePrimary.keys.SigningPrivate, RequestSignaturePayload(http.MethodGet, "/chat/device-rotations", now.Format(time.RFC3339), nil)), nil); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("replaced device authenticated after rotation: %v", err)
	}
	rotations := service.DeviceRotations(aliceBackup.device)
	if len(rotations) != 1 || rotations[0].ID != result.Record.ID || service.Health().RotationCount != 1 {
		t.Fatalf("rotation records or health: %+v %+v", rotations, service.Health())
	}

	badAuthorization := rotationRequest(aliceBackup, aliceBackup.device.ID, "alice-invalid-auth", "rotate-invalid-auth", generateKeys(t, 0x75))
	badAuthorization.AuthorizationSignature = nativewallet.Sign(bob.keys.SigningPrivate, DeviceRotationAuthorizationPayload(aliceAddress, aliceBackup.device.ID, aliceBackup.device.ID, badAuthorization))
	if _, err := service.RotateDevice(aliceBackup.device, aliceBackup.device.ID, badAuthorization); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("invalid authorization accepted: %v", err)
	}
	badNewProof := rotationRequest(aliceBackup, aliceBackup.device.ID, "alice-invalid-new-proof", "rotate-invalid-new-proof", generateKeys(t, 0x76))
	badNewProof.NewDeviceProofSignature = nativewallet.Sign(bob.keys.SigningPrivate, DeviceRotationNewDevicePayload(aliceAddress, aliceBackup.device.ID, aliceBackup.device.ID, badNewProof))
	if _, err := service.RotateDevice(aliceBackup.device, aliceBackup.device.ID, badNewProof); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("invalid new-device proof accepted: %v", err)
	}
	foreign := rotationRequest(bob, aliceBackup.device.ID, "bob-replacement", "rotate-foreign-device", generateKeys(t, 0x77))
	if _, err := service.RotateDevice(bob.device, aliceBackup.device.ID, foreign); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("cross-account device rotation accepted: %v", err)
	}
	changed := rotationRequest(aliceBackup, alicePrimary.device.ID, "alice-second-recovery", request.IdempotencyKey, generateKeys(t, 0x78))
	if _, err := service.RotateDevice(aliceBackup.device, alicePrimary.device.ID, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed device rotation replay accepted: %v", err)
	}

	restarted := newTestService(t, statePath, func() time.Time { return now })
	if restarted.Health().RotationCount != 1 || len(restarted.DeviceRotations(aliceBackup.device)) != 1 {
		t.Fatalf("rotation was not restored: %+v", restarted.Health())
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

	response = signedHTTP(t, server.URL, http.MethodGet, "/chat/conversations", nil, "alice-http", aliceKeys.SigningPrivate, now, chatAPIKey)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list conversations status %d: %s", response.StatusCode, readAll(response.Body))
	}
	var conversations struct {
		Conversations []Conversation `json:"conversations"`
	}
	decodeJSON(t, response.Body, &conversations)
	response.Body.Close()
	if len(conversations.Conversations) != 1 || conversations.Conversations[0].ID != created.Record.ID {
		t.Fatalf("unexpected conversation list: %+v", conversations)
	}

	devicePath := "/chat/accounts/" + bobAddress + "/devices"
	response = signedHTTP(t, server.URL, http.MethodGet, devicePath, nil, "alice-http", aliceKeys.SigningPrivate, now, chatAPIKey)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("member device directory status %d: %s", response.StatusCode, readAll(response.Body))
	}
	var devices struct {
		Devices []Device `json:"devices"`
	}
	decodeJSON(t, response.Body, &devices)
	response.Body.Close()
	if len(devices.Devices) != 1 || devices.Devices[0].ID != "bob-http" || devices.Devices[0].EncryptionPublicKey == "" {
		t.Fatalf("unexpected member device directory: %+v", devices)
	}

	aliceDevice := testDevice{device: Device{ID: "alice-http", Account: aliceAddress}, keys: aliceKeys}
	bobDevice := testDevice{device: Device{ID: "bob-http", Account: bobAddress}, keys: bobKeys}
	messageBody := mustJSON(t, encryptedMessageRequest(t, created.Record.ID, "http-message", aliceDevice, []testDevice{aliceDevice, bobDevice}, "hello", 0x44))
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

	newAliceKeys := generateKeys(t, 0x45)
	rotation := rotationRequest(aliceDevice, aliceDevice.device.ID, "alice-http-replacement", "rotate-alice-http", newAliceKeys)
	rotationBody := mustJSON(t, rotation)
	rotationPath := "/chat/devices/alice-http/rotate"
	response = signedHTTP(t, server.URL, http.MethodPost, rotationPath, rotationBody, "alice-http", aliceKeys.SigningPrivate, now, chatAPIKey)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("rotate device status %d: %s", response.StatusCode, readAll(response.Body))
	}
	response.Body.Close()
	response = signedHTTP(t, server.URL, http.MethodPost, rotationPath, rotationBody, "alice-http", aliceKeys.SigningPrivate, now, chatAPIKey)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("revoked authorizer exact rotation replay status %d: %s", response.StatusCode, readAll(response.Body))
	}
	response.Body.Close()
	response = signedHTTP(t, server.URL, http.MethodGet, "/chat/conversations", nil, "alice-http", aliceKeys.SigningPrivate, now, chatAPIKey)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked authorizer non-rotation status %d", response.StatusCode)
	}
	response.Body.Close()
	response = signedHTTP(t, server.URL, http.MethodGet, "/chat/device-rotations", nil, "alice-http-replacement", newAliceKeys.SigningPrivate, now, chatAPIKey)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("rotation list status %d: %s", response.StatusCode, readAll(response.Body))
	}
	var rotationList struct {
		Rotations []DeviceRotation `json:"rotations"`
	}
	decodeJSON(t, response.Body, &rotationList)
	response.Body.Close()
	if len(rotationList.Rotations) != 1 || rotationList.Rotations[0].NewDeviceID != "alice-http-replacement" {
		t.Fatalf("unexpected HTTP rotation list: %+v", rotationList)
	}

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
	result, err := service.RegisterDevice(registrationRequest(account, deviceID, "register-"+deviceID, keys))
	if err != nil {
		t.Fatal(err)
	}
	return testDevice{device: result.Record, keys: keys}
}

func encryptedMessageRequest(t *testing.T, conversationID, messageID string, sender testDevice, recipients []testDevice, plaintext string, seed byte) SendMessageRequest {
	t.Helper()
	ephemeralSecret := bytes.Repeat([]byte{seed}, 32)
	ephemeral, err := ecdh.X25519().NewPrivateKey(ephemeralSecret)
	if err != nil {
		t.Fatal(err)
	}
	ephemeralPublicKey := nativewallet.EncodePublicKey(ephemeral.PublicKey().Bytes())
	request := SendMessageRequest{MessageID: messageID}
	for index, recipient := range recipients {
		nonceByte := seed + byte(index) + 1
		aad := MessageEnvelopeAAD(conversationID, messageID, sender.device.ID, recipient.device.Account, recipient.device.ID, messageAlgorithm, ephemeralPublicKey)
		encrypted, err := nativewallet.Encrypt(ephemeralSecret, recipient.keys.EncryptionPublic, []byte(plaintext), aad, bytes.NewReader(bytes.Repeat([]byte{nonceByte}, 24)))
		if err != nil {
			t.Fatal(err)
		}
		request.Envelopes = append(request.Envelopes, MessageEnvelope{RecipientAccount: recipient.device.Account, RecipientDeviceID: recipient.device.ID, Algorithm: encrypted.Algorithm, EphemeralPublicKey: ephemeralPublicKey, Nonce: encrypted.Nonce, Ciphertext: encrypted.Ciphertext})
	}
	request.SenderSignature = nativewallet.Sign(sender.keys.SigningPrivate, MessageSignaturePayload(conversationID, sender.device.Account, sender.device.ID, request))
	return request
}

func rotationRequest(authorizer testDevice, replacedDeviceID, newDeviceID, idempotencyKey string, newKeys nativewallet.DeviceKeys) RotateDeviceRequest {
	request := RotateDeviceRequest{
		IdempotencyKey:      idempotencyKey,
		NewDeviceID:         newDeviceID,
		SigningPublicKey:    nativewallet.EncodePublicKey(newKeys.SigningPublic),
		EncryptionPublicKey: nativewallet.EncodePublicKey(newKeys.EncryptionPublic),
	}
	request.AuthorizationSignature = nativewallet.Sign(authorizer.keys.SigningPrivate, DeviceRotationAuthorizationPayload(authorizer.device.Account, authorizer.device.ID, replacedDeviceID, request))
	request.NewDeviceProofSignature = nativewallet.Sign(newKeys.SigningPrivate, DeviceRotationNewDevicePayload(authorizer.device.Account, authorizer.device.ID, replacedDeviceID, request))
	return request
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

func TestRateLimitUsesDeviceAndIP(t *testing.T) {
	now := time.Date(2026, 7, 14, 14, 0, 0, 0, time.UTC)
	service, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), APIKey: chatAPIKey, Now: func() time.Time { return now }, RateLimitWindow: time.Minute, RateLimitMax: 2})
	if err != nil {
		t.Fatal(err)
	}
	if !service.Allow("192.0.2.1:1234", "device-a") || !service.Allow("192.0.2.1:5678", "device-a") || service.Allow("192.0.2.1:9012", "device-a") {
		t.Fatal("same device/IP rate limit was not enforced")
	}
	if !service.Allow("192.0.2.1:1234", "device-b") || !service.Allow("192.0.2.2:1234", "device-a") {
		t.Fatal("independent device/IP bucket was incorrectly denied")
	}
	now = now.Add(time.Minute + time.Second)
	if !service.Allow("192.0.2.1:1234", "device-a") {
		t.Fatal("expired rate-limit window did not reset")
	}
}
