package social

import (
	"bytes"
	"context"
	stdECDSA "crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type fixture struct {
	key        *secp256k1.PrivateKey
	productKey *stdECDSA.PrivateKey
	account    string
	device     string
	deviceKeys nativewallet.DeviceKeys
}
type fakeAIStreamer struct{ fail bool }

func (f fakeAIStreamer) Stream(ctx context.Context, in AIStreamRequest, emit func(string) error) (AIUsage, error) {
	if f.fail {
		return AIUsage{}, errors.New("provider unavailable")
	}
	for _, chunk := range []string{"Reviewable ", "draft"} {
		if err := emit(chunk); err != nil {
			return AIUsage{}, err
		}
	}
	return AIUsage{Tokens: 12}, nil
}

func TestWalletLoginRejectsReplayWrongBindingAndWrongAccount(t *testing.T) {
	s, now := testService(t)
	alice := newFixture(t, 1)
	login := signedLogin(t, s, alice, now)
	result, err := s.Login(login)
	if err != nil || result.Token == "" || result.Session.Account != alice.account {
		t.Fatalf("login: %#v %v", result, err)
	}
	if _, err := s.Login(login); !errors.Is(err, ErrConflict) {
		t.Fatalf("replay error = %v", err)
	}
	bad := signedWalletApproval(t, alice, now)
	bad.Request.Callback = "ynxsocial://evil"
	resignApproval(t, alice, &bad)
	if _, err := s.CreateWalletChallenge(bad); !errors.Is(err, ErrInvalid) {
		t.Fatalf("callback error = %v", err)
	}
	bob := newFixture(t, 2)
	wrong := signedWalletApproval(t, alice, now)
	wrong.Approval.Account = bob.account
	resignApproval(t, alice, &wrong)
	if _, err := s.CreateWalletChallenge(wrong); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("account binding error = %v", err)
	}
}

