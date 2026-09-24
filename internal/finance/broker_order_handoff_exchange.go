package finance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

type BrokerOpaqueExchangeResult struct {
	Status                 string             `json:"status"`
	Order                  BrokerOrderRecord  `json:"order"`
	Outbox                 *BrokerOrderOutbox `json:"outbox,omitempty"`
	ProviderWriteAttempted bool               `json:"providerWriteAttempted"`
}

// The code, callback state, signed decision and Broker state are checked and
// consumed in one repository CAS. No provider call is made here. In
// particular, a signed approval alone cannot enqueue an order.
func (s *Store) ExchangeBrokerOrderHandoff(account, requestID, code, callbackState, sessionBinding string, now time.Time) (BrokerOpaqueExchangeResult, error) {
	if !evmSubjectRequestID.MatchString(requestID) || !brokerHandoffToken.MatchString(code) || callbackState == "" {
		return BrokerOpaqueExchangeResult{}, errors.New("confidential callback identity is invalid")
	}
	codeDigest := sha256.Sum256([]byte(code))
	codeHash := hex.EncodeToString(codeDigest[:])
	sessionHash, hashErr := brokerHandoffSessionHash(sessionBinding)
	if hashErr != nil {
		return BrokerOpaqueExchangeResult{}, hashErr
	}
	var result BrokerOpaqueExchangeResult
	var err error
	for attempt := 0; attempt < brokerCASAttempts; attempt++ {
		err = s.updateAllState(account, "broker.handoff.code_exchanged", requestID, func(all *persistedState) error {
			var ticketHash string
			var record BrokerOrderHandoffRecord
			for key, candidate := range all.BrokerOrderHandoffs {
				if candidate.Account == account && candidate.RequestID == requestID {
					if ticketHash != "" {
						return errors.New("confidential callback owner is ambiguous")
					}
					ticketHash, record = key, candidate
				}
			}
			// Fresh v2 tickets require the issuing Product Session. Legacy v1 has
			// no persisted original session: a signed pre-cutover owner-key recovery
			// plus this current same-account v2 session is the explicit exception.
			if ticketHash == "" || record.CodeConsumedAt != nil || record.CodeHash != codeHash || record.CallbackState != callbackState ||
				(record.CallbackStateBinding == "sha256-v2" && record.SessionBindingHash != sessionHash) ||
				record.DecisionStatus == "" || !record.CodeExpiresAt.After(now.UTC()) || !record.ExpiresAt.After(now.UTC()) ||
				validateBrokerOrderHandoff(*all, ticketHash, record) != nil {
				return errors.New("confidential callback is absent, expired, mismatched or consumed")
			}
			owner := all.Accounts[account]
			normalizeBrokerageState(&owner.Brokerage)
			challenge, ok := owner.Brokerage.Challenges[requestID]
			if !ok || challenge.ApprovalState != "pending" {
				return errors.New("confidential callback challenge is not pending")
			}
			order, ok := owner.Brokerage.Orders[challenge.Unsigned.Order.OrderID]
			mapping := owner.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
			if !ok || order.RequestID != requestID || order.ApprovalState != "pending" ||
				mapping.Status != "active" || mapping.Account != account || mapping.SubjectID != challenge.Unsigned.SubjectID ||
				mapping.BrokerAccountID != challenge.Unsigned.BrokerAccountID || mapping.WalletPublicKey != challenge.Unsigned.AccountPublicKey {
				return errors.New("confidential callback no longer has an active Broker owner")
			}
			if _, exists := owner.Brokerage.Outbox[order.Order.OrderID]; exists {
				return errors.New("confidential callback already has an execution outbox")
			}
			at := now.UTC()
			switch record.DecisionStatus {
			case "approved":
				var approval FinanceOrderApprovalV1
				if json.Unmarshal(record.DecisionProof, &approval) != nil ||
					string(mustFinanceCanonical(approval.FinanceOrderApprovalUnsignedV1)) != string(mustFinanceCanonical(challenge.Unsigned)) {
					return errors.New("confidential approval differs from the original order")
				}
				approvalDigest, verifyErr := VerifyFinanceOrderApprovalV1(approval, at)
				if verifyErr != nil {
					return errors.New("confidential approval signature is invalid")
				}
				outbox := BrokerOrderOutbox{OrderID: order.Order.OrderID, RequestID: requestID, ProviderClientOrderID: order.Order.OrderID,
					Provider: FinanceOrderProvider, TradingEnvironment: FinanceOrderTradingEnv, Status: "pending_unwired", Attempts: 0,
					CreatedAt: at, UpdatedAt: at}
				challenge.ApprovalState, challenge.ApprovalDigest, challenge.Signature, challenge.ApprovedAt, challenge.UpdatedAt = "consumed", approvalDigest, approval.Signature, at, at
				order.ApprovalState, order.State, order.ApprovalDigest, order.ProviderClientOrderID, order.UpdatedAt = "consumed", "submitting", approvalDigest, outbox.ProviderClientOrderID, at
				owner.Brokerage.Outbox[order.Order.OrderID] = outbox
				appendBrokerJournal(&owner.Brokerage, order.Order.OrderID, requestID, "approval.consumed_outbox_created", "consumed", "submitting", at)
				result = BrokerOpaqueExchangeResult{Status: "approved", Order: order, Outbox: &outbox}
			case "rejected", "revoked":
				challenge.ApprovalState, challenge.UpdatedAt = record.DecisionStatus, at
				order.ApprovalState, order.State, order.UpdatedAt = record.DecisionStatus, "draft", at
				appendBrokerJournal(&owner.Brokerage, order.Order.OrderID, requestID, "approval."+record.DecisionStatus, record.DecisionStatus, "draft", at)
				result = BrokerOpaqueExchangeResult{Status: record.DecisionStatus, Order: order}
			default:
				return errors.New("confidential callback decision is invalid")
			}
			owner.Brokerage.Challenges[requestID], owner.Brokerage.Orders[order.Order.OrderID] = challenge, order
			consumed := at
			record.CodeConsumedAt = &consumed
			all.BrokerOrderHandoffs[ticketHash] = record
			all.Accounts[account] = owner
			return nil
		})
		if !errors.Is(err, errFinanceStateConflict) {
			break
		}
	}
	return result, err
}
