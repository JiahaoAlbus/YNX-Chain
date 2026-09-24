package finance

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"time"
)

var brokerHandoffToken = regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`)
var brokerHandoffHex = regexp.MustCompile(`^[0-9a-f]{64}$`)

func brokerHandoffSessionHash(binding string) (string, error) {
	if binding == "" || len(binding) > 512 {
		return "", errors.New("confidential handoff Product Session binding is invalid")
	}
	digest := sha256.Sum256([]byte(binding))
	return hex.EncodeToString(digest[:]), nil
}

func compactBrokerHandoffProof(raw json.RawMessage) ([]byte, error) {
	if len(raw) == 0 || len(raw) > 32<<10 {
		return nil, errors.New("confidential decision proof size is invalid")
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return nil, errors.New("confidential decision proof JSON is invalid")
	}
	return compact.Bytes(), nil
}

func validateBrokerOrderHandoff(all persistedState, key string, record BrokerOrderHandoffRecord) error {
	if !brokerHandoffHex.MatchString(key) || record.TicketHash != key || record.Account == "" || !evmSubjectRequestID.MatchString(record.RequestID) ||
		!record.ExpiresAt.After(record.IssuedAt) || record.ExpiresAt.Sub(record.IssuedAt) > 5*time.Minute || len(record.ClaimNonces) > 5 {
		return errors.New("confidential handoff identity or lifetime is invalid")
	}
	account, ok := all.Accounts[record.Account]
	if !ok {
		return errors.New("confidential handoff owner is absent")
	}
	challenge, ok := account.Brokerage.Challenges[record.RequestID]
	issuedAt, issuedErr := parseFinanceMilliseconds(challenge.Unsigned.IssuedAt)
	if !ok || challenge.Unsigned.Account != record.Account || challenge.Unsigned.RequestID != record.RequestID ||
		issuedErr != nil || record.IssuedAt.Before(issuedAt) || evmReadTime(record.ExpiresAt) != challenge.Unsigned.ExpiresAt {
		return errors.New("confidential handoff challenge differs from durable owner")
	}
	switch record.CallbackStateBinding {
	case "sha256-v2":
		// Preserve pre-binding durable rows on restart without granting them a
		// claim or exchange path. New issuance always writes a valid hash.
		if (record.SessionBindingHash != "" && !brokerHandoffHex.MatchString(record.SessionBindingHash)) || !brokerHandoffToken.MatchString(record.CallbackState) {
			return errors.New("confidential handoff state token is invalid")
		}
		digest := sha256.Sum256([]byte(record.CallbackState))
		if hex.EncodeToString(digest[:]) != challenge.Unsigned.CallbackStateHash {
			return errors.New("confidential handoff state digest differs from challenge")
		}
	case "raw-v1-random32":
		if record.SessionBindingHash != "" || !brokerHandoffHex.MatchString(record.CallbackState) || record.CallbackState != challenge.Unsigned.CallbackStateHash {
			return errors.New("legacy handoff state differs from original random v1 value")
		}
	default:
		return errors.New("confidential handoff state binding is invalid")
	}
	for nonce, expires := range record.ClaimNonces {
		if !brokerHandoffToken.MatchString(nonce) || expires.IsZero() || expires.After(record.ExpiresAt) {
			return errors.New("confidential handoff claim nonce is invalid")
		}
	}
	if record.DecisionStatus == "" {
		if len(record.DecisionProof) != 0 || record.DecisionProofHash != "" || record.CodeHash != "" || !record.CodeExpiresAt.IsZero() || record.CodeConsumedAt != nil {
			return errors.New("undecided handoff has a decision or code")
		}
		return nil
	}
	if record.DecisionStatus != "approved" && record.DecisionStatus != "rejected" && record.DecisionStatus != "revoked" {
		return errors.New("confidential handoff decision is invalid")
	}
	compactProof, compactErr := compactBrokerHandoffProof(record.DecisionProof)
	proofHash := sha256.Sum256(compactProof)
	if compactErr != nil || !brokerHandoffHex.MatchString(record.DecisionProofHash) ||
		hex.EncodeToString(proofHash[:]) != record.DecisionProofHash || !brokerHandoffHex.MatchString(record.CodeHash) ||
		!record.CodeExpiresAt.After(record.IssuedAt) || record.CodeExpiresAt.After(record.ExpiresAt) ||
		(record.CodeConsumedAt != nil && (record.CodeConsumedAt.Before(record.IssuedAt) || record.CodeConsumedAt.After(record.ExpiresAt))) {
		return errors.New("confidential handoff proof or code is invalid")
	}
	return nil
}

// ClaimBrokerOrderHandoff runs only after the Wallet/Auth root verifier has
// validated the signed claim for this exact ticket, account and nonce. The
// repository CAS prevents replay across instances and returns no native or
// Broker execution capability.
func (s *Store) ClaimBrokerOrderHandoff(account, ticketHash, nonce string, now time.Time) (FinanceOrderApprovalUnsignedV1, error) {
	if !brokerHandoffHex.MatchString(ticketHash) || !brokerHandoffToken.MatchString(nonce) {
		return FinanceOrderApprovalUnsignedV1{}, errors.New("confidential claim identity is invalid")
	}
	var unsigned FinanceOrderApprovalUnsignedV1
	var err error
	for attempt := 0; attempt < brokerCASAttempts; attempt++ {
		err = s.updateAllState(account, "broker.handoff.claimed", ticketHash, func(all *persistedState) error {
			record, ok := all.BrokerOrderHandoffs[ticketHash]
			if !ok || record.Account != account || (record.CallbackStateBinding == "sha256-v2" && record.SessionBindingHash == "") || !record.ExpiresAt.After(now.UTC()) || record.DecisionStatus != "" ||
				len(record.ClaimNonces) >= 5 {
				return errors.New("confidential ticket is absent, expired or already decided")
			}
			owner := all.Accounts[account]
			challenge, ok := owner.Brokerage.Challenges[record.RequestID]
			mapping := owner.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
			if !ok || challenge.ApprovalState != "pending" || mapping.Status != "active" || mapping.Account != account ||
				mapping.WalletPublicKey != challenge.Unsigned.AccountPublicKey || mapping.SubjectID != challenge.Unsigned.SubjectID ||
				mapping.BrokerAccountID != challenge.Unsigned.BrokerAccountID {
				return errors.New("confidential ticket no longer has an active owner")
			}
			if record.ClaimNonces == nil {
				record.ClaimNonces = map[string]time.Time{}
			}
			if _, replay := record.ClaimNonces[nonce]; replay {
				return errors.New("confidential claim nonce was already used")
			}
			record.ClaimNonces[nonce] = record.ExpiresAt
			all.BrokerOrderHandoffs[ticketHash] = record
			unsigned = challenge.Unsigned
			return nil
		})
		if !errors.Is(err, errFinanceStateConflict) {
			break
		}
	}
	return unsigned, err
}

// BrokerOrderHandoffAuthoritySnapshot is internal-only. Neither the handoff
// record nor callback state is serialized into the user-facing AccountState.
func (s *Store) BrokerOrderHandoffAuthoritySnapshot(ticketHash string) (BrokerOrderHandoffRecord, FinanceOrderApprovalUnsignedV1, error) {
	if !brokerHandoffHex.MatchString(ticketHash) {
		return BrokerOrderHandoffRecord{}, FinanceOrderApprovalUnsignedV1{}, errors.New("confidential ticket hash is invalid")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return BrokerOrderHandoffRecord{}, FinanceOrderApprovalUnsignedV1{}, err
	}
	record, ok := s.state.BrokerOrderHandoffs[ticketHash]
	if !ok || validateBrokerOrderHandoff(s.state, ticketHash, record) != nil {
		return BrokerOrderHandoffRecord{}, FinanceOrderApprovalUnsignedV1{}, errors.New("confidential ticket is unavailable")
	}
	challenge := s.state.Accounts[record.Account].Brokerage.Challenges[record.RequestID]
	record.ClaimNonces = cloneEVMProofNonces(record.ClaimNonces)
	record.DecisionProof = append(json.RawMessage(nil), record.DecisionProof...)
	return record, challenge.Unsigned, nil
}

// An opaque challenge must never be consumed through the legacy callback.
// Issue persists the challenge and handoff in one CAS, and handoffs are never
// removed, so this read remains an effective fence across store instances.
func (s *Store) isOpaqueBrokerOrderRequest(account, requestID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return false, err
	}
	for _, record := range s.state.BrokerOrderHandoffs {
		if record.Account == account && record.RequestID == requestID {
			return true, nil
		}
	}
	return false, nil
}

func (s *Store) opaqueBrokerOrderCallbackAuthority(account, codeHash, sessionBinding string) (BrokerOrderHandoffRecord, FinanceOrderApprovalUnsignedV1, error) {
	sessionHash, err := brokerHandoffSessionHash(sessionBinding)
	if err != nil {
		return BrokerOrderHandoffRecord{}, FinanceOrderApprovalUnsignedV1{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return BrokerOrderHandoffRecord{}, FinanceOrderApprovalUnsignedV1{}, err
	}
	var found BrokerOrderHandoffRecord
	for key, record := range s.state.BrokerOrderHandoffs {
		if record.Account == account && record.CodeHash == codeHash &&
			(record.CallbackStateBinding == "raw-v1-random32" || record.SessionBindingHash == sessionHash) {
			if found.RequestID != "" || validateBrokerOrderHandoff(s.state, key, record) != nil {
				return BrokerOrderHandoffRecord{}, FinanceOrderApprovalUnsignedV1{}, errors.New("confidential callback owner is ambiguous or invalid")
			}
			found = record
		}
	}
	if found.RequestID == "" {
		return BrokerOrderHandoffRecord{}, FinanceOrderApprovalUnsignedV1{}, errors.New("confidential callback is absent")
	}
	challenge := s.state.Accounts[account].Brokerage.Challenges[found.RequestID]
	return found, challenge.Unsigned, nil
}

func (s *Store) legacyBrokerOrderRecoveryChallenge(account, requestID string) (FinanceOrderApprovalUnsignedV1, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return FinanceOrderApprovalUnsignedV1{}, err
	}
	owner, ok := s.state.Accounts[account]
	if !ok {
		return FinanceOrderApprovalUnsignedV1{}, errors.New("legacy order owner is absent")
	}
	challenge, ok := owner.Brokerage.Challenges[requestID]
	if !ok || challenge.Unsigned.Account != account || challenge.ApprovalState != "pending" {
		return FinanceOrderApprovalUnsignedV1{}, errors.New("legacy order is not pending")
	}
	for _, handoff := range s.state.BrokerOrderHandoffs {
		if handoff.Account == account && handoff.RequestID == requestID {
			return FinanceOrderApprovalUnsignedV1{}, errors.New("legacy order was already recovered")
		}
	}
	return challenge.Unsigned, nil
}

// A legacy ticket is minted only after Wallet/Auth has verified a fresh
// owner-key recovery signature against this durable pre-cutover challenge.
// The original random32 callback hash is the exact legacy callback state;
// it is never reinterpreted as a SHA256 preimage.
func (s *Store) RecoverLegacyBrokerOrderHandoff(account, requestID, ticketHash string, expected FinanceOrderApprovalUnsignedV1, now, cutoverAt time.Time) error {
	if !evmSubjectRequestID.MatchString(requestID) || !brokerHandoffHex.MatchString(ticketHash) || cutoverAt.IsZero() {
		return errors.New("legacy recovery identity or cutover is invalid")
	}
	var err error
	for attempt := 0; attempt < brokerCASAttempts; attempt++ {
		err = s.updateAllState(account, "broker.handoff.legacy_recovered", requestID, func(all *persistedState) error {
			if _, exists := all.BrokerOrderHandoffs[ticketHash]; exists {
				return errors.New("legacy recovery ticket already exists")
			}
			for _, handoff := range all.BrokerOrderHandoffs {
				if handoff.Account == account && handoff.RequestID == requestID {
					return errors.New("legacy challenge already has a ticket")
				}
			}
			owner, ok := all.Accounts[account]
			if !ok {
				return errors.New("legacy recovery owner is absent")
			}
			challenge, ok := owner.Brokerage.Challenges[requestID]
			mapping := owner.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
			if !ok || challenge.ApprovalState != "pending" || challenge.Unsigned.Account != account ||
				string(mustFinanceCanonical(challenge.Unsigned)) != string(mustFinanceCanonical(expected)) ||
				mapping.Status != "active" || mapping.Account != account || mapping.WalletPublicKey != challenge.Unsigned.AccountPublicKey ||
				mapping.SubjectID != challenge.Unsigned.SubjectID || mapping.BrokerAccountID != challenge.Unsigned.BrokerAccountID {
				return errors.New("legacy challenge changed or mapping is inactive")
			}
			issued, issueErr := parseFinanceMilliseconds(challenge.Unsigned.IssuedAt)
			expires, expireErr := parseFinanceMilliseconds(challenge.Unsigned.ExpiresAt)
			if issueErr != nil || expireErr != nil || !issued.Before(cutoverAt.UTC()) || !expires.After(now.UTC()) ||
				issued.After(now.UTC()) || !brokerHandoffHex.MatchString(challenge.Unsigned.CallbackStateHash) {
				return errors.New("legacy challenge is not active before cutover")
			}
			order, exists := owner.Brokerage.Orders[challenge.Unsigned.Order.OrderID]
			if !exists || order.RequestID != requestID || order.ApprovalState != "pending" {
				return errors.New("legacy order no longer matches the challenge")
			}
			if _, queued := owner.Brokerage.Outbox[order.Order.OrderID]; queued {
				return errors.New("legacy order already has an outbox")
			}
			record := BrokerOrderHandoffRecord{TicketHash: ticketHash, Account: account, RequestID: requestID,
				CallbackState: challenge.Unsigned.CallbackStateHash, CallbackStateBinding: "raw-v1-random32", IssuedAt: now.UTC(), ExpiresAt: expires}
			if all.BrokerOrderHandoffs == nil {
				all.BrokerOrderHandoffs = map[string]BrokerOrderHandoffRecord{}
			}
			all.BrokerOrderHandoffs[ticketHash] = record
			return nil
		})
		if !errors.Is(err, errFinanceStateConflict) {
			break
		}
	}
	return err
}

// StoreBrokerOrderHandoffDecision is reached only after the accepted
// Wallet/Auth root verifier has checked the exact ticket, durable unsigned
// challenge, signature and status. It stores a confidential decision without
// creating a Broker execution outbox. A retry of the same proof may rotate the
// one-time callback code; a different proof for the same status is rejected.
// The sole allowed status change is unused approved -> revoked.
func (s *Store) StoreBrokerOrderHandoffDecision(account, ticketHash, verifiedRequestID, status string, expectedChallenge FinanceOrderApprovalUnsignedV1, proof json.RawMessage, codeHash string, now time.Time) (BrokerOrderHandoffRecord, error) {
	if !brokerHandoffHex.MatchString(ticketHash) || !brokerHandoffHex.MatchString(codeHash) ||
		(status != "approved" && status != "rejected" && status != "revoked") ||
		!evmSubjectRequestID.MatchString(verifiedRequestID) {
		return BrokerOrderHandoffRecord{}, errors.New("confidential decision identity or proof is invalid")
	}
	compactProof, compactErr := compactBrokerHandoffProof(proof)
	if compactErr != nil {
		return BrokerOrderHandoffRecord{}, compactErr
	}
	proofDigest := sha256.Sum256(compactProof)
	proofHash := hex.EncodeToString(proofDigest[:])
	var result BrokerOrderHandoffRecord
	var err error
	for attempt := 0; attempt < brokerCASAttempts; attempt++ {
		err = s.updateAllState(account, "broker.handoff.decision_stored", ticketHash, func(all *persistedState) error {
			record, ok := all.BrokerOrderHandoffs[ticketHash]
			if !ok || record.Account != account || (record.CallbackStateBinding == "sha256-v2" && record.SessionBindingHash == "") || record.RequestID != verifiedRequestID || !record.ExpiresAt.After(now.UTC()) ||
				len(record.ClaimNonces) == 0 || record.CodeConsumedAt != nil {
				return errors.New("confidential ticket is absent, unclaimed, expired or already consumed")
			}
			owner := all.Accounts[account]
			challenge, ok := owner.Brokerage.Challenges[verifiedRequestID]
			mapping := owner.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
			if !ok || challenge.ApprovalState != "pending" || mapping.Status != "active" || mapping.Account != account ||
				mapping.WalletPublicKey != challenge.Unsigned.AccountPublicKey || mapping.SubjectID != challenge.Unsigned.SubjectID ||
				mapping.BrokerAccountID != challenge.Unsigned.BrokerAccountID ||
				challenge.Unsigned.CallbackStateHash == "" ||
				string(mustFinanceCanonical(challenge.Unsigned)) != string(mustFinanceCanonical(expectedChallenge)) {
				return errors.New("confidential decision no longer has the original pending owner")
			}
			if record.DecisionStatus != "" && !((record.DecisionStatus == status && record.DecisionProofHash == proofHash) ||
				(record.DecisionStatus == "approved" && status == "revoked")) {
				return errors.New("conflicting confidential order decision")
			}
			codeExpires := now.UTC().Add(time.Minute)
			if codeExpires.After(record.ExpiresAt) {
				codeExpires = record.ExpiresAt
			}
			if !codeExpires.After(now.UTC()) {
				return errors.New("confidential callback code cannot outlive the challenge")
			}
			record.DecisionStatus = status
			record.DecisionProof = append(json.RawMessage(nil), compactProof...)
			record.DecisionProofHash = proofHash
			record.CodeHash = codeHash
			record.CodeExpiresAt = codeExpires
			if validateBrokerOrderHandoff(*all, ticketHash, record) != nil {
				return errors.New("confidential decision failed durable state validation")
			}
			all.BrokerOrderHandoffs[ticketHash] = record
			result = record
			return nil
		})
		if !errors.Is(err, errFinanceStateConflict) {
			break
		}
	}
	return result, err
}
