package chat

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
)

type AccountExport struct {
	Account       string           `json:"account"`
	Devices       []Device         `json:"devices"`
	Conversations []Conversation   `json:"conversations"`
	Messages      []Message        `json:"messages"`
	Rotations     []DeviceRotation `json:"rotations"`
	Audit         []AuditEvent     `json:"audit"`
}

func (s *Service) ExportAccount(actor Device) AccountExport {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := AccountExport{
		Account:       actor.Account,
		Devices:       []Device{},
		Conversations: []Conversation{},
		Messages:      []Message{},
		Rotations:     []DeviceRotation{},
		Audit:         []AuditEvent{},
	}
	for _, device := range s.state.Devices {
		if device.Account == actor.Account {
			out.Devices = append(out.Devices, device)
		}
	}
	for _, conversation := range s.state.Conversations {
		if memberOf(conversation.Members, actor.Account) {
			out.Conversations = append(out.Conversations, conversation)
			out.Messages = append(out.Messages, s.state.Messages[conversation.ID]...)
		}
	}
	for _, rotation := range s.state.Rotations {
		if rotation.Account == actor.Account {
			out.Rotations = append(out.Rotations, rotation)
		}
	}
	for _, event := range s.state.Audit {
		if event.Account == actor.Account {
			out.Audit = append(out.Audit, event)
		}
	}
	sort.Slice(out.Devices, func(i, j int) bool { return out.Devices[i].ID < out.Devices[j].ID })
	sort.Slice(out.Conversations, func(i, j int) bool { return out.Conversations[i].ID < out.Conversations[j].ID })
	sort.Slice(out.Messages, func(i, j int) bool { return out.Messages[i].ID < out.Messages[j].ID })
	sort.Slice(out.Rotations, func(i, j int) bool { return out.Rotations[i].ID < out.Rotations[j].ID })
	return out
}

func (s *Service) DeleteAccount(actor Device) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	before := cloneState(s.state)
	deletedObjects := map[string]bool{}
	pseudonym := privacyPseudonym(actor.Account)

	for id, device := range s.state.Devices {
		if device.Account == actor.Account {
			delete(s.state.Devices, id)
			deletedObjects[id] = true
		}
	}
	for id, rotation := range s.state.Rotations {
		if rotation.Account == actor.Account {
			delete(s.state.Rotations, id)
			deletedObjects[id] = true
		}
	}
	for id, conversation := range s.state.Conversations {
		if !memberOf(conversation.Members, actor.Account) {
			continue
		}
		members := conversation.Members[:0]
		for _, member := range conversation.Members {
			if member != actor.Account {
				members = append(members, member)
			}
		}
		if len(members) < 2 {
			delete(s.state.Conversations, id)
			for _, message := range s.state.Messages[id] {
				deletedObjects[message.ID] = true
			}
			delete(s.state.Messages, id)
			deletedObjects[id] = true
			continue
		}
		conversation.Members = append([]string(nil), members...)
		conversation.UpdatedAt = s.cfg.Now().UTC()
		s.state.Conversations[id] = conversation
		kept := s.state.Messages[id][:0]
		for _, message := range s.state.Messages[id] {
			if message.Sender == actor.Account {
				deletedObjects[message.ID] = true
				continue
			}
			envelopes := message.Envelopes[:0]
			for _, envelope := range message.Envelopes {
				if envelope.RecipientAccount != actor.Account {
					envelopes = append(envelopes, envelope)
				}
			}
			message.Envelopes = append([]MessageEnvelope(nil), envelopes...)
			delete(message.DeliveredAt, actor.Account)
			delete(message.ReadAt, actor.Account)
			if len(message.Envelopes) == 0 {
				deletedObjects[message.ID] = true
				continue
			}
			kept = append(kept, message)
		}
		s.state.Messages[id] = append([]Message(nil), kept...)
	}
	for key, record := range s.state.Idempotency {
		if deletedObjects[record.ObjectID] {
			delete(s.state.Idempotency, key)
		}
	}
	now := s.cfg.Now().UTC()
	s.appendAuditLocked("account_erased", "account", pseudonym, pseudonym, objectDigest(pseudonym), now)
	return s.saveOrRollbackLocked(before)
}

func memberOf(members []string, account string) bool {
	for _, member := range members {
		if member == account {
			return true
		}
	}
	return false
}

func privacyPseudonym(account string) string {
	digest := sha256.Sum256([]byte("ynx-chat-erasure-v1\n" + account))
	return "erased:" + hex.EncodeToString(digest[:8])
}
