package video

import (
	"context"
	"encoding/json"
	"errors"
	"os"
)

// OriginalCreatorMembershipView contains copied ORIGINAL Channel/AuthVersion
// and team records. It creates neither enrollment nor private generation.
// Prepare under the original writer transaction after durable commit, then
// publish the immutable value through that same authority gate. Never call the
// copying method from a coordinator source callback: it takes the Store lock.
type OriginalCreatorMembershipView struct {
	channels map[string]originalCreatorChannel
}
type originalCreatorChannel struct {
	owner   string
	version uint64
	members map[string]CreatorRole
}

func (v OriginalCreatorMembershipView) Lookup(channel, actor string) (CreatorRole, uint64, bool) {
	c, ok := v.channels[channel]
	if !ok || actor == "" {
		return "", 0, false
	}
	if actor == c.owner {
		return CreatorRoleOwner, c.version, true
	}
	role, ok := c.members[actor]
	return role, c.version, ok
}

// Matching bytes and integrity are local readback, not proof of prior fsync
// success, authority provenance, approval or finality. A prior unconfirmed
// commit error remains authoritative even if this readback succeeds.
func (s *Store) originalConfirmedFileStateLocked(ctx context.Context) (State, error) {
	if ctx == nil || ctx.Err() != nil {
		return State{}, ErrVideoTransactionUnavailable
	}
	raw, err := os.ReadFile(s.statePath)
	if err != nil {
		return State{}, err
	}
	var disk State
	if err = json.Unmarshal(raw, &disk); err != nil {
		return State{}, err
	}
	verifier := &Store{videoStateStore: &videoStateStore{state: disk, integrityKey: s.integrityKey}}
	if err = verifier.verifyIntegrity(); err != nil {
		return State{}, err
	}
	a, err := json.Marshal(s.state)
	if err != nil {
		return State{}, err
	}
	b, err := json.Marshal(disk)
	if err != nil {
		return State{}, err
	}
	if string(a) != string(b) {
		return State{}, ErrVideoStatePublicationUnconfirmed
	}
	if ctx.Err() != nil {
		return State{}, ctx.Err()
	}
	return disk, nil
}
func (s *Store) CopyOriginalCreatorMembership(ctx context.Context) (OriginalCreatorMembershipView, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	disk, err := s.originalConfirmedFileStateLocked(ctx)
	if err != nil {
		return OriginalCreatorMembershipView{}, err
	}
	view := OriginalCreatorMembershipView{channels: map[string]originalCreatorChannel{}}
	for id, channel := range disk.Channels {
		if channel == nil {
			continue
		}
		members := map[string]CreatorRole{}
		for _, member := range disk.TeamMembers {
			if member != nil && member.ChannelID == id && member.State == "active" && member.RevokedAt == nil {
				members[member.Account] = member.Role
			}
		}
		view.channels[id] = originalCreatorChannel{owner: channel.Owner, version: channel.AuthVersion, members: members}
	}
	return view, nil
}

// This trusted internal readback is not an HTTP authorization API. It only
// confirms an original nonce already stored with the original durable effect.
func (s *Store) ReadOriginalBusinessNonce(ctx context.Context, binding, nonce string) (VideoBusinessNonce, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	disk, err := s.originalConfirmedFileStateLocked(ctx)
	if err != nil {
		return VideoBusinessNonce{}, err
	}
	record, ok := disk.BusinessNonces[videoBusinessNonceKey(binding, nonce)]
	if !ok || record.SessionBinding != binding || record.Nonce != nonce {
		return VideoBusinessNonce{}, errors.New("original Video nonce not found")
	}
	return record, nil
}

// Protected bootstrap uses the original Service/Store instance, never reopens
// a second writer. These methods add no HTTP or renderer authority.
func (s *Service) CopyOriginalCreatorMembership(ctx context.Context) (OriginalCreatorMembershipView, error) {
	return s.store.CopyOriginalCreatorMembership(ctx)
}
func (s *Service) ReadOriginalBusinessNonce(ctx context.Context, binding, nonce string) (VideoBusinessNonce, error) {
	return s.store.ReadOriginalBusinessNonce(ctx, binding, nonce)
}
