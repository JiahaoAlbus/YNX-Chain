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
		if !brokerHandoffToken.MatchString(record.CallbackState) {
			return errors.New("confidential handoff state token is invalid")
		}
		digest := sha256.Sum256([]byte(record.CallbackState))
		if hex.EncodeToString(digest[:]) != challenge.Unsigned.CallbackStateHash {
			return errors.New("confidential handoff state digest differs from challenge")
		}
	case "raw-v1-random32":
		if !brokerHandoffHex.MatchString(record.CallbackState) || record.CallbackState != challenge.Unsigned.CallbackStateHash {
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

// PutFreshBrokerOrderHandoff records only a SHA256-bound fresh-v2 callback
// state. A legacy-v1 direct state can never enter through this method.
func (s *Store) PutFreshBrokerOrderHandoff(account, requestID, ticketHash, callbackState string, now time.Time) error {
	if !brokerHandoffHex.MatchString(ticketHash) || !brokerHandoffToken.MatchString(callbackState) {
		return errors.New("fresh confidential handoff identity is invalid")
	}
	return s.updateAllState(account, "broker.handoff.issued", requestID, func(all *persistedState) error {
		owner, ok := all.Accounts[account]
		challenge, exists := owner.Brokerage.Challenges[requestID]
		if !ok || !exists || challenge.Unsigned.Account != account || challenge.ApprovalState != "pending" ||
			all.BrokerOrderHandoffs[ticketHash].TicketHash != "" {
			return errors.New("fresh confidential handoff challenge is unavailable")
		}
		mapping := owner.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
		if mapping.Account != account || mapping.Status != "active" || mapping.WalletPublicKey != challenge.Unsigned.AccountPublicKey {
			return errors.New("fresh confidential handoff owner mapping differs")
		}
		expires, err := parseFinanceMilliseconds(challenge.Unsigned.ExpiresAt)
		if err != nil || !expires.After(now.UTC()) {
			return errors.New("fresh confidential handoff challenge is expired")
		}
		for _, prior := range all.BrokerOrderHandoffs {
			if prior.Account == account && prior.RequestID == requestID {
				return errors.New("a confidential ticket already exists for this challenge")
			}
		}
		record := BrokerOrderHandoffRecord{TicketHash: ticketHash, Account: account, RequestID: requestID,
			CallbackState: callbackState, CallbackStateBinding: "sha256-v2", IssuedAt: now.UTC(), ExpiresAt: expires}
		if all.BrokerOrderHandoffs == nil {
			all.BrokerOrderHandoffs = map[string]BrokerOrderHandoffRecord{}
		}
		if validateBrokerOrderHandoff(*all, ticketHash, record) != nil {
			return errors.New("fresh confidential handoff state does not match the challenge")
		}
		all.BrokerOrderHandoffs[ticketHash] = record
		return nil
	})
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
	err := s.updateAllState(account, "broker.handoff.claimed", ticketHash, func(all *persistedState) error {
		record, ok := all.BrokerOrderHandoffs[ticketHash]
		if !ok || record.Account != account || !record.ExpiresAt.After(now.UTC()) || record.DecisionStatus != "" ||
			len(record.ClaimNonces) >= 5 {
			return errors.New("confidential ticket is absent, expired or already decided")
		}
		owner := all.Accounts[account]
		challenge, ok := owner.Brokerage.Challenges[record.RequestID]
		mapping := owner.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
		if !ok || challenge.ApprovalState != "pending" || mapping.Status != "active" || mapping.Account != account ||
			mapping.WalletPublicKey != challenge.Unsigned.AccountPublicKey {
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
	return unsigned, err
}

// StoreBrokerOrderHandoffDecision is reached only after the accepted
// Wallet/Auth root verifier has checked the exact ticket, durable unsigned
// challenge, signature and status. It stores a confidential decision without
// creating a Broker execution outbox. A retry of the same proof may rotate the
// one-time callback code; a different proof for the same status is rejected.
// The sole allowed status change is unused approved -> revoked.
func (s *Store) StoreBrokerOrderHandoffDecision(account, ticketHash, verifiedRequestID, status string, proof json.RawMessage, codeHash string, now time.Time) (BrokerOrderHandoffRecord, error) {
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
	err := s.updateAllState(account, "broker.handoff.decision_stored", ticketHash, func(all *persistedState) error {
		record, ok := all.BrokerOrderHandoffs[ticketHash]
		if !ok || record.Account != account || record.RequestID != verifiedRequestID || !record.ExpiresAt.After(now.UTC()) ||
			len(record.ClaimNonces) == 0 || record.CodeConsumedAt != nil {
			return errors.New("confidential ticket is absent, unclaimed, expired or already consumed")
		}
		owner := all.Accounts[account]
		challenge, ok := owner.Brokerage.Challenges[verifiedRequestID]
		mapping := owner.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
		if !ok || challenge.ApprovalState != "pending" || mapping.Status != "active" || mapping.Account != account ||
			mapping.WalletPublicKey != challenge.Unsigned.AccountPublicKey ||
			challenge.Unsigned.CallbackStateHash == "" {
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
	return result, err
}
