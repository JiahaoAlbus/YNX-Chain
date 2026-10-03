package social

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"sort"
	"strings"
	"time"
)

// TokenHash is deliberately absent from public/persisted Invite JSON. Restore
// only from the SAME canonical capability covered by the state integrity MAC.
// This never reissues a token or silently retargets a legacy/corrupt record.
func originalInvitationToken(record Invite) (string, string, bool) {
	const prefix = "https://social.ynxweb4.com/invite/"
	if !strings.HasPrefix(record.Link, prefix) {
		return "", "", false
	}
	token := strings.TrimPrefix(record.Link, prefix)
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	hash := sha256.Sum256([]byte(token))
	digest := hex.EncodeToString(hash[:])
	if err != nil || len(decoded) != 24 || base64.RawURLEncoding.EncodeToString(decoded) != token || record.ID != "invite_"+hex.EncodeToString(hash[:12]) || record.TokenHash != "" && record.TokenHash != digest {
		return "", "", false
	}
	return token, digest, true
}

// Invitation capabilities remain server-owned. An original request key settles
// an uncertain POST without creating another token, extending expiry or grant.
func (s *Service) CreateInviteIntent(actor Session, ttl time.Duration, key string) (Invite, string, error) {
	if !identifierPattern.MatchString(key) {
		return Invite{}, "", ErrInvalid
	}
	return s.createInvite(actor, ttl, key)
}

func (s *Service) createInvite(actor Session, ttl time.Duration, key string) (Invite, string, error) {
	if err := s.writeAvailability(); err != nil {
		return Invite{}, "", err
	}
	if ttl < time.Minute || ttl > 7*24*time.Hour {
		return Invite{}, "", ErrInvalid
	}
	digest := objectDigest(struct{ TTL int64 }{int64(ttl)})
	if err := s.lockAfterProductRevalidation(actor, "social.contacts"); err != nil {
		return Invite{}, "", err
	}
	defer s.mu.Unlock()
	if s.stateWriteError != nil {
		return Invite{}, "", s.stateWriteError
	}
	if err := s.requireCurrentProductActorLocked(actor, "social.contacts"); err != nil {
		return Invite{}, "", err
	}
	stateKey := idempotencyStateKey(actor.Account, key)
	if key != "" {
		if previous, exists := s.state.Idempotency[stateKey]; exists {
			if previous.Action != "invite_create" || previous.Digest != digest {
				return Invite{}, "", ErrConflict
			}
			record, exists := s.state.Invites[previous.ObjectID]
			if !exists || record.Owner != actor.Account {
				return Invite{}, "", ErrConflict
			}
			token, _, valid := originalInvitationToken(record)
			if !valid {
				return Invite{}, "", ErrConflict
			}
			return record, token, nil
		}
	}
	token := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	hash := sha256.Sum256([]byte(token))
	now := s.cfg.Now().UTC()
	id := "invite_" + hex.EncodeToString(hash[:12])
	if _, exists := s.state.Invites[id]; exists {
		return Invite{}, "", ErrConflict
	}
	record := Invite{ID: id, Owner: actor.Account, TokenHash: hex.EncodeToString(hash[:]), Link: "https://social.ynxweb4.com/invite/" + token, ExpiresAt: now.Add(ttl), CreatedAt: now}
	before := cloneState(s.state)
	s.state.Invites[id] = record
	if key != "" {
		s.state.Idempotency[stateKey] = idempotencyRecord{Action: "invite_create", Digest: digest, ObjectID: id}
	}
	s.appendAuditLocked("invite_created", "invite", id, actor.Account, objectDigest(record), now)
	if err := s.saveOrRollbackProductActorLocked(before, actor, "social.contacts"); err != nil {
		return Invite{}, "", err
	}
	return record, token, nil
}

type InvitationView struct {
	ID        string     `json:"id"`
	Link      string     `json:"link"`
	Status    string     `json:"status"`
	ExpiresAt time.Time  `json:"expiresAt"`
	CreatedAt time.Time  `json:"createdAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
}
type InviteOperationView struct {
	Confirmed bool   `json:"confirmed"`
	ID        string `json:"id,omitempty"`
}
type InvitationSnapshot struct {
	Invitations []InvitationView     `json:"invitations"`
	Operation   *InviteOperationView `json:"operation,omitempty"`
}

func (s *Service) ReadInvitations(actor Session, key string) (InvitationSnapshot, error) {
	if key != "" && !identifierPattern.MatchString(key) {
		return InvitationSnapshot{}, ErrInvalid
	}
	if err := s.lockAfterProductRevalidation(actor, "social.contacts"); err != nil {
		return InvitationSnapshot{}, err
	}
	defer s.mu.Unlock()
	if err := s.requireCurrentProductActorLocked(actor, "social.contacts"); err != nil {
		return InvitationSnapshot{}, err
	}
	result := InvitationSnapshot{Invitations: make([]InvitationView, 0)}
	now := s.cfg.Now().UTC()
	for _, record := range s.state.Invites {
		if record.Owner != actor.Account {
			continue
		}
		status := "active"
		var revoked *time.Time
		if record.RevokedAt != nil {
			status = "revoked"
			copy := *record.RevokedAt
			revoked = &copy
		} else if !record.ExpiresAt.After(now) {
			status = "expired"
		}
		result.Invitations = append(result.Invitations, InvitationView{record.ID, record.Link, status, record.ExpiresAt, record.CreatedAt, revoked})
	}
	sort.Slice(result.Invitations, func(i, j int) bool {
		if result.Invitations[i].CreatedAt.Equal(result.Invitations[j].CreatedAt) {
			return result.Invitations[i].ID < result.Invitations[j].ID
		}
		return result.Invitations[i].CreatedAt.After(result.Invitations[j].CreatedAt)
	})
	if key != "" {
		result.Operation = &InviteOperationView{}
		if operation, exists := s.state.Idempotency[idempotencyStateKey(actor.Account, key)]; exists {
			if operation.Action != "invite_create" {
				return InvitationSnapshot{}, ErrConflict
			}
			record, exists := s.state.Invites[operation.ObjectID]
			if !exists || record.Owner != actor.Account {
				return InvitationSnapshot{}, ErrConflict
			}
			result.Operation = &InviteOperationView{Confirmed: true, ID: record.ID}
		}
	}
	return result, nil
}
