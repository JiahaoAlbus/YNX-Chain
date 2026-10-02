package social

// RevokeInvite preserves the original receipt while disabling future discovery.
// Only the creator may revoke; a repeated owner action has no additional effect.
func (s *Service) RevokeInvite(actor Session, id string) (Invite, error) {
	if writeUnavailable := s.writeAvailability(); writeUnavailable != nil {
		var unavailableResult0 Invite
		return unavailableResult0, writeUnavailable
	}

	if !identifierPattern.MatchString(id) {
		return Invite{}, ErrInvalid
	}
	s.mu.Lock()
	if writeUnavailable := s.stateWriteError; writeUnavailable != nil {
		s.mu.Unlock()
		var unavailableResult0 Invite
		return unavailableResult0, writeUnavailable
	}

	defer s.mu.Unlock()
	record, exists := s.state.Invites[id]
	if !exists || record.Owner != actor.Account {
		return Invite{}, ErrNotFound
	}
	if record.RevokedAt != nil {
		return record, nil
	}
	now := s.cfg.Now().UTC()
	before := cloneState(s.state)
	record.RevokedAt = &now
	s.state.Invites[id] = record
	s.appendAuditLocked("invite_revoked", "invite", id, actor.Account, objectDigest(record), now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Invite{}, err
	}
	return record, nil
}
