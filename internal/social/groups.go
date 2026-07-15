package social

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

const groupMessageAlgorithm = "x25519-hkdf-sha256-xchacha20poly1305"

func (s *Service) CreateGroupConversation(actor Session, title, idempotencyKey string, targets []string) (GroupConversation, bool, error) {
	title = strings.TrimSpace(title)
	if !identifierPattern.MatchString(idempotencyKey) || len(title) < 1 || len(title) > 80 || len(targets) < 2 || len(targets) > 15 {
		return GroupConversation{}, false, ErrInvalid
	}
	members := []string{actor.Account}
	seen := map[string]bool{actor.Account: true}
	for _, target := range targets {
		account, err := nativewallet.NormalizeNativeAddress(target)
		if err != nil || seen[account] {
			return GroupConversation{}, false, ErrInvalid
		}
		seen[account] = true
		members = append(members, account)
	}
	sort.Strings(members)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, member := range members {
		if member != actor.Account && (!s.contactLocked(actor.Account, member) || s.blockedLocked(actor.Account, member)) {
			return GroupConversation{}, false, fmt.Errorf("%w: every group member must be an accepted unblocked contact", ErrUnauthorized)
		}
	}
	activeDevices := 0
	for _, device := range s.state.Devices {
		if device.Status == "active" && contains(members, device.Account) {
			activeDevices++
		}
	}
	if activeDevices < len(members) || activeDevices > 32 {
		return GroupConversation{}, false, fmt.Errorf("%w: every member needs an active device and the group may have at most 32 active devices", ErrConflict)
	}
	document := struct {
		Title   string
		Members []string
	}{title, members}
	digest := objectDigest(document)
	stateKey := idempotencyStateKey(actor.Account, idempotencyKey)
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		if previous.Action != "group_create" || previous.Digest != digest {
			return GroupConversation{}, false, ErrConflict
		}
		return s.state.Groups[previous.ObjectID], true, nil
	}
	now := s.cfg.Now().UTC()
	record := GroupConversation{ID: "group_" + digest[:24], Title: title, Members: members, CreatedBy: actor.Account, CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Groups[record.ID] = record
	s.state.Idempotency[stateKey] = idempotencyRecord{Action: "group_create", Digest: digest, ObjectID: record.ID}
	s.appendAuditLocked("group_created", "conversation", record.ID, actor.Account, digest, now)
	return record, false, s.saveOrRollbackLocked(before)
}

