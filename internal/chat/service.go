package chat

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

var (
	identifierPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$`)
	digestPattern     = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

const (
	messageProtocolVersion = 2
	messageAlgorithm       = "x25519-hkdf-sha256-xchacha20poly1305"
	maxMessageEnvelopes    = 32
)

type Service struct {
	mu    sync.Mutex
	cfg   Config
	state persistentState
	seen  map[string][]time.Time
}

func New(cfg Config) (*Service, error) {
	cfg.StatePath = strings.TrimSpace(cfg.StatePath)
	cfg.APIKey = strings.TrimSpace(cfg.APIKey)
	if cfg.MaxCiphertextBytes == 0 {
		cfg.MaxCiphertextBytes = 64 * 1024
	}
	if err := ValidateConfig(cfg); err != nil {
		return nil, err
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	if cfg.RateLimitWindow <= 0 {
		cfg.RateLimitWindow = time.Minute
	}
	if cfg.RateLimitMax <= 0 {
		cfg.RateLimitMax = 120
	}
	state, existed, err := loadState(cfg.StatePath)
	if err != nil {
		return nil, err
	}
	service := &Service{cfg: cfg, state: state, seen: map[string][]time.Time{}}
	if err := service.validateStateLocked(); err != nil {
		return nil, err
	}
	if err := service.validateAuditLocked(); err != nil {
		return nil, err
	}
	if !existed {
		if err := saveState(cfg.StatePath, &service.state); err != nil {
			return nil, err
		}
	}
	return service, nil
}

func ValidateConfig(cfg Config) error {
	if strings.TrimSpace(cfg.StatePath) == "" || len(strings.TrimSpace(cfg.APIKey)) < 16 {
		return errors.New("chat state path and API key of at least 16 characters are required")
	}
	limit := cfg.MaxCiphertextBytes
	if limit == 0 {
		limit = 64 * 1024
	}
	if limit < 1024 || limit > 1024*1024 {
		return errors.New("chat ciphertext limit must be between 1024 and 1048576 bytes")
	}
	if cfg.RateLimitWindow < 0 || cfg.RateLimitMax < 0 {
		return errors.New("chat rate limit values cannot be negative")
	}
	return nil
}

func (s *Service) Allow(remoteAddress, deviceID string) bool {
	host, _, err := net.SplitHostPort(remoteAddress)
	if err != nil {
		host = remoteAddress
	}
	key := strings.TrimSpace(deviceID) + "|" + strings.TrimSpace(host)
	now := s.cfg.Now().UTC()
	cutoff := now.Add(-s.cfg.RateLimitWindow)
	s.mu.Lock()
	defer s.mu.Unlock()
	recent := s.seen[key][:0]
	for _, at := range s.seen[key] {
		if at.After(cutoff) {
			recent = append(recent, at)
		}
	}
	if len(recent) >= s.cfg.RateLimitMax {
		s.seen[key] = recent
		return false
	}
	s.seen[key] = append(recent, now)
	return true
}

func (s *Service) Authorized(value string) bool {
	value = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	return len(value) == len(s.cfg.APIKey) && subtle.ConstantTimeCompare([]byte(value), []byte(s.cfg.APIKey)) == 1
}

func DeviceRegistrationPayload(req RegisterDeviceRequest) []byte {
	return []byte(strings.Join([]string{"ynx-chat-device-register-v1", req.Account, req.DeviceID, req.SigningPublicKey, req.EncryptionPublicKey, req.IdempotencyKey}, "\n"))
}

func RequestSignaturePayload(method, path, timestamp string, body []byte) []byte {
	digest := sha256.Sum256(body)
	return []byte(strings.Join([]string{"ynx-chat-http-v1", strings.ToUpper(method), path, timestamp, hex.EncodeToString(digest[:])}, "\n"))
}

func MessageSignaturePayload(conversationID, senderAccount, senderDeviceID string, req SendMessageRequest) []byte {
	canonical := append([]MessageEnvelope(nil), req.Envelopes...)
	for index := range canonical {
		canonical[index].CiphertextHash = ""
	}
	canonical = canonicalMessageEnvelopes(canonical)
	document := struct {
		ProtocolVersion int               `json:"protocolVersion"`
		ConversationID  string            `json:"conversationId"`
		MessageID       string            `json:"messageId"`
		Sender          string            `json:"sender"`
		SenderDeviceID  string            `json:"senderDeviceId"`
		Envelopes       []MessageEnvelope `json:"envelopes"`
	}{messageProtocolVersion, conversationID, req.MessageID, senderAccount, senderDeviceID, canonical}
	data, _ := json.Marshal(document)
	return append([]byte("ynx-chat-message-v2\n"), data...)
}

func MessageEnvelopeAAD(conversationID, messageID, senderDeviceID, recipientAccount, recipientDeviceID, algorithm, ephemeralPublicKey string) []byte {
	return []byte(strings.Join([]string{"ynx-chat-envelope-v2", conversationID, messageID, senderDeviceID, recipientAccount, recipientDeviceID, algorithm, ephemeralPublicKey}, "\n"))
}

func DeviceRotationAuthorizationPayload(account, authorizingDeviceID, replacedDeviceID string, req RotateDeviceRequest) []byte {
	return deviceRotationPayload("ynx-chat-device-rotation-authorize-v1", account, authorizingDeviceID, replacedDeviceID, req)
}

func DeviceRotationNewDevicePayload(account, authorizingDeviceID, replacedDeviceID string, req RotateDeviceRequest) []byte {
	return deviceRotationPayload("ynx-chat-device-rotation-new-device-v1", account, authorizingDeviceID, replacedDeviceID, req)
}

func (s *Service) RegisterDevice(req RegisterDeviceRequest) (Result[Device], error) {
	account, err := nativewallet.NormalizeNativeAddress(req.Account)
	if err != nil || !identifierPattern.MatchString(req.DeviceID) || !identifierPattern.MatchString(req.IdempotencyKey) {
		return Result[Device]{}, fmt.Errorf("%w: invalid native account, device id, or idempotency key", ErrInvalid)
	}
	req.Account = account
	if _, err := nativewallet.DecodePublicKey(req.SigningPublicKey, ed25519.PublicKeySize); err != nil {
		return Result[Device]{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if _, err := nativewallet.DecodePublicKey(req.EncryptionPublicKey, 32); err != nil {
		return Result[Device]{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if !nativewallet.Verify(req.SigningPublicKey, DeviceRegistrationPayload(req), req.ProofSignature) {
		return Result[Device]{}, fmt.Errorf("%w: device private-key proof failed", ErrUnauthorized)
	}
	digest := objectDigest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if previous.Action != "device_register" || previous.Digest != digest {
			return Result[Device]{}, fmt.Errorf("%w: idempotency key reused with different input", ErrConflict)
		}
		return Result[Device]{Record: s.state.Devices[previous.ObjectID], Replayed: true}, nil
	}
	if existing, exists := s.state.Devices[req.DeviceID]; exists {
		if existing.Status != "active" || existing.Account != account || existing.SigningPublicKey != req.SigningPublicKey || existing.EncryptionPublicKey != req.EncryptionPublicKey {
			return Result[Device]{}, fmt.Errorf("%w: device id already exists", ErrConflict)
		}
		before := cloneState(s.state)
		s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "device_register", Digest: digest, ObjectID: existing.ID}
		if err := s.saveOrRollbackLocked(before); err != nil {
			return Result[Device]{}, err
		}
		return Result[Device]{Record: existing, Replayed: true}, nil
	}
	now := s.cfg.Now().UTC()
	device := Device{ID: req.DeviceID, Account: account, SigningPublicKey: req.SigningPublicKey, EncryptionPublicKey: req.EncryptionPublicKey, Status: "active", CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Devices[device.ID] = device
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "device_register", Digest: digest, ObjectID: device.ID}
	s.appendAuditLocked("device_registered", "device", device.ID, device.Account, digest, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Result[Device]{}, err
	}
	return Result[Device]{Record: device}, nil
}

func (s *Service) AuthenticateDevice(deviceID, method, path, timestamp, signature string, body []byte) (Device, error) {
	parsed, err := time.Parse(time.RFC3339, timestamp)
	if err != nil || absDuration(s.cfg.Now().Sub(parsed)) > 5*time.Minute {
		return Device{}, fmt.Errorf("%w: request timestamp is invalid or stale", ErrUnauthorized)
	}
	s.mu.Lock()
	device, ok := s.state.Devices[deviceID]
	s.mu.Unlock()
	if !ok || !nativewallet.Verify(device.SigningPublicKey, RequestSignaturePayload(method, path, timestamp, body), signature) {
		return Device{}, fmt.Errorf("%w: device signature failed", ErrUnauthorized)
	}
	if device.Status != "active" {
		rotationReplayPath := "/chat/devices/" + device.ID + "/rotate"
		if method != http.MethodPost || strings.SplitN(path, "?", 2)[0] != rotationReplayPath {
			return Device{}, fmt.Errorf("%w: device is revoked", ErrUnauthorized)
		}
	}
	return device, nil
}

func (s *Service) RevokeDevice(actor Device, deviceID string) (Device, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	device, ok := s.state.Devices[deviceID]
	if !ok {
		return Device{}, ErrNotFound
	}
	if actor.Account != device.Account || device.Status != "active" {
		return Device{}, ErrUnauthorized
	}
	before := cloneState(s.state)
	device.Status = "revoked"
	device.UpdatedAt = s.cfg.Now().UTC()
	s.state.Devices[deviceID] = device
	s.appendAuditLocked("device_revoked", "device", device.ID, actor.Account, objectDigest(device), device.UpdatedAt)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Device{}, err
	}
	return device, nil
}

func (s *Service) RotateDevice(actor Device, replacedDeviceID string, req RotateDeviceRequest) (Result[DeviceRotation], error) {
	if !identifierPattern.MatchString(replacedDeviceID) || !identifierPattern.MatchString(req.NewDeviceID) || !identifierPattern.MatchString(req.IdempotencyKey) || replacedDeviceID == req.NewDeviceID {
		return Result[DeviceRotation]{}, fmt.Errorf("%w: invalid rotation device or idempotency identifier", ErrInvalid)
	}
	if _, err := nativewallet.DecodePublicKey(req.SigningPublicKey, ed25519.PublicKeySize); err != nil {
		return Result[DeviceRotation]{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if _, err := nativewallet.DecodePublicKey(req.EncryptionPublicKey, 32); err != nil {
		return Result[DeviceRotation]{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	authorizationPayload := DeviceRotationAuthorizationPayload(actor.Account, actor.ID, replacedDeviceID, req)
	newDevicePayload := DeviceRotationNewDevicePayload(actor.Account, actor.ID, replacedDeviceID, req)
	if !nativewallet.Verify(actor.SigningPublicKey, authorizationPayload, req.AuthorizationSignature) {
		return Result[DeviceRotation]{}, fmt.Errorf("%w: authorizing device proof failed", ErrUnauthorized)
	}
	if !nativewallet.Verify(req.SigningPublicKey, newDevicePayload, req.NewDeviceProofSignature) {
		return Result[DeviceRotation]{}, fmt.Errorf("%w: new device private-key proof failed", ErrUnauthorized)
	}
	digest := objectDigest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if previous.Action != "device_rotate" || previous.Digest != digest {
			return Result[DeviceRotation]{}, fmt.Errorf("%w: idempotency key reused with different input", ErrConflict)
		}
		rotation, exists := s.state.Rotations[previous.ObjectID]
		if !exists || rotation.Account != actor.Account || rotation.AuthorizingDeviceID != actor.ID || rotation.ReplacedDeviceID != replacedDeviceID {
			return Result[DeviceRotation]{}, ErrUnauthorized
		}
		return Result[DeviceRotation]{Record: rotation, Replayed: true}, nil
	}
	currentActor, ok := s.state.Devices[actor.ID]
	if !ok || currentActor.Status != "active" || currentActor.Account != actor.Account || currentActor.SigningPublicKey != actor.SigningPublicKey {
		return Result[DeviceRotation]{}, ErrUnauthorized
	}
	replaced, ok := s.state.Devices[replacedDeviceID]
	if !ok {
		return Result[DeviceRotation]{}, ErrNotFound
	}
	if replaced.Account != actor.Account {
		return Result[DeviceRotation]{}, ErrUnauthorized
	}
	if _, exists := s.state.Devices[req.NewDeviceID]; exists {
		return Result[DeviceRotation]{}, fmt.Errorf("%w: new device id already exists", ErrConflict)
	}
	now := s.cfg.Now().UTC()
	authorizationHash := sha256.Sum256([]byte(req.AuthorizationSignature))
	newProofHash := sha256.Sum256([]byte(req.NewDeviceProofSignature))
	rotationID := "rotation_" + digest[:24]
	rotation := DeviceRotation{ID: rotationID, Account: actor.Account, AuthorizingDeviceID: actor.ID, ReplacedDeviceID: replacedDeviceID, NewDeviceID: req.NewDeviceID, AuthorizationSignatureHash: hex.EncodeToString(authorizationHash[:]), NewDeviceProofHash: hex.EncodeToString(newProofHash[:]), CreatedAt: now}
	newDevice := Device{ID: req.NewDeviceID, Account: actor.Account, SigningPublicKey: req.SigningPublicKey, EncryptionPublicKey: req.EncryptionPublicKey, Status: "active", CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	replaced.Status = "revoked"
	replaced.UpdatedAt = now
	s.state.Devices[replaced.ID] = replaced
	s.state.Devices[newDevice.ID] = newDevice
	s.state.Rotations[rotation.ID] = rotation
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "device_rotate", Digest: digest, ObjectID: rotation.ID}
	s.appendAuditLocked("device_rotation_authorized", "device_rotation", rotation.ID, actor.Account, objectDigest(rotation), now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Result[DeviceRotation]{}, err
	}
	return Result[DeviceRotation]{Record: rotation}, nil
}

func (s *Service) DeviceRotations(actor Device) []DeviceRotation {
	s.mu.Lock()
	defer s.mu.Unlock()
	records := make([]DeviceRotation, 0)
	for _, rotation := range s.state.Rotations {
		if rotation.Account == actor.Account {
			records = append(records, rotation)
		}
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].CreatedAt.Equal(records[j].CreatedAt) {
			return records[i].ID < records[j].ID
		}
		return records[i].CreatedAt.Before(records[j].CreatedAt)
	})
	return records
}

func (s *Service) CreateConversation(actor Device, req CreateConversationRequest) (Result[Conversation], error) {
	if !identifierPattern.MatchString(req.IdempotencyKey) || len(req.Members) != 2 {
		return Result[Conversation]{}, fmt.Errorf("%w: direct conversation requires two members and an idempotency key", ErrInvalid)
	}
	members := make([]string, 0, 2)
	seen := map[string]bool{}
	for _, member := range req.Members {
		normalized, err := nativewallet.NormalizeNativeAddress(member)
		if err != nil || seen[normalized] {
			return Result[Conversation]{}, fmt.Errorf("%w: conversation members must be two distinct ynx1 accounts", ErrInvalid)
		}
		seen[normalized] = true
		members = append(members, normalized)
	}
	if !seen[actor.Account] {
		return Result[Conversation]{}, ErrUnauthorized
	}
	sort.Strings(members)
	req.Members = members
	digest := objectDigest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous, ok := s.state.Idempotency[req.IdempotencyKey]; ok {
		if previous.Action != "conversation_create" || previous.Digest != digest {
			return Result[Conversation]{}, ErrConflict
		}
		return Result[Conversation]{Record: s.state.Conversations[previous.ObjectID], Replayed: true}, nil
	}
	if !s.hasActiveDeviceLocked(members[0]) || !s.hasActiveDeviceLocked(members[1]) {
		return Result[Conversation]{}, fmt.Errorf("%w: every member requires an active registered device", ErrConflict)
	}
	now := s.cfg.Now().UTC()
	id := "conv_" + digest[:24]
	conversation := Conversation{ID: id, Members: members, CreatedBy: actor.Account, CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Conversations[id] = conversation
	s.state.Idempotency[req.IdempotencyKey] = idempotencyRecord{Action: "conversation_create", Digest: digest, ObjectID: id}
	s.appendAuditLocked("conversation_created", "conversation", id, actor.Account, digest, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Result[Conversation]{}, err
	}
	return Result[Conversation]{Record: conversation}, nil
}

func (s *Service) SendMessage(actor Device, conversationID string, req SendMessageRequest) (Result[Message], error) {
	if !identifierPattern.MatchString(req.MessageID) || len(req.Envelopes) < 1 || len(req.Envelopes) > maxMessageEnvelopes || strings.TrimSpace(req.SenderSignature) == "" {
		return Result[Message]{}, fmt.Errorf("%w: invalid message id, envelope count, or sender signature", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	conversation, ok := s.state.Conversations[conversationID]
	if !ok {
		return Result[Message]{}, ErrNotFound
	}
	if !contains(conversation.Members, actor.Account) {
		return Result[Message]{}, ErrUnauthorized
	}
	envelopes, err := s.validateMessageEnvelopesLocked(conversation, req.Envelopes)
	if err != nil {
		return Result[Message]{}, err
	}
	req.Envelopes = envelopes
	digest := objectDigest(req)
	for _, message := range s.state.Messages[conversationID] {
		if message.ID == req.MessageID {
			if message.ProtocolVersion != messageProtocolVersion || objectDigest(SendMessageRequest{MessageID: message.ID, Envelopes: message.Envelopes, SenderSignature: message.SenderSignature}) != digest {
				return Result[Message]{}, ErrConflict
			}
			return Result[Message]{Record: message, Replayed: true}, nil
		}
	}
	if !nativewallet.Verify(actor.SigningPublicKey, MessageSignaturePayload(conversationID, actor.Account, actor.ID, req), req.SenderSignature) {
		return Result[Message]{}, fmt.Errorf("%w: persisted sender signature failed", ErrUnauthorized)
	}
	now := s.cfg.Now().UTC()
	envelopeSetHash := objectDigest(envelopes)
	message := Message{ID: req.MessageID, ConversationID: conversationID, Sender: actor.Account, SenderDeviceID: actor.ID, ProtocolVersion: messageProtocolVersion, Envelopes: envelopes, SenderSignature: req.SenderSignature, EnvelopeSetHash: envelopeSetHash, CreatedAt: now, DeliveredAt: map[string]time.Time{}, ReadAt: map[string]time.Time{}}
	before := cloneState(s.state)
	s.state.Messages[conversationID] = append(s.state.Messages[conversationID], message)
	conversation.UpdatedAt = now
	s.state.Conversations[conversationID] = conversation
	s.appendAuditLocked("message_envelope_set_stored", "message", message.ID, actor.Account, message.EnvelopeSetHash, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Result[Message]{}, err
	}
	return Result[Message]{Record: message}, nil
}

func (s *Service) Acknowledge(actor Device, conversationID, messageID, state string) (Message, error) {
	if state != "delivered" && state != "read" {
		return Message{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	conversation, ok := s.state.Conversations[conversationID]
	if !ok || !contains(conversation.Members, actor.Account) {
		return Message{}, ErrUnauthorized
	}
	before := cloneState(s.state)
	messages := s.state.Messages[conversationID]
	for index := range messages {
		if messages[index].ID != messageID {
			continue
		}
		now := s.cfg.Now().UTC()
		acknowledgementKey := actor.Account
		if messages[index].ProtocolVersion == messageProtocolVersion {
			acknowledgementKey = actor.ID
		}
		if messages[index].DeliveredAt == nil {
			messages[index].DeliveredAt = map[string]time.Time{}
		}
		if messages[index].ReadAt == nil {
			messages[index].ReadAt = map[string]time.Time{}
		}
		messages[index].DeliveredAt[acknowledgementKey] = now
		if state == "read" {
			messages[index].ReadAt[acknowledgementKey] = now
		}
		s.state.Messages[conversationID] = messages
		s.appendAuditLocked("message_"+state, "message", messageID, actor.Account, objectDigest(messages[index]), now)
		if err := s.saveOrRollbackLocked(before); err != nil {
			return Message{}, err
		}
		return messages[index], nil
	}
	return Message{}, ErrNotFound
}

func (s *Service) Conversation(actor Device, id string) (Conversation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.state.Conversations[id]
	if !ok {
		return Conversation{}, ErrNotFound
	}
	if !contains(record.Members, actor.Account) {
		return Conversation{}, ErrUnauthorized
	}
	return record, nil
}

func (s *Service) Conversations(actor Device) []Conversation {
	s.mu.Lock()
	defer s.mu.Unlock()
	records := make([]Conversation, 0)
	for _, record := range s.state.Conversations {
		if contains(record.Members, actor.Account) {
			records = append(records, record)
		}
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].UpdatedAt.Equal(records[j].UpdatedAt) {
			return records[i].ID < records[j].ID
		}
		return records[i].UpdatedAt.After(records[j].UpdatedAt)
	})
	return records
}

func (s *Service) Devices(actor Device, account string) ([]Device, error) {
	normalized, err := nativewallet.NormalizeNativeAddress(account)
	if err != nil {
		return nil, fmt.Errorf("%w: device directory account must be a ynx1 address", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if normalized != actor.Account {
		shared := false
		for _, conversation := range s.state.Conversations {
			if contains(conversation.Members, actor.Account) && contains(conversation.Members, normalized) {
				shared = true
				break
			}
		}
		if !shared {
			return nil, ErrUnauthorized
		}
	}
	records := make([]Device, 0)
	for _, device := range s.state.Devices {
		if device.Account == normalized {
			records = append(records, device)
		}
	}
	sort.Slice(records, func(i, j int) bool { return records[i].ID < records[j].ID })
	return records, nil
}

func (s *Service) Messages(actor Device, id string) ([]Message, error) {
	if _, err := s.Conversation(actor, id); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	records := s.state.Messages[id]
	return append(make([]Message, 0, len(records)), records...), nil
}

func (s *Service) Health() Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	for _, messages := range s.state.Messages {
		count += len(messages)
	}
	status := "local-bounded-chat-core-not-remote-deployed"
	if s.cfg.RemoteDeployed {
		status = "remote-bounded-chat-core-no-public-ingress-claim"
	}
	return Health{OK: true, Service: "ynx-chatd", Persistence: "atomic-json-mode-0600", StateIntegrity: "sha256-and-hash-chained-audit", NativeAddressDefault: true, PlaintextStored: false, RemoteDeployed: s.cfg.RemoteDeployed, DeviceCount: len(s.state.Devices), ConversationCount: len(s.state.Conversations), MessageCount: count, RotationCount: len(s.state.Rotations), TruthfulStatus: status, RateLimit: fmt.Sprintf("%d per %s per device/ip", s.cfg.RateLimitMax, s.cfg.RateLimitWindow)}
}

func (s *Service) hasActiveDeviceLocked(account string) bool {
	for _, device := range s.state.Devices {
		if device.Account == account && device.Status == "active" {
			return true
		}
	}
	return false
}

func (s *Service) validateMessageEnvelopesLocked(conversation Conversation, input []MessageEnvelope) ([]MessageEnvelope, error) {
	expected := map[string]Device{}
	for _, device := range s.state.Devices {
		if device.Status == "active" && contains(conversation.Members, device.Account) {
			expected[device.ID] = device
		}
	}
	if len(expected) == 0 || len(expected) > maxMessageEnvelopes {
		return nil, fmt.Errorf("%w: conversation active-device set exceeds envelope policy", ErrConflict)
	}
	if len(input) != len(expected) {
		return nil, fmt.Errorf("%w: message requires exactly one envelope for every active conversation device", ErrConflict)
	}
	seenDevices := map[string]bool{}
	seenNonces := map[string]bool{}
	commonEphemeralKey := ""
	totalCiphertext := 0
	envelopes := append([]MessageEnvelope(nil), input...)
	for index := range envelopes {
		envelope := &envelopes[index]
		device, ok := expected[envelope.RecipientDeviceID]
		if !ok || seenDevices[envelope.RecipientDeviceID] {
			return nil, fmt.Errorf("%w: envelope recipient is missing, duplicated, revoked, or outside the conversation", ErrConflict)
		}
		normalized, err := nativewallet.NormalizeNativeAddress(envelope.RecipientAccount)
		if err != nil || normalized != device.Account {
			return nil, fmt.Errorf("%w: envelope recipient account does not match its device", ErrInvalid)
		}
		envelope.RecipientAccount = normalized
		if envelope.Algorithm != messageAlgorithm {
			return nil, fmt.Errorf("%w: unsupported message envelope algorithm", ErrInvalid)
		}
		if _, err := nativewallet.DecodePublicKey(envelope.EphemeralPublicKey, 32); err != nil {
			return nil, fmt.Errorf("%w: invalid message ephemeral public key", ErrInvalid)
		}
		if commonEphemeralKey == "" {
			commonEphemeralKey = envelope.EphemeralPublicKey
		} else if commonEphemeralKey != envelope.EphemeralPublicKey {
			return nil, fmt.Errorf("%w: one message must use one ephemeral key across its device envelopes", ErrInvalid)
		}
		nonce, err := base64.RawStdEncoding.DecodeString(envelope.Nonce)
		if err != nil || len(nonce) != 24 || seenNonces[envelope.Nonce] {
			return nil, fmt.Errorf("%w: envelope nonce must be unique and encode 24 bytes", ErrInvalid)
		}
		ciphertext, err := base64.RawStdEncoding.DecodeString(envelope.Ciphertext)
		if err != nil || len(ciphertext) < 16 {
			return nil, fmt.Errorf("%w: envelope ciphertext is malformed", ErrInvalid)
		}
		totalCiphertext += len(ciphertext)
		if totalCiphertext > s.cfg.MaxCiphertextBytes {
			return nil, fmt.Errorf("%w: aggregate envelope ciphertext exceeds policy", ErrInvalid)
		}
		cipherHash := sha256.Sum256(ciphertext)
		computedHash := hex.EncodeToString(cipherHash[:])
		if envelope.CiphertextHash != "" && envelope.CiphertextHash != computedHash {
			return nil, fmt.Errorf("%w: envelope ciphertext hash mismatch", ErrInvalid)
		}
		envelope.CiphertextHash = computedHash
		seenDevices[envelope.RecipientDeviceID] = true
		seenNonces[envelope.Nonce] = true
	}
	return canonicalMessageEnvelopes(envelopes), nil
}

func canonicalMessageEnvelopes(input []MessageEnvelope) []MessageEnvelope {
	envelopes := append([]MessageEnvelope(nil), input...)
	sort.Slice(envelopes, func(i, j int) bool {
		if envelopes[i].RecipientAccount == envelopes[j].RecipientAccount {
			return envelopes[i].RecipientDeviceID < envelopes[j].RecipientDeviceID
		}
		return envelopes[i].RecipientAccount < envelopes[j].RecipientAccount
	})
	return envelopes
}

func deviceRotationPayload(domain, account, authorizingDeviceID, replacedDeviceID string, req RotateDeviceRequest) []byte {
	document := struct {
		Account             string `json:"account"`
		AuthorizingDeviceID string `json:"authorizingDeviceId"`
		ReplacedDeviceID    string `json:"replacedDeviceId"`
		IdempotencyKey      string `json:"idempotencyKey"`
		NewDeviceID         string `json:"newDeviceId"`
		SigningPublicKey    string `json:"signingPublicKey"`
		EncryptionPublicKey string `json:"encryptionPublicKey"`
	}{account, authorizingDeviceID, replacedDeviceID, req.IdempotencyKey, req.NewDeviceID, req.SigningPublicKey, req.EncryptionPublicKey}
	data, _ := json.Marshal(document)
	return append([]byte(domain+"\n"), data...)
}

func (s *Service) validateStateLocked() error {
	for id, device := range s.state.Devices {
		if id != device.ID || !identifierPattern.MatchString(id) || (device.Status != "active" && device.Status != "revoked") {
			return errors.New("chat device state is invalid")
		}
		if normalized, err := nativewallet.NormalizeNativeAddress(device.Account); err != nil || normalized != device.Account {
			return errors.New("chat device account state is invalid")
		}
		if _, err := nativewallet.DecodePublicKey(device.SigningPublicKey, ed25519.PublicKeySize); err != nil {
			return errors.New("chat device signing key state is invalid")
		}
		if _, err := nativewallet.DecodePublicKey(device.EncryptionPublicKey, 32); err != nil {
			return errors.New("chat device encryption key state is invalid")
		}
	}
	for id, conversation := range s.state.Conversations {
		if id != conversation.ID || len(conversation.Members) != 2 || conversation.Members[0] >= conversation.Members[1] || !contains(conversation.Members, conversation.CreatedBy) {
			return errors.New("chat conversation state is invalid")
		}
		for _, member := range conversation.Members {
			if normalized, err := nativewallet.NormalizeNativeAddress(member); err != nil || normalized != member {
				return errors.New("chat conversation member state is invalid")
			}
		}
	}
	for conversationID, messages := range s.state.Messages {
		conversation, ok := s.state.Conversations[conversationID]
		if !ok {
			if len(messages) == 0 {
				continue
			}
			return errors.New("chat message conversation state is invalid")
		}
		seenMessages := map[string]bool{}
		for _, message := range messages {
			if message.ConversationID != conversationID || seenMessages[message.ID] || !contains(conversation.Members, message.Sender) {
				return errors.New("chat message identity state is invalid")
			}
			senderDevice, ok := s.state.Devices[message.SenderDeviceID]
			if !ok || senderDevice.Account != message.Sender {
				return errors.New("chat message sender device state is invalid")
			}
			if message.ProtocolVersion == messageProtocolVersion {
				if len(message.Envelopes) == 0 || len(message.Envelopes) > maxMessageEnvelopes || message.EnvelopeSetHash != objectDigest(message.Envelopes) {
					return errors.New("chat message envelope set state is invalid")
				}
				seenRecipients := map[string]bool{}
				seenNonces := map[string]bool{}
				commonEphemeralKey := ""
				previousRecipient := ""
				totalCiphertext := 0
				for _, envelope := range message.Envelopes {
					recipient, ok := s.state.Devices[envelope.RecipientDeviceID]
					ciphertext, decodeErr := base64.RawStdEncoding.DecodeString(envelope.Ciphertext)
					nonce, nonceErr := base64.RawStdEncoding.DecodeString(envelope.Nonce)
					_, ephemeralErr := nativewallet.DecodePublicKey(envelope.EphemeralPublicKey, 32)
					cipherHash := sha256.Sum256(ciphertext)
					recipientKey := envelope.RecipientAccount + "\n" + envelope.RecipientDeviceID
					if !ok || recipient.Account != envelope.RecipientAccount || seenRecipients[envelope.RecipientDeviceID] || envelope.Algorithm != messageAlgorithm || decodeErr != nil || len(ciphertext) < 16 || nonceErr != nil || len(nonce) != 24 || seenNonces[envelope.Nonce] || ephemeralErr != nil || envelope.CiphertextHash != hex.EncodeToString(cipherHash[:]) || (previousRecipient != "" && recipientKey <= previousRecipient) {
						return errors.New("chat message recipient envelope state is invalid")
					}
					if commonEphemeralKey != "" && commonEphemeralKey != envelope.EphemeralPublicKey {
						return errors.New("chat message ephemeral key state is invalid")
					}
					commonEphemeralKey = envelope.EphemeralPublicKey
					previousRecipient = recipientKey
					totalCiphertext += len(ciphertext)
					if totalCiphertext > s.cfg.MaxCiphertextBytes {
						return errors.New("chat message aggregate ciphertext state exceeds policy")
					}
					seenRecipients[envelope.RecipientDeviceID] = true
					seenNonces[envelope.Nonce] = true
				}
				req := SendMessageRequest{MessageID: message.ID, Envelopes: message.Envelopes, SenderSignature: message.SenderSignature}
				if !nativewallet.Verify(senderDevice.SigningPublicKey, MessageSignaturePayload(conversationID, message.Sender, message.SenderDeviceID, req), message.SenderSignature) {
					return errors.New("chat message sender signature state is invalid")
				}
			} else if message.Algorithm != messageAlgorithm || message.Ciphertext == "" || message.CiphertextHash == "" {
				return errors.New("chat legacy message state is invalid")
			}
			seenMessages[message.ID] = true
		}
	}
	for id, rotation := range s.state.Rotations {
		authorizer, authorizerOK := s.state.Devices[rotation.AuthorizingDeviceID]
		replaced, replacedOK := s.state.Devices[rotation.ReplacedDeviceID]
		newDevice, newOK := s.state.Devices[rotation.NewDeviceID]
		if id != rotation.ID || !authorizerOK || !replacedOK || !newOK || authorizer.Account != rotation.Account || replaced.Account != rotation.Account || newDevice.Account != rotation.Account || !digestPattern.MatchString(rotation.AuthorizationSignatureHash) || !digestPattern.MatchString(rotation.NewDeviceProofHash) || rotation.CreatedAt.IsZero() {
			return errors.New("chat device rotation state is invalid")
		}
	}
	return nil
}

func (s *Service) appendAuditLocked(eventType, objectType, objectID, account, payloadHash string, at time.Time) {
	previous := ""
	if len(s.state.Audit) > 0 {
		previous = s.state.Audit[len(s.state.Audit)-1].Hash
	}
	event := AuditEvent{Sequence: uint64(len(s.state.Audit) + 1), Type: eventType, ObjectType: objectType, ObjectID: objectID, Account: account, At: at, PayloadHash: payloadHash, PreviousHash: previous}
	event.Hash = auditHash(event)
	s.state.Audit = append(s.state.Audit, event)
}

func (s *Service) validateAuditLocked() error {
	previous := ""
	for index, event := range s.state.Audit {
		if event.Sequence != uint64(index+1) || event.PreviousHash != previous || event.Hash != auditHash(event) {
			return errors.New("chat audit chain verification failed")
		}
		previous = event.Hash
	}
	return nil
}

func auditHash(event AuditEvent) string {
	payload := strings.Join([]string{strconv.FormatUint(event.Sequence, 10), event.Type, event.ObjectType, event.ObjectID, event.Account, event.At.UTC().Format(time.RFC3339Nano), event.PayloadHash, event.PreviousHash}, "\n")
	digest := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(digest[:])
}

func objectDigest(value any) string {
	data, _ := json.Marshal(value)
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
func cloneState(state persistentState) persistentState {
	data, _ := json.Marshal(state)
	var cloned persistentState
	_ = json.Unmarshal(data, &cloned)
	return cloned
}
func (s *Service) saveOrRollbackLocked(before persistentState) error {
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return err
	}
	return nil
}
func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
func absDuration(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}
