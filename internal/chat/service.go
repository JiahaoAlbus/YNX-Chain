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
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

var identifierPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$`)

type Service struct {
	mu    sync.Mutex
	cfg   Config
	state persistentState
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
	state, existed, err := loadState(cfg.StatePath)
	if err != nil {
		return nil, err
	}
	service := &Service{cfg: cfg, state: state}
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
	return nil
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
	if _, exists := s.state.Devices[req.DeviceID]; exists {
		return Result[Device]{}, fmt.Errorf("%w: device id already exists", ErrConflict)
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
	if !ok || device.Status != "active" || !nativewallet.Verify(device.SigningPublicKey, RequestSignaturePayload(method, path, timestamp, body), signature) {
		return Device{}, fmt.Errorf("%w: device signature failed", ErrUnauthorized)
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
	if !identifierPattern.MatchString(req.MessageID) || req.Algorithm != "x25519-hkdf-sha256-xchacha20poly1305" {
		return Result[Message]{}, fmt.Errorf("%w: invalid message id or algorithm", ErrInvalid)
	}
	nonce, err := base64.RawStdEncoding.DecodeString(req.Nonce)
	if err != nil || len(nonce) != 24 {
		return Result[Message]{}, fmt.Errorf("%w: nonce must encode 24 bytes", ErrInvalid)
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(req.Ciphertext)
	if err != nil || len(ciphertext) < 16 || len(ciphertext) > s.cfg.MaxCiphertextBytes {
		return Result[Message]{}, fmt.Errorf("%w: ciphertext is malformed or exceeds policy", ErrInvalid)
	}
	digest := objectDigest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	conversation, ok := s.state.Conversations[conversationID]
	if !ok {
		return Result[Message]{}, ErrNotFound
	}
	if !contains(conversation.Members, actor.Account) {
		return Result[Message]{}, ErrUnauthorized
	}
	for _, message := range s.state.Messages[conversationID] {
		if message.ID == req.MessageID {
			if objectDigest(SendMessageRequest{MessageID: message.ID, Algorithm: message.Algorithm, Nonce: message.Nonce, Ciphertext: message.Ciphertext}) != digest {
				return Result[Message]{}, ErrConflict
			}
			return Result[Message]{Record: message, Replayed: true}, nil
		}
	}
	now := s.cfg.Now().UTC()
	cipherHash := sha256.Sum256(ciphertext)
	message := Message{ID: req.MessageID, ConversationID: conversationID, Sender: actor.Account, SenderDeviceID: actor.ID, Algorithm: req.Algorithm, Nonce: req.Nonce, Ciphertext: req.Ciphertext, CiphertextHash: hex.EncodeToString(cipherHash[:]), CreatedAt: now, DeliveredAt: map[string]time.Time{}, ReadAt: map[string]time.Time{}}
	before := cloneState(s.state)
	s.state.Messages[conversationID] = append(s.state.Messages[conversationID], message)
	conversation.UpdatedAt = now
	s.state.Conversations[conversationID] = conversation
	s.appendAuditLocked("message_envelope_stored", "message", message.ID, actor.Account, message.CiphertextHash, now)
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
		if messages[index].DeliveredAt == nil {
			messages[index].DeliveredAt = map[string]time.Time{}
		}
		if messages[index].ReadAt == nil {
			messages[index].ReadAt = map[string]time.Time{}
		}
		messages[index].DeliveredAt[actor.Account] = now
		if state == "read" {
			messages[index].ReadAt[actor.Account] = now
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

func (s *Service) Messages(actor Device, id string) ([]Message, error) {
	if _, err := s.Conversation(actor, id); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Message(nil), s.state.Messages[id]...), nil
}

func (s *Service) Health() Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	for _, messages := range s.state.Messages {
		count += len(messages)
	}
	return Health{OK: true, Service: "ynx-chatd", Persistence: "atomic-json-mode-0600", StateIntegrity: "sha256-and-hash-chained-audit", NativeAddressDefault: true, PlaintextStored: false, DeviceCount: len(s.state.Devices), ConversationCount: len(s.state.Conversations), MessageCount: count, TruthfulStatus: "local-bounded-chat-core-not-remote-deployed"}
}

func (s *Service) hasActiveDeviceLocked(account string) bool {
	for _, device := range s.state.Devices {
		if device.Account == account && device.Status == "active" {
			return true
		}
	}
	return false
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
