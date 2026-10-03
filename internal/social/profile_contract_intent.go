package social

import (
	"errors"
	"net/url"

	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

const profileContractPrepared = "profile_contract_prepared"
const profileContractCompleted = "profile_contract_completed"
const profileContractRejected = "profile_contract_rejected"

func profileContractDigest(actor Session, req square.SetProfileRequest, avatar string) string {
	return objectDigest(struct {
		Account  string
		DeviceID string
		Request  square.SetProfileRequest
		Avatar   string
	}{actor.Account, actor.DeviceID, req, avatar})
}

// The existing account/idempotency store owns this cross-store intent. It is
// not an ActionProof verifier or a second nonce ledger. A prepared record is
// retained across ambiguous failures and must be settled using the SAME key.
func (s *Service) prepareProfileContract(actor Session, req square.SetProfileRequest, avatar string) error {
	if !identifierPattern.MatchString(req.IdempotencyKey) || len(avatar) > 2048 {
		return ErrInvalid
	}
	if avatar != "" {
		u, err := url.Parse(avatar)
		if err != nil || u.Scheme != "https" || u.Host == "" {
			return ErrInvalid
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stateWriteError != nil {
		return s.stateWriteError
	}
	if err := s.requireCurrentProductActorLocked(actor, "social.profile"); err != nil {
		return err
	}
	key := idempotencyStateKey(actor.Account, req.IdempotencyKey)
	digest := profileContractDigest(actor, req, avatar)
	if existing, found := s.state.Idempotency[key]; found {
		if (existing.Action != profileContractPrepared && existing.Action != profileContractCompleted) || existing.Digest != digest || existing.ObjectID != actor.Account {
			return ErrConflict
		}
		return nil
	}
	for oldKey, old := range s.state.Idempotency {
		if oldKey != key && old.Action == profileContractPrepared && old.ObjectID == actor.Account {
			return ErrConflict
		}
	}
	before := cloneState(s.state)
	s.state.Idempotency[key] = idempotencyRecord{Action: profileContractPrepared, Digest: digest, ObjectID: actor.Account}
	s.appendAuditLocked("profile_contract_prepared", "profile", actor.Account, actor.Account, digest, s.cfg.Now().UTC())
	return s.saveOrRollbackProductActorLocked(before, actor, "social.profile")
}

// Square is the existing in-process local durable domain service, not a
// network reader. Holding the Social mutex here serializes local revoke/device
// changes with its dispatch; no confidential Revalidate is called under it.
func (s *Service) dispatchProfileContract(actor Session, req square.SetProfileRequest, avatar string) (square.Result[square.Profile], error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stateWriteError != nil {
		return square.Result[square.Profile]{}, s.stateWriteError
	}
	if err := s.requireCurrentProductActorLocked(actor, "social.profile"); err != nil {
		return square.Result[square.Profile]{}, err
	}
	record, exists := s.state.Idempotency[idempotencyStateKey(actor.Account, req.IdempotencyKey)]
	if !exists || (record.Action != profileContractPrepared && record.Action != profileContractCompleted) || record.Digest != profileContractDigest(actor, req, avatar) || record.ObjectID != actor.Account {
		return square.Result[square.Profile]{}, ErrConflict
	}
	result, err := s.cfg.Square.SetProfile(square.Device{ID: actor.DeviceID, Account: actor.Account}, req)
	// These exact local domain errors occur before any Square effect. Unknown
	// IO/cancellation outcomes stay prepared; never release their original key.
	if errors.Is(err, square.ErrInvalid) || errors.Is(err, square.ErrConflict) {
		before := cloneState(s.state)
		record.Action = profileContractRejected
		s.state.Idempotency[idempotencyStateKey(actor.Account, req.IdempotencyKey)] = record
		s.appendAuditLocked("profile_contract_rejected", "profile", actor.Account, actor.Account, record.Digest, s.cfg.Now().UTC())
		if saveErr := s.saveOrRollbackProductActorLocked(before, actor, "social.profile"); saveErr != nil {
			return result, saveErr
		}
	}
	return result, err
}

func (s *Service) completeProfileContract(actor Session, req square.SetProfileRequest, avatar string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stateWriteError != nil {
		return s.stateWriteError
	}
	if err := s.requireCurrentProductActorLocked(actor, "social.profile"); err != nil {
		return err
	}
	key := idempotencyStateKey(actor.Account, req.IdempotencyKey)
	record, exists := s.state.Idempotency[key]
	if !exists || (record.Action != profileContractPrepared && record.Action != profileContractCompleted) || record.Digest != profileContractDigest(actor, req, avatar) || record.ObjectID != actor.Account {
		return ErrConflict
	}
	if record.Action == profileContractCompleted {
		return nil
	}
	before := cloneState(s.state)
	record.Action = profileContractCompleted
	s.state.Idempotency[key] = record
	s.appendAuditLocked("profile_contract_completed", "profile", actor.Account, actor.Account, record.Digest, s.cfg.Now().UTC())
	return s.saveOrRollbackProductActorLocked(before, actor, "social.profile")
}

// Merge only fields owned by the profile operation. Never copy a privacy
// snapshot captured before the Square effect over a newer Settings transaction.
func (s *Service) setProfileContractAvatar(actor Session, originalKey, avatar string) error {
	if err := s.requireCurrentProductActor(actor, "social.profile"); err != nil {
		return err
	}
	id, err := s.publicIdentity(actor.Account)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stateWriteError != nil {
		return s.stateWriteError
	}
	if err := s.requireCurrentProductActorLocked(actor, "social.profile"); err != nil {
		return err
	}
	key := idempotencyStateKey(actor.Account, "profile-avatar-"+objectDigest(originalKey)[:32])
	digest := objectDigest(struct {
		OriginalKey string
		Avatar      string
	}{originalKey, avatar})
	if previous, exists := s.state.Idempotency[key]; exists {
		if previous.Action != "profile_avatar" || previous.Digest != digest || previous.ObjectID != actor.Account {
			return ErrConflict
		}
		return nil
	}
	current, exists := s.state.Settings[actor.Account]
	if !exists {
		current = ProfileSettings{Account: actor.Account, DiscoverableByHandle: true, AllowRecommendations: true, AllowRequestsFrom: "everyone"}
	}
	current.AvatarURL = avatar
	current.ProfileQRPayload = socialLocatorPrefix + id
	current.UpdatedAt = s.cfg.Now().UTC()
	before := cloneState(s.state)
	s.state.Settings[actor.Account] = current
	s.state.Idempotency[key] = idempotencyRecord{Action: "profile_avatar", Digest: digest, ObjectID: actor.Account}
	s.appendAuditLocked("profile_avatar_updated", "settings", actor.Account, actor.Account, digest, current.UpdatedAt)
	return s.saveOrRollbackProductActorLocked(before, actor, "social.profile")
}
