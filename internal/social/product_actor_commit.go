package social

import "strings"

// Called under the existing Social transaction mutex, before both effects and
// idempotent receipts. This is local state validation, never a network reader.
// Legacy domain callers retain their existing authorization contract; an HTTP
// Product Session actor always has the server-generated psv2_ identifier.
func (s *Service) requireCurrentProductActorLocked(actor Session, scope string) error {
	if actor.requestContext != nil && actor.requestContext.Err() != nil {
		return actor.requestContext.Err()
	}
	if !strings.HasPrefix(actor.ID, "psv2_") {
		return nil
	}
	_, current, exists := s.sessionByIDLocked(actor.ID)
	now := s.cfg.Now().UTC()
	if !exists || current.RevokedAt != nil || !current.ExpiresAt.After(now) || !contains(current.Scopes, scope) || objectDigest(current) != objectDigest(actor) {
		return ErrUnauthorized
	}
	device, exists := s.state.Devices[current.DeviceID]
	if !exists || device.ID != current.DeviceID || device.Account != current.Account || device.Status != "active" {
		return ErrUnauthorized
	}
	matches := 0
	for _, binding := range s.state.ProductBindings {
		if binding.SessionID != current.ID {
			continue
		}
		matches++
		if binding.Account != current.Account || binding.ChatDeviceID != current.DeviceID || !binding.ExpiresAt.After(now) || (binding.ChatSigningKey != "" && binding.ChatSigningKey != device.SigningPublicKey) || (binding.ChatEncryptionKey != "" && binding.ChatEncryptionKey != device.EncryptionPublicKey) {
			return ErrUnauthorized
		}
	}
	if matches != 1 {
		return ErrUnauthorized
	}
	return nil
}

func (s *Service) requireCurrentProductActor(actor Session, scope string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.requireCurrentProductActorLocked(actor, scope)
}

// Recheck at persistence after preparing the effect under the same mutex.
// On cancellation/expiry restore the original transaction, including receipts
// and audit entries; never publish a partial in-memory effect or new nonce store.
func (s *Service) saveOrRollbackProductActorLocked(before persistentState, actor Session, scope string) error {
	if err := s.requireCurrentProductActorLocked(actor, scope); err != nil {
		s.state = before
		return err
	}
	if actor.requestContext != nil && actor.requestContext.Err() != nil {
		s.state = before
		return actor.requestContext.Err()
	}
	return s.saveOrRollbackLocked(before)
}
