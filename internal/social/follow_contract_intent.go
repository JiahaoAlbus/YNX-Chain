package social

import (
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

const followContractPrepared = "follow_contract_prepared"
const followContractCompleted = "follow_contract_completed"
const followContractRejected = "follow_contract_rejected"

func followContractDigest(actor Session, req square.SetFollowRequest) string {
	return objectDigest(struct {
		Account  string
		DeviceID string
		Request  square.SetFollowRequest
	}{actor.Account, actor.DeviceID, req})
}

func (s *Service) followContractGuardLocked(actor Session, req square.SetFollowRequest) error {
	if s.stateWriteError != nil {
		return s.stateWriteError
	}
	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		return err
	}
	if req.Account == actor.Account || s.blockedLocked(actor.Account, req.Account) {
		return ErrUnauthorized
	}
	return nil
}

func (s *Service) prepareFollowContract(actor Session, req square.SetFollowRequest) error {
	target, err := nativewallet.NormalizeNativeAddress(req.Account)
	if err != nil || target != req.Account || !identifierPattern.MatchString(req.IdempotencyKey) {
		return ErrInvalid
	}
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return err
	}
	defer s.mu.Unlock()
	if err := s.followContractGuardLocked(actor, req); err != nil {
		return err
	}
	key := idempotencyStateKey(actor.Account, req.IdempotencyKey)
	digest := followContractDigest(actor, req)
	if previous, exists := s.state.Idempotency[key]; exists {
		if (previous.Action != followContractPrepared && previous.Action != followContractCompleted) || previous.Digest != digest || previous.ObjectID != req.Account {
			return ErrConflict
		}
		return nil
	}
	for oldKey, previous := range s.state.Idempotency {
		if oldKey != key && previous.Action == followContractPrepared && previous.ObjectID == req.Account && len(oldKey) > len(actor.Account) && oldKey[:len(actor.Account)+1] == actor.Account+"|" {
			return ErrConflict
		}
	}
	before := cloneState(s.state)
	s.state.Idempotency[key] = idempotencyRecord{Action: followContractPrepared, Digest: digest, ObjectID: req.Account}
	s.appendAuditLocked("follow_contract_prepared", "profile", req.Account, actor.Account, digest, s.cfg.Now().UTC())
	return s.saveOrRollbackProductActorLocked(before, actor, "social.feed")
}

// Only the local in-process Square domain effect runs under this mutex.
// Never invoke a network authority/revalidation reader while holding it.
func (s *Service) dispatchFollowContract(actor Session, req square.SetFollowRequest) (square.Result[square.Follow], error) {
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return square.Result[square.Follow]{}, err
	}
	defer s.mu.Unlock()
	if err := s.followContractGuardLocked(actor, req); err != nil {
		return square.Result[square.Follow]{}, err
	}
	key := idempotencyStateKey(actor.Account, req.IdempotencyKey)
	record, exists := s.state.Idempotency[key]
	if !exists || (record.Action != followContractPrepared && record.Action != followContractCompleted) || record.Digest != followContractDigest(actor, req) || record.ObjectID != req.Account {
		return square.Result[square.Follow]{}, ErrConflict
	}
	result, err := s.cfg.Square.SetFollow(square.Device{ID: actor.DeviceID, Account: actor.Account}, req)
	if errors.Is(err, square.ErrInvalid) || errors.Is(err, square.ErrConflict) {
		before := cloneState(s.state)
		record.Action = followContractRejected
		s.state.Idempotency[key] = record
		s.appendAuditLocked("follow_contract_rejected", "profile", req.Account, actor.Account, record.Digest, s.cfg.Now().UTC())
		if saveErr := s.saveOrRollbackProductActorLocked(before, actor, "social.feed"); saveErr != nil {
			return result, saveErr
		}
	}
	return result, err
}

func (s *Service) completeFollowContract(actor Session, req square.SetFollowRequest) error {
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return err
	}
	defer s.mu.Unlock()
	if err := s.followContractGuardLocked(actor, req); err != nil {
		return err
	}
	key := idempotencyStateKey(actor.Account, req.IdempotencyKey)
	record, exists := s.state.Idempotency[key]
	if !exists || (record.Action != followContractPrepared && record.Action != followContractCompleted) || record.Digest != followContractDigest(actor, req) || record.ObjectID != req.Account {
		return ErrConflict
	}
	if record.Action == followContractCompleted {
		return nil
	}
	before := cloneState(s.state)
	record.Action = followContractCompleted
	s.state.Idempotency[key] = record
	// Square already owns the actual follow notification. Do not duplicate it
	// in Social, including after a cold same-key retry of an uncertain effect.
	s.appendAuditLocked("follow_contract_completed", "profile", req.Account, actor.Account, record.Digest, s.cfg.Now().UTC())
	return s.saveOrRollbackProductActorLocked(before, actor, "social.feed")
}