func (s *Service) GroupConversations(actor Session) []GroupConversation {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []GroupConversation{}
	for _, group := range s.state.Groups {
		if contains(group.Members, actor.Account) {
			out = append(out, group)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

func (s *Service) GroupConversation(actor Session, id string) (GroupConversation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.state.Groups[id]
	if !ok {
		return GroupConversation{}, ErrNotFound
	}
	if !contains(record.Members, actor.Account) {
		return GroupConversation{}, ErrUnauthorized
	}
	return record, nil
}

func (s *Service) GroupDevices(actor Session, id string) ([]ProductDevice, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	group, ok := s.state.Groups[id]
	if !ok {
		return nil, ErrNotFound
	}
	if !contains(group.Members, actor.Account) {
		return nil, ErrUnauthorized
	}
	out := []ProductDevice{}
	for _, device := range s.state.Devices {
		if contains(group.Members, device.Account) {
			out = append(out, device)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (s *Service) GroupMessages(actor Session, id string) ([]chat.Message, error) {
	if _, err := s.GroupConversation(actor, id); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]chat.Message(nil), s.state.GroupMessages[id]...), nil
}

func (s *Service) SendGroupMessage(actor Session, id string, in chat.SendMessageRequest) (chat.Result[chat.Message], error) {
	if !identifierPattern.MatchString(in.MessageID) || len(in.Envelopes) < 1 || len(in.Envelopes) > 32 || strings.TrimSpace(in.SenderSignature) == "" {
		return chat.Result[chat.Message]{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	group, ok := s.state.Groups[id]
	if !ok {
		return chat.Result[chat.Message]{}, ErrNotFound
	}
	if !contains(group.Members, actor.Account) {
		return chat.Result[chat.Message]{}, ErrUnauthorized
	}
	senderDevice, ok := s.state.Devices[actor.DeviceID]
	if !ok || senderDevice.Account != actor.Account || senderDevice.Status != "active" {
		return chat.Result[chat.Message]{}, ErrUnauthorized
	}
	expected := map[string]ProductDevice{}
	for _, device := range s.state.Devices {
		if device.Status == "active" && contains(group.Members, device.Account) {
			expected[device.ID] = device
		}
	}
	if len(in.Envelopes) != len(expected) {
		return chat.Result[chat.Message]{}, fmt.Errorf("%w: one envelope is required for every active group device", ErrConflict)
	}
	envelopes := append([]chat.MessageEnvelope(nil), in.Envelopes...)
	seenDevice, seenNonce := map[string]bool{}, map[string]bool{}
	ephemeral, total := "", 0
	for index := range envelopes {
		envelope := &envelopes[index]
		device, ok := expected[envelope.RecipientDeviceID]
		if !ok || seenDevice[device.ID] || envelope.RecipientAccount != device.Account || envelope.Algorithm != groupMessageAlgorithm {
			return chat.Result[chat.Message]{}, ErrInvalid
		}
		key, err := base64.RawStdEncoding.DecodeString(envelope.EphemeralPublicKey)
		if err != nil || len(key) != 32 || (ephemeral != "" && ephemeral != envelope.EphemeralPublicKey) {
			return chat.Result[chat.Message]{}, ErrInvalid
		}
		ephemeral = envelope.EphemeralPublicKey
		nonce, nonceErr := base64.RawStdEncoding.DecodeString(envelope.Nonce)
		ciphertext, ciphertextErr := base64.RawStdEncoding.DecodeString(envelope.Ciphertext)
		if nonceErr != nil || ciphertextErr != nil || len(nonce) != 24 || len(ciphertext) < 16 || seenNonce[envelope.Nonce] {
			return chat.Result[chat.Message]{}, ErrInvalid
		}
		total += len(ciphertext)
		if total > 1024*1024 {
			return chat.Result[chat.Message]{}, ErrInvalid
		}
		digest := sha256.Sum256(ciphertext)
		computed := hex.EncodeToString(digest[:])
		if envelope.CiphertextHash != "" && envelope.CiphertextHash != computed {
			return chat.Result[chat.Message]{}, ErrInvalid
		}
		envelope.CiphertextHash = computed
		seenDevice[device.ID], seenNonce[envelope.Nonce] = true, true
	}
	sort.Slice(envelopes, func(i, j int) bool {
		if envelopes[i].RecipientAccount == envelopes[j].RecipientAccount {
			return envelopes[i].RecipientDeviceID < envelopes[j].RecipientDeviceID
		}
		return envelopes[i].RecipientAccount < envelopes[j].RecipientAccount
	})
	in.Envelopes = envelopes
	for _, existing := range s.state.GroupMessages[id] {
		if existing.ID == in.MessageID {
			if objectDigest(chat.SendMessageRequest{MessageID: existing.ID, Envelopes: existing.Envelopes, SenderSignature: existing.SenderSignature}) != objectDigest(in) {
				return chat.Result[chat.Message]{}, ErrConflict
			}
			return chat.Result[chat.Message]{Record: existing, Replayed: true}, nil
		}
	}
	if !nativewallet.Verify(senderDevice.SigningPublicKey, chat.MessageSignaturePayload(id, actor.Account, actor.DeviceID, in), in.SenderSignature) {
		return chat.Result[chat.Message]{}, ErrUnauthorized
	}
	now := s.cfg.Now().UTC()
	message := chat.Message{ID: in.MessageID, ConversationID: id, Sender: actor.Account, SenderDeviceID: actor.DeviceID, ProtocolVersion: 2, Envelopes: envelopes, SenderSignature: in.SenderSignature, EnvelopeSetHash: objectDigest(envelopes), CreatedAt: now, DeliveredAt: map[string]time.Time{}, ReadAt: map[string]time.Time{}}
	before := cloneState(s.state)
	s.state.GroupMessages[id] = append(s.state.GroupMessages[id], message)
	group.UpdatedAt = now
	s.state.Groups[id] = group
	for _, member := range group.Members {
		if member != actor.Account {
			s.notifyLocked(member, actor.Account, "message_received", message.ID, now)
		}
	}
	s.appendAuditLocked("group_message_envelope_set_stored", "message", message.ID, actor.Account, message.EnvelopeSetHash, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return chat.Result[chat.Message]{}, err
	}
	return chat.Result[chat.Message]{Record: message}, nil
}

func (s *Service) AcknowledgeGroupMessage(actor Session, groupID, messageID, state string) (chat.Message, error) {
	if state != "delivered" && state != "read" {
		return chat.Message{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	group, ok := s.state.Groups[groupID]
	if !ok {
		return chat.Message{}, ErrNotFound
	}
	if !contains(group.Members, actor.Account) {
		return chat.Message{}, ErrUnauthorized
	}
	messages := s.state.GroupMessages[groupID]
	for index := range messages {
		if messages[index].ID != messageID {
			continue
		}
		before := cloneState(s.state)
		now := s.cfg.Now().UTC()
		messages[index].DeliveredAt[actor.DeviceID] = now
		if state == "read" {
			messages[index].ReadAt[actor.DeviceID] = now
		}
		s.state.GroupMessages[groupID] = messages
		if messages[index].Sender != actor.Account {
			s.notifyLocked(messages[index].Sender, actor.Account, "message_"+state, messageID, now)
		}
		s.appendAuditLocked("group_message_"+state, "message", messageID, actor.Account, objectDigest(messages[index]), now)
		return messages[index], s.saveOrRollbackLocked(before)
	}
	return chat.Message{}, ErrNotFound
}