func TestWalletLoginRegistersOneBoundProductDeviceWithChatAndSquare(t *testing.T) {
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	dir := t.TempDir()
	chatService, err := chat.New(chat.Config{StatePath: filepath.Join(dir, "chat.json"), APIKey: "chat-test-api-key-1234", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	squareService, err := square.New(square.Config{StatePath: filepath.Join(dir, "square.json"), APIKey: "square-test-api-key-1234", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(Config{StatePath: filepath.Join(dir, "social.json"), TokenKey: bytes.Repeat([]byte{8}, 32), Now: func() time.Time { return now }, Chat: chatService, Square: squareService})
	if err != nil {
		t.Fatal(err)
	}
	member := newFixture(t, 41)
	if _, err := service.Login(signedLogin(t, service, member, now)); err != nil {
		t.Fatal(err)
	}
	if chatService.Health().DeviceCount != 1 || squareService.Health().ProfileCount != 0 {
		t.Fatalf("unexpected contract state chat=%#v square=%#v", chatService.Health(), squareService.Health())
	}
	if devices, err := chatService.Devices(chat.Device{Account: member.account}, member.account); err != nil || len(devices) != 1 || devices[0].ID != member.device {
		t.Fatalf("chat device binding %#v %v", devices, err)
	}
}

func TestWalletGatewayChallengeSurvivesRestartAndRejectsTamper(t *testing.T) {
	s, now := testService(t)
	alice := newFixture(t, 42)
	login := signedLogin(t, s, alice, now)
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	tampered := login
	tampered.DeviceSignature = "A" + tampered.DeviceSignature[1:]
	if _, err := restarted.Login(tampered); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("tampered P-256 completion = %v", err)
	}
	result, err := restarted.Login(login)
	if err != nil || result.Session.Account != alice.account {
		t.Fatalf("restart completion = %#v %v", result, err)
	}
	if _, err := restarted.Login(login); !errors.Is(err, ErrConflict) {
		t.Fatalf("completion replay = %v", err)
	}
}

func TestContactLifecycleIsolationBlockAndRateLimit(t *testing.T) {
	s, now := testService(t)
	alice := loginFixture(t, s, newFixture(t, 3), now)
	bob := loginFixture(t, s, newFixture(t, 4), now)
	mallory := loginFixture(t, s, newFixture(t, 5), now)
	req, replay, err := s.RequestContact(alice, ContactRequestInput{IdempotencyKey: "request-alice-bob", TargetAccount: bob.Account, Source: "handle"})
	if err != nil || replay {
		t.Fatal(err)
	}
	if _, again, err := s.RequestContact(alice, ContactRequestInput{IdempotencyKey: "request-alice-bob", TargetAccount: bob.Account, Source: "handle"}); err != nil || !again {
		t.Fatalf("idempotency %v %v", again, err)
	}
	if _, err := s.TransitionRequest(mallory, req.ID, "accept"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("cross-account accept = %v", err)
	}
	accepted, err := s.TransitionRequest(bob, req.ID, "accept")
	if err != nil || accepted.Status != "accepted" || len(s.Contacts(alice)) != 1 {
		t.Fatalf("accept = %#v %v", accepted, err)
	}
	if err := s.Block(alice, bob.Account); err != nil {
		t.Fatal(err)
	}
	if len(s.Contacts(bob)) != 0 {
		t.Fatal("blocked contact remained")
	}
	if _, _, err := s.RequestContact(bob, ContactRequestInput{IdempotencyKey: "request-bob-alice", TargetAccount: alice.Account, Source: "qr"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("blocked request = %v", err)
	}
	if !s.Allow("127.0.0.1:1", alice.Account, "request") || !s.Allow("127.0.0.1:1", alice.Account, "request") || s.Allow("127.0.0.1:1", alice.Account, "request") {
		t.Fatal("rate limit did not fail closed")
	}
}

func TestDirectMessageContractSendReplayReadAndRestart(t *testing.T) {
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	dir := t.TempDir()
	chatPath := filepath.Join(dir, "chat.json")
	chatService, err := chat.New(chat.Config{StatePath: chatPath, APIKey: "chat-test-api-key-1234", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(Config{StatePath: filepath.Join(dir, "social.json"), TokenKey: bytes.Repeat([]byte{18}, 32), Now: func() time.Time { return now }, Chat: chatService})
	if err != nil {
		t.Fatal(err)
	}
	aliceFixture, bobFixture := newFixture(t, 51), newFixture(t, 52)
	alice, bob := loginFixture(t, service, aliceFixture, now), loginFixture(t, service, bobFixture, now)
	request, _, err := service.RequestContact(alice, ContactRequestInput{IdempotencyKey: "message-contact", TargetAccount: bob.Account, Source: "handle"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionRequest(bob, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	created, err := service.CreateDirectConversation(alice, bob.Account, "message-conversation")
	if err != nil || len(created.Record.Members) != 2 {
		t.Fatalf("conversation %#v %v", created, err)
	}
	if _, err := service.CreateDirectConversation(alice, newFixture(t, 53).account, "unauthorized-conversation"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("non-contact conversation = %v", err)
	}
	devices, err := service.ConversationDevices(alice, created.Record.ID)
	if err != nil || len(devices) != 2 {
		t.Fatalf("devices %#v %v", devices, err)
	}
	ephemeral := base64.RawStdEncoding.EncodeToString(bytes.Repeat([]byte{77}, 32))
	envelopes := make([]chat.MessageEnvelope, 0, len(devices))
	for index, device := range devices {
		ciphertext := bytes.Repeat([]byte{byte(index + 1)}, 24)
		envelopes = append(envelopes, chat.MessageEnvelope{RecipientAccount: device.Account, RecipientDeviceID: device.ID, Algorithm: "x25519-hkdf-sha256-xchacha20poly1305", EphemeralPublicKey: ephemeral, Nonce: base64.RawStdEncoding.EncodeToString(bytes.Repeat([]byte{byte(index + 10)}, 24)), Ciphertext: base64.RawStdEncoding.EncodeToString(ciphertext)})
	}
	send := chat.SendMessageRequest{MessageID: "message-contract", Envelopes: envelopes}
	send.SenderSignature = nativewallet.Sign(aliceFixture.deviceKeys.SigningPrivate, chat.MessageSignaturePayload(created.Record.ID, alice.Account, alice.DeviceID, send))
	sent, err := service.SendConversationMessage(alice, created.Record.ID, send)
	if err != nil || sent.Replayed || sent.Record.ProtocolVersion != 2 {
		t.Fatalf("send %#v %v", sent, err)
	}
	replayed, err := service.SendConversationMessage(alice, created.Record.ID, send)
	if err != nil || !replayed.Replayed {
		t.Fatalf("replay %#v %v", replayed, err)
	}
	read, err := service.AcknowledgeConversationMessage(bob, created.Record.ID, send.MessageID, "read")
	if err != nil || read.ReadAt[bob.DeviceID].IsZero() || read.DeliveredAt[bob.DeviceID].IsZero() {
		t.Fatalf("read acknowledgement %#v %v", read, err)
	}
	restartedChat, err := chat.New(chat.Config{StatePath: chatPath, APIKey: "chat-test-api-key-1234", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	service.cfg.Chat = restartedChat
	messages, err := service.ConversationMessages(bob, created.Record.ID)
	if err != nil || len(messages) != 1 || messages[0].ID != send.MessageID {
		t.Fatalf("restart messages %#v %v", messages, err)
	}
	newKeys, err := nativewallet.GenerateDeviceKeys(bytes.NewReader(bytes.Repeat([]byte{91}, 128)))
	if err != nil {
		t.Fatal(err)
	}
	rotation := chat.RotateDeviceRequest{IdempotencyKey: "rotate-alice-social", NewDeviceID: "device-alice-rotated", SigningPublicKey: nativewallet.EncodePublicKey(newKeys.SigningPublic), EncryptionPublicKey: nativewallet.EncodePublicKey(newKeys.EncryptionPublic)}
	rotation.AuthorizationSignature = nativewallet.Sign(aliceFixture.deviceKeys.SigningPrivate, chat.DeviceRotationAuthorizationPayload(alice.Account, alice.DeviceID, alice.DeviceID, rotation))
	rotation.NewDeviceProofSignature = nativewallet.Sign(newKeys.SigningPrivate, chat.DeviceRotationNewDevicePayload(alice.Account, alice.DeviceID, alice.DeviceID, rotation))
	rotated, rotatedSession, err := service.RotateConversationDevice(alice, alice.DeviceID, rotation)
	if err != nil || rotated.Replayed || rotatedSession.DeviceID != rotation.NewDeviceID {
		t.Fatalf("rotation %#v %#v %v", rotated, rotatedSession, err)
	}
	retry, retrySession, err := service.RotateConversationDevice(rotatedSession, alice.DeviceID, rotation)
	if err != nil || !retry.Replayed || retrySession.DeviceID != rotation.NewDeviceID {
		t.Fatalf("rotation retry %#v %#v %v", retry, retrySession, err)
	}
	allDevices, err := service.ConversationDevices(rotatedSession, created.Record.ID)
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]string{}
	for _, device := range allDevices {
		statuses[device.ID] = device.Status
	}
	if statuses[alice.DeviceID] != "revoked" || statuses[rotation.NewDeviceID] != "active" {
		t.Fatalf("rotation device states %#v", statuses)
	}
}

func TestGroupConversationPersistentE2EEAuthorizationAndTamper(t *testing.T) {
	service, now := testService(t)
	service.cfg.RateLimitMax = 100
	aliceFixture, bobFixture, carolFixture, outsiderFixture := newFixture(t, 61), newFixture(t, 62), newFixture(t, 63), newFixture(t, 64)
	alice, bob := loginFixture(t, service, aliceFixture, now), loginFixture(t, service, bobFixture, now)
	carol, outsider := loginFixture(t, service, carolFixture, now), loginFixture(t, service, outsiderFixture, now)
	for index, target := range []Session{bob, carol} {
		request, _, err := service.RequestContact(alice, ContactRequestInput{IdempotencyKey: fmt.Sprintf("group-contact-%d", index), TargetAccount: target.Account, Source: "handle"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.TransitionRequest(target, request.ID, "accept"); err != nil {
			t.Fatal(err)
		}
	}
	group, replay, err := service.CreateGroupConversation(alice, "Core contributors", "group-create-one", []string{bob.Account, carol.Account})
	if err != nil || replay || len(group.Members) != 3 {
		t.Fatalf("group %#v %v", group, err)
	}
	if _, _, err := service.CreateGroupConversation(alice, "Unauthorized", "group-create-two", []string{bob.Account, outsider.Account}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("non-contact group = %v", err)
	}
	devices, err := service.GroupDevices(alice, group.ID)
	if err != nil || len(devices) != 3 {
		t.Fatalf("group devices %#v %v", devices, err)
	}
	ephemeral := base64.RawStdEncoding.EncodeToString(bytes.Repeat([]byte{99}, 32))
	envelopes := make([]chat.MessageEnvelope, 0, len(devices))
	for index, device := range devices {
		ciphertext := bytes.Repeat([]byte{byte(index + 20)}, 32)
		envelopes = append(envelopes, chat.MessageEnvelope{RecipientAccount: device.Account, RecipientDeviceID: device.ID, Algorithm: groupMessageAlgorithm, EphemeralPublicKey: ephemeral, Nonce: base64.RawStdEncoding.EncodeToString(bytes.Repeat([]byte{byte(index + 30)}, 24)), Ciphertext: base64.RawStdEncoding.EncodeToString(ciphertext)})
	}
	send := chat.SendMessageRequest{MessageID: "group-message-one", Envelopes: envelopes}
	send.SenderSignature = nativewallet.Sign(aliceFixture.deviceKeys.SigningPrivate, chat.MessageSignaturePayload(group.ID, alice.Account, alice.DeviceID, send))
	result, err := service.SendGroupMessage(alice, group.ID, send)
	if err != nil || result.Record.ProtocolVersion != 2 {
		t.Fatalf("group send %#v %v", result, err)
	}
	if _, err := service.GroupMessages(outsider, group.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("outsider messages = %v", err)
	}
	tampered := send
	tampered.MessageID = "group-message-tampered"
	tampered.Envelopes = append([]chat.MessageEnvelope(nil), send.Envelopes...)
	tampered.Envelopes[0].CiphertextHash = strings.Repeat("0", 64)
	tampered.SenderSignature = nativewallet.Sign(aliceFixture.deviceKeys.SigningPrivate, chat.MessageSignaturePayload(group.ID, alice.Account, alice.DeviceID, tampered))
	if _, err := service.SendGroupMessage(alice, group.ID, tampered); !errors.Is(err, ErrInvalid) {
		t.Fatalf("tampered group envelope = %v", err)
	}
	restarted, err := New(service.cfg)
	if err != nil {
		t.Fatal(err)
	}
	messages, err := restarted.GroupMessages(carol, group.ID)
	if err != nil || len(messages) != 1 || messages[0].ID != send.MessageID {
		t.Fatalf("group restart %#v %v", messages, err)
	}
}

func TestModifyGroupMembersOwnerAuthorizationAndReplay(t *testing.T) {
	service, now := testService(t)
	service.cfg.RateLimitMax = 100
	alice := loginFixture(t, service, newFixture(t, 101), now)
	bob, carol, dave := loginFixture(t, service, newFixture(t, 102), now), loginFixture(t, service, newFixture(t, 103), now), loginFixture(t, service, newFixture(t, 104), now)
	request, _, err := service.RequestContact(alice, ContactRequestInput{IdempotencyKey: "gm-request-1", TargetAccount: bob.Account, Source: "handle"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionRequest(bob, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	request, _, err = service.RequestContact(alice, ContactRequestInput{IdempotencyKey: "gm-request-2", TargetAccount: carol.Account, Source: "handle"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionRequest(carol, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	request, _, err = service.RequestContact(alice, ContactRequestInput{IdempotencyKey: "gm-request-3", TargetAccount: dave.Account, Source: "handle"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionRequest(dave, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	group, _, err := service.CreateGroupConversation(alice, "owners", "group-membership", []string{bob.Account, dave.Account})
	if err != nil || len(group.Members) != 3 {
		t.Fatalf("create group %#v %v", group, err)
	}
	record, replay, err := service.ModifyGroupMembers(alice, group.ID, "group-membership-replay", []string{carol.Account}, nil)
	if err != nil || replay || len(record.Members) != 4 {
		t.Fatalf("add member %#v %v", record, err)
	}
	record, replay, err = service.ModifyGroupMembers(alice, group.ID, "group-membership-replay", []string{carol.Account}, nil)
	if err != nil || !replay || len(record.Members) != 4 {
		t.Fatalf("replay add %#v %v", record, err)
	}
	if _, _, err := service.ModifyGroupMembers(carol, group.ID, "group-membership-denied", []string{alice.Account}, nil); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("non-owner access=%v", err)
	}
	if _, _, err := service.ModifyGroupMembers(alice, group.ID, "group-membership-self", []string{alice.Account}, nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("self add should fail %v", err)
	}
	if _, _, err := service.ModifyGroupMembers(alice, group.ID, "group-membership-empty", nil, nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty request should fail %v", err)
	}
}

func TestMomentsVisibilityMediaInteractionsReportingAndTamper(t *testing.T) {
	service, now := testService(t)
	alice, bob, outsider := loginFixture(t, service, newFixture(t, 71), now), loginFixture(t, service, newFixture(t, 72), now), loginFixture(t, service, newFixture(t, 73), now)
	request, _, err := service.RequestContact(alice, ContactRequestInput{IdempotencyKey: "moment-contact", TargetAccount: bob.Account, Source: "qr"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionRequest(bob, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	data := []byte("bounded-image-payload")
	digest := sha256.Sum256(data)
	media, replay, err := service.StoreMedia(alice, "moment-media-one", "moment", "", "image/png", base64.RawStdEncoding.EncodeToString(data), hex.EncodeToString(digest[:]))
	if err != nil || replay || media.Encrypted {
		t.Fatalf("media %#v %v", media, err)
	}
	moment, replay, err := service.CreateMoment(alice, "moment-create-one", "A contact moment @nobody", "contacts", []string{media.ID})
	if err != nil || replay || moment.Visibility != "contacts" {
		t.Fatalf("moment %#v %v", moment, err)
	}
	if _, err := service.Moment(bob, moment.ID); err != nil {
		t.Fatalf("contact visibility %v", err)
	}
	if _, err := service.Moment(outsider, moment.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("outsider visibility %v", err)
	}
	comment, replay, err := service.CreateMomentComment(bob, moment.ID, "moment-comment-one", "Thoughtful")
	if err != nil || replay || comment.Text != "Thoughtful" {
		t.Fatalf("comment %#v %v", comment, err)
	}
	reaction, replay, err := service.SetMomentReaction(bob, moment.ID, "moment-reaction-one", "support", true)
	if err != nil || replay || !reaction.Active {
		t.Fatalf("reaction %#v %v", reaction, err)
	}
	report, replay, err := service.CreateSocialReport(bob, "moment-report-one", "moment", moment.ID, "other", "Needs review", []string{hex.EncodeToString(digest[:])})
	if err != nil || replay || report.Outcome != "pending" || !strings.Contains(report.Explanation, "No penalty") {
		t.Fatalf("report %#v %v", report, err)
	}
	report, err = service.AppealSocialReport(bob, report.ID, "Additional context")
	if err != nil || report.Status != "appealed" {
		t.Fatalf("appeal %#v %v", report, err)
	}
	if err := service.DeleteMoment(outsider, moment.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("outsider delete %v", err)
	}
	if err := service.DeleteMoment(alice, moment.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Moment(bob, moment.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted moment = %v", err)
	}
	mediaPath := service.mediaPath(media.ID)
	if err := os.WriteFile(mediaPath, []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(service.cfg); err == nil || !strings.Contains(err.Error(), "media integrity") {
		t.Fatalf("media tamper accepted: %v", err)
	}
}

func TestAINativePermissionReviewCancelRetryAndProviderFailure(t *testing.T) {
	s, now := testService(t)
	alice := loginFixture(t, s, newFixture(t, 6), now)
	moment, _, err := s.CreateMoment(alice, "ai-context-moment", "Selected private context", "private", nil)
	if err != nil {
		t.Fatal(err)
	}
	input := AIRequest{IdempotencyKey: "ai-reply-one", Kind: "reply_draft", SelectionIDs: []string{moment.ID}, ContextClasses: []string{"message_text"}, PrivacyPreview: "One selected message will be sent without contact metadata.", Provider: "test-provider", Model: "test-model", EstimatedTokens: 800, OutputLanguage: "en"}
	job, replay, err := s.BeginAI(alice, input)
	if err != nil || replay || job.Status != "awaiting_permission" || job.EstimatedCostUSD <= 0 || job.OutputLanguage != "en" {
		t.Fatalf("begin %#v %v", job, err)
	}
	invalidLanguage := input
	invalidLanguage.IdempotencyKey = "ai-invalid-language"
	invalidLanguage.OutputLanguage = "auto"
	if _, _, err := s.BeginAI(alice, invalidLanguage); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unapproved AI output language = %v", err)
	}
	if _, err := s.TransitionAI(alice, job.ID, "complete", "draft"); !errors.Is(err, ErrConflict) {
		t.Fatalf("completed without consent: %v", err)
	}
	job, err = s.TransitionAI(alice, job.ID, "allow", "")
	if err != nil || job.Status != "streaming" || job.PermissionAt == nil {
		t.Fatal(err)
	}
	job, err = s.TransitionAI(alice, job.ID, "cancel", "")
	if err != nil || job.Status != "cancelled" {
		t.Fatal(err)
	}
	job, err = s.TransitionAI(alice, job.ID, "retry", "")
	if err != nil || job.Status != "awaiting_permission" {
		t.Fatal(err)
	}
	job, _ = s.TransitionAI(alice, job.ID, "allow", "")
	job, err = s.TransitionAI(alice, job.ID, "complete", "Suggested reply")
	if err != nil || job.Status != "review" {
		t.Fatal(err)
	}
	job, err = s.TransitionAI(alice, job.ID, "apply", "")
	if err != nil || job.Status != "applied" {
		t.Fatal(err)
	}
	job, err = s.TransitionAI(alice, job.ID, "appeal", "The tone was incorrect")
	if err != nil || job.Status != "appealed" {
		t.Fatal(err)
	}
	s.cfg.AIProviders["test-provider"] = AIProvider{Models: []string{"test-model"}, Available: false, CostPer1KUSD: .01}
	input.IdempotencyKey = "ai-unavailable"
	if _, _, err := s.BeginAI(alice, input); !errors.Is(err, ErrConflict) {
		t.Fatalf("unavailable provider = %v", err)
	}
}

func TestAIStreamsOnlyAfterPermissionAndPersistsReviewUsage(t *testing.T) {
	s, now := testService(t)
	s.cfg.AI = fakeAIStreamer{}
	alice := loginFixture(t, s, newFixture(t, 81), now)
	moment, _, err := s.CreateMoment(alice, "ai-stream-context", "Private selected text", "private", nil)
	if err != nil {
		t.Fatal(err)
	}
	input := AIRequest{IdempotencyKey: "ai-stream-job", Kind: "translation", SelectionIDs: []string{moment.ID}, ContextClasses: []string{"selected_text"}, PrivacyPreview: "Only one selected private text block is shared.", Provider: "test-provider", Model: "test-model", EstimatedTokens: 400, OutputLanguage: "en"}
	job, _, err := s.BeginAI(alice, input)
	if err != nil {
		t.Fatal(err)
	}
	streamContext := "Decrypted context exists only for this approved request"
	if _, err := s.StreamAI(context.Background(), alice, job.ID, streamContext, func(string) error { return nil }); !errors.Is(err, ErrConflict) {
		t.Fatalf("stream without permission = %v", err)
	}
	job, err = s.TransitionAI(alice, job.ID, "allow", "")
	if err != nil {
		t.Fatal(err)
	}
	var chunks strings.Builder
	job, err = s.StreamAI(context.Background(), alice, job.ID, streamContext, func(chunk string) error { chunks.WriteString(chunk); return nil })
	if err != nil || job.Status != "review" || job.Output != "Reviewable draft" || job.ActualTokens != 12 || job.ContextHash == "" || chunks.String() != job.Output {
		t.Fatalf("streamed job %#v chunks=%q err=%v", job, chunks.String(), err)
	}
	data, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte(streamContext)) {
		t.Fatal("AI private context was persisted")
	}
	if _, err := s.TransitionAI(alice, job.ID, "apply", ""); err != nil {
		t.Fatal(err)
	}
}

func TestAIPromptBindsExplicitOutputLanguageAndForbidsSideEffects(t *testing.T) {
	prompt := socialAIPrompt(AIStreamRequest{Kind: "reply_draft", Provider: "test-provider", Model: "test-model", OutputLanguage: "ar", ContextText: "selected message"})
	for _, required := range []string{"locale: ar", "Do not send it", "Never send, publish, follow, block, report, or punish", "selected message"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("AI prompt missing %q: %s", required, prompt)
		}
	}
}

func TestPersistenceRestartTamperMigrationExportAndDelete(t *testing.T) {
	s, now := testService(t)
	alice := loginFixture(t, s, newFixture(t, 7), now)
	_, _, err := s.SetSettings(alice, ProfileSettingsInput{IdempotencyKey: "settings-alice", DiscoverableByHandle: true, ContactsMatching: true, AllowRecommendations: true, AllowRequestsFrom: "everyone", AvatarURL: "https://example.test/avatar.png"})
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	exported := restarted.Export(alice)
	if exported.Settings == nil || !exported.Settings.ContactsMatching {
		t.Fatalf("restart lost state: %#v", exported.Settings)
	}
	state := cloneState(restarted.state)
	state.SchemaVersion = 1
	if err := saveState(s.cfg.StatePath, &state, s.cfg.TokenKey); err != nil {
		t.Fatal(err)
	}
	migrated, err := New(s.cfg)
	if err != nil || migrated.state.SchemaVersion != SchemaVersion {
		t.Fatalf("migration: %v", err)
	}
	data, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	data = bytes.Replace(data, []byte("settings-alice"), []byte("settings-evilx"), 1)
	if err := os.WriteFile(s.cfg.StatePath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(s.cfg); err == nil || !stringsContains(err.Error(), "integrity") {
		t.Fatalf("tamper accepted: %v", err)
	}
	if err := saveState(s.cfg.StatePath, &migrated.state, s.cfg.TokenKey); err != nil {
		t.Fatal(err)
	}
	if err := migrated.DeleteAccount(alice); err != nil {
		t.Fatal(err)
	}
	if out := migrated.Export(alice); out.Settings != nil || len(out.AIJobs) != 0 {
		t.Fatalf("privacy delete left data: %#v", out)
	}
	for key := range migrated.state.Idempotency {
		if strings.HasPrefix(key, alice.Account+"|") {
			t.Fatalf("privacy delete left account idempotency record %q", key)
		}
	}
}

func TestIdempotencyKeysAreAccountIsolated(t *testing.T) {
	s, now := testService(t)
	alice := loginFixture(t, s, newFixture(t, 51), now)
	bob := loginFixture(t, s, newFixture(t, 52), now)
	aliceResult, aliceReplay, err := s.SetSettings(alice, ProfileSettingsInput{IdempotencyKey: "same-client-key", DiscoverableByHandle: true, AllowRecommendations: true, AllowRequestsFrom: "everyone"})
	if err != nil || aliceReplay {
		t.Fatalf("alice settings: %#v replay=%v err=%v", aliceResult, aliceReplay, err)
	}
	bobResult, bobReplay, err := s.SetSettings(bob, ProfileSettingsInput{IdempotencyKey: "same-client-key", DiscoverableByHandle: false, AllowRecommendations: false, AllowRequestsFrom: "nobody"})
	if err != nil || bobReplay || bobResult.Account != bob.Account || bobResult.AllowRequestsFrom != "nobody" {
		t.Fatalf("bob settings: %#v replay=%v err=%v", bobResult, bobReplay, err)
	}
	aliceAgain, replay, err := s.SetSettings(alice, ProfileSettingsInput{IdempotencyKey: "same-client-key", DiscoverableByHandle: true, AllowRecommendations: true, AllowRequestsFrom: "everyone"})
	if err != nil || !replay || aliceAgain.Account != alice.Account {
		t.Fatalf("alice exact replay: %#v replay=%v err=%v", aliceAgain, replay, err)
	}
}

func testService(t *testing.T) (*Service, time.Time) {
	t.Helper()
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "social.json"), TokenKey: bytes.Repeat([]byte{9}, 32), Now: func() time.Time { return now }, RateLimitMax: 2, AIProviders: map[string]AIProvider{"test-provider": {Models: []string{"test-model"}, Available: true, CostPer1KUSD: .01}}})
	if err != nil {
		t.Fatal(err)
	}
	return s, now
}
func newFixture(t *testing.T, seed byte) fixture {
	t.Helper()
	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{seed}, 32))
	account, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	account, err = accountaddress.Encode(account)
	if err != nil {
		t.Fatal(err)
	}
	deviceKeys, err := nativewallet.GenerateDeviceKeys(bytes.NewReader(bytes.Repeat([]byte{seed + 20}, 128)))
	if err != nil {
		t.Fatal(err)
	}
	x, y := elliptic.P256().ScalarBaseMult(bytes.Repeat([]byte{seed + 40}, 32))
	return fixture{key: key, productKey: &stdECDSA.PrivateKey{PublicKey: stdECDSA.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, D: new(big.Int).SetBytes(bytes.Repeat([]byte{seed + 40}, 32))}, account: account, device: "device-test-" + hex.EncodeToString([]byte{seed}), deviceKeys: deviceKeys}
}
func signedWalletApproval(t *testing.T, f fixture, now time.Time) WalletChallengeRequest {
	t.Helper()
	productPublicKey := base64.RawURLEncoding.EncodeToString(elliptic.MarshalCompressed(elliptic.P256(), f.productKey.X, f.productKey.Y))
	request := WalletAuthorizationRequest{Version: "1", Nonce: base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{f.device[len(f.device)-1]}, 32)), ChainID: "ynx_6423-1", RequestingProduct: RequestingProduct, ProductClientID: ProductClientID, BundleID: BundleID, ProductDeviceAlgorithm: ProductDeviceAlgorithm, ProductDeviceKey: productPublicKey, Callback: Callback, Scopes: append([]string(nil), walletScopes...), Purpose: "Sign in to YNX Social. No recovery key is shared.", IssuedAt: now.Add(-time.Second).Format(protocolTimeLayout), ExpiresAt: now.Add(4 * time.Minute).Format(protocolTimeLayout)}
	digest, _ := WalletRequestDigest(request)
	approval := WalletApproval{Version: "1", RequestDigest: digest, Nonce: request.Nonce, ChainID: request.ChainID, RequestingProduct: request.RequestingProduct, ProductClientID: request.ProductClientID, BundleID: request.BundleID, ProductDeviceAlgorithm: request.ProductDeviceAlgorithm, ProductDeviceKey: request.ProductDeviceKey, Callback: request.Callback, Account: f.account, AccountPublicKey: hex.EncodeToString(f.key.PubKey().SerializeCompressed()), GrantedScopes: append([]string(nil), request.Scopes...), Purpose: request.Purpose, IssuedAt: now.Format(protocolTimeLayout), ExpiresAt: now.Add(3 * time.Minute).Format(protocolTimeLayout)}
	in := WalletChallengeRequest{Request: request, Approval: approval}
	resignApproval(t, f, &in)
	return in
}
func resignApproval(t *testing.T, f fixture, in *WalletChallengeRequest) {
	t.Helper()
	digest, _ := WalletRequestDigest(in.Request)
	in.Approval.RequestDigest = digest
	payload, _ := WalletApprovalSignBytes(in.Approval)
	signDigest := sha256.Sum256(payload)
	in.Approval.WalletSignature = hex.EncodeToString(ecdsa.SignCompact(f.key, signDigest[:], false)[1:])
}
func signedLogin(t *testing.T, s *Service, f fixture, now time.Time) WalletLogin {
	t.Helper()
	approval := signedWalletApproval(t, f, now)
	challenge, err := s.CreateWalletChallenge(approval)
	if err != nil {
		t.Fatal(err)
	}
	bytesToSign, _ := GatewayChallengeSignBytes(challenge)
	digest := sha256.Sum256(bytesToSign)
	deviceSignature, err := stdECDSA.SignASN1(rand.Reader, f.productKey, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	login := WalletLogin{Challenge: challenge, DeviceSignature: base64.RawURLEncoding.EncodeToString(deviceSignature), DeviceID: f.device, DeviceSigningPublicKey: nativewallet.EncodePublicKey(f.deviceKeys.SigningPublic), DeviceEncryptionPublicKey: nativewallet.EncodePublicKey(f.deviceKeys.EncryptionPublic)}
	login.DeviceProofSignature = nativewallet.Sign(f.deviceKeys.SigningPrivate, DeviceProofPayload(login, approval.Approval))
	squareRequest := square.RegisterDeviceRequest{IdempotencyKey: RegistrationIdempotencyKey("social-square", approval.Approval.RequestDigest), Account: approval.Approval.Account, DeviceID: login.DeviceID, SigningPublicKey: login.DeviceSigningPublicKey}
	login.SquareRegistrationSignature = nativewallet.Sign(f.deviceKeys.SigningPrivate, square.DeviceRegistrationPayload(squareRequest))
	chatRequest := chat.RegisterDeviceRequest{IdempotencyKey: RegistrationIdempotencyKey("social-chat", approval.Approval.RequestDigest), Account: approval.Approval.Account, DeviceID: login.DeviceID, SigningPublicKey: login.DeviceSigningPublicKey, EncryptionPublicKey: login.DeviceEncryptionPublicKey}
	login.ChatRegistrationSignature = nativewallet.Sign(f.deviceKeys.SigningPrivate, chat.DeviceRegistrationPayload(chatRequest))
	return login
}
func loginFixture(t *testing.T, s *Service, f fixture, now time.Time) Session {
	t.Helper()
	result, err := s.Login(signedLogin(t, s, f, now))
	if err != nil {
		t.Fatal(err)
	}
	return result.Session
}
func stringsContains(value, part string) bool {
	return len(value) >= len(part) && func() bool {
		for i := 0; i+len(part) <= len(value); i++ {
			if value[i:i+len(part)] == part {
				return true
			}
		}
		return false
	}()
}

var _ = json.Marshal
