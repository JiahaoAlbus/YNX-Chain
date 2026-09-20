package finance

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const brokerCASAttempts = 64

var errBrokerStateUnchanged = errors.New("Broker state already reflects the requested transition")

type BrokerChallengeRequest struct {
	AccountPublicKey    string
	Order               FinanceOrderV1
	FeeEvidenceRef      string
	FeeBoundEstablished bool
	Lifetime            time.Duration
}

type BrokerConsumeResult struct {
	Order      BrokerOrderRecord `json:"order"`
	Outbox     BrokerOrderOutbox `json:"outbox"`
	Replayed   bool              `json:"replayed"`
	ServerTime string            `json:"serverTime"`
}

func brokerMappingKey(provider, environment string) string { return provider + ":" + environment }

func (s *Store) BrokerWorkspace(account string, now time.Time) BrokerWorkspace {
	state := s.Account(account)
	orders := make([]BrokerOrderRecord, 0, len(state.Brokerage.Orders))
	for _, order := range state.Brokerage.Orders {
		orders = append(orders, order)
	}
	sort.Slice(orders, func(i, j int) bool { return orders[i].CreatedAt.After(orders[j].CreatedAt) })
	outbox := make([]BrokerOrderOutbox, 0, len(state.Brokerage.Outbox))
	for _, item := range state.Brokerage.Outbox {
		outbox = append(outbox, item)
	}
	sort.Slice(outbox, func(i, j int) bool { return outbox[i].CreatedAt.After(outbox[j].CreatedAt) })
	journal := append([]BrokerJournalEvent(nil), state.Brokerage.Journal...)
	if len(journal) > 200 {
		journal = journal[len(journal)-200:]
	}
	mapping, active := state.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
	active = active && mapping.Account == account && mapping.Status == "active"
	watchlist := make([]BrokerWatchlistItem, 0, len(state.Brokerage.Watchlist))
	for _, item := range state.Brokerage.Watchlist {
		watchlist = append(watchlist, item)
	}
	sort.Slice(watchlist, func(i, j int) bool { return watchlist[i].Symbol < watchlist[j].Symbol })
	return BrokerWorkspace{MappingActive: active, Orders: orders, Outbox: outbox, Journal: journal, Watchlist: watchlist, ServerTime: now.UTC().Format("2006-01-02T15:04:05.000Z")}
}

func (s *Store) ResolveBrokerAccount(_ context.Context, owner, provider, environment string) (string, error) {
	state := s.Account(owner)
	mapping, ok := state.Brokerage.Mappings[brokerMappingKey(provider, environment)]
	if !ok || mapping.Account != owner || mapping.Provider != provider || mapping.TradingEnvironment != environment || mapping.Status != "active" || !financeProviderUUIDPattern.MatchString(mapping.BrokerAccountID) {
		return "", errors.New("Broker account is not linked to this Finance subject")
	}
	return mapping.BrokerAccountID, nil
}

func (s *Store) PutBrokerSandboxMapping(account, brokerAccountID string, now time.Time) (BrokerAccountMapping, error) {
	return s.PutBrokerSandboxMappingWithWalletKey(account, brokerAccountID, "", now)
}

func (s *Store) PutBrokerSandboxMappingWithWalletKey(account, brokerAccountID, walletPublicKey string, now time.Time) (BrokerAccountMapping, error) {
	subjectID, err := DeriveFinanceSubjectID(account)
	if err != nil || !financeProviderUUIDPattern.MatchString(brokerAccountID) || (walletPublicKey != "" && !financePublicKeyPattern.MatchString(walletPublicKey)) {
		return BrokerAccountMapping{}, errors.New("Broker Sandbox mapping identity is invalid")
	}
	now = now.UTC()
	var result BrokerAccountMapping
	for attempt := 0; attempt < brokerCASAttempts; attempt++ {
		err = s.updateAllState(account, "broker.mapping.put", brokerAccountID, func(all *persistedState) error {
			key := brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)
			for otherAccount, otherState := range all.Accounts {
				if otherAccount == account {
					continue
				}
				if mapping := otherState.Brokerage.Mappings[key]; mapping.BrokerAccountID == brokerAccountID {
					return errors.New("Broker Sandbox account is already linked to another Finance user")
				}
			}
			state := all.Accounts[account]
			normalizeBrokerageState(&state.Brokerage)
			createdAt := now
			existing, exists := state.Brokerage.Mappings[key]
			if exists {
				if existing.Account != account || existing.SubjectID != subjectID {
					return errors.New("Broker Sandbox mapping subject cannot be reassigned")
				}
				createdAt = existing.CreatedAt
			}
			linkedWalletPublicKey := walletPublicKey
			if linkedWalletPublicKey == "" && exists {
				linkedWalletPublicKey = existing.WalletPublicKey
			}
			result = BrokerAccountMapping{SubjectID: subjectID, Account: account, Provider: FinanceOrderProvider, TradingEnvironment: FinanceOrderTradingEnv, BrokerAccountID: brokerAccountID, WalletPublicKey: linkedWalletPublicKey, Status: "active", CreatedAt: createdAt, UpdatedAt: now}
			state.Brokerage.Mappings[key] = result
			all.Accounts[account] = state
			return nil
		})
		if err == nil {
			return result, nil
		}
		if !errors.Is(err, errFinanceStateConflict) {
			return BrokerAccountMapping{}, err
		}
	}
	return BrokerAccountMapping{}, fmt.Errorf("Broker state CAS retry limit reached: %w", err)
}

func (s *Store) BrokerWalletPublicKey(account string) (string, error) {
	state := s.Account(account)
	mapping, ok := state.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
	if !ok || mapping.Account != account || mapping.Status != "active" || !financePublicKeyPattern.MatchString(mapping.WalletPublicKey) {
		return "", errors.New("Broker Sandbox mapping has no verified Wallet public key")
	}
	return mapping.WalletPublicKey, nil
}

func (s *Store) SetBrokerWatchlistItem(account string, asset BrokerWatchlistItem, selected bool, now time.Time) ([]BrokerWatchlistItem, error) {
	if !financeProviderUUIDPattern.MatchString(asset.AssetID) || !financeSymbolPattern.MatchString(asset.Symbol) || strings.TrimSpace(asset.Name) == "" || len(asset.Name) > 160 {
		return nil, errors.New("Broker watchlist asset is invalid")
	}
	err := s.updateBrokerCAS(account, "broker.watchlist.update", asset.AssetID, func(state *AccountState) error {
		normalizeBrokerageState(&state.Brokerage)
		if !selected {
			if _, ok := state.Brokerage.Watchlist[asset.AssetID]; !ok {
				return errBrokerStateUnchanged
			}
			delete(state.Brokerage.Watchlist, asset.AssetID)
			return nil
		}
		if len(state.Brokerage.Watchlist) >= 100 {
			if _, exists := state.Brokerage.Watchlist[asset.AssetID]; !exists {
				return errors.New("Broker watchlist limit reached")
			}
		}
		if existing, ok := state.Brokerage.Watchlist[asset.AssetID]; ok {
			asset.AddedAt = existing.AddedAt
		} else {
			asset.AddedAt = now.UTC()
		}
		state.Brokerage.Watchlist[asset.AssetID] = asset
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.BrokerWorkspace(account, now).Watchlist, nil
}

func (s *Store) CreateBrokerOrderChallenge(account string, request BrokerChallengeRequest, now time.Time) (BrokerApprovalChallenge, error) {
	if !request.FeeBoundEstablished || strings.TrimSpace(request.FeeEvidenceRef) == "" || len(request.FeeEvidenceRef) > 256 {
		return BrokerApprovalChallenge{}, errors.New("a bounded, auditable fee source is required")
	}
	if !financePublicKeyPattern.MatchString(request.AccountPublicKey) {
		return BrokerApprovalChallenge{}, errors.New("Finance order Wallet public key is invalid")
	}
	order := request.Order
	if order.OrderID == "" {
		generated, err := newFinanceUUIDv4()
		if err != nil {
			return BrokerApprovalChallenge{}, err
		}
		order.OrderID = generated
	}
	orderHash, err := FinanceOrderHash(order)
	if err != nil {
		return BrokerApprovalChallenge{}, err
	}
	subjectID, err := DeriveFinanceSubjectID(account)
	if err != nil {
		return BrokerApprovalChallenge{}, err
	}
	requestUUID, err := newFinanceUUIDv4()
	if err != nil {
		return BrokerApprovalChallenge{}, err
	}
	challengeUUID, err := newFinanceUUIDv4()
	if err != nil {
		return BrokerApprovalChallenge{}, err
	}
	nonce, err := newFinanceUUIDv4()
	if err != nil {
		return BrokerApprovalChallenge{}, err
	}
	callbackBytes := make([]byte, 32)
	if _, err := rand.Read(callbackBytes); err != nil {
		return BrokerApprovalChallenge{}, err
	}
	issuedAt := now.UTC().Truncate(time.Millisecond)
	lifetime := request.Lifetime
	if lifetime == 0 {
		lifetime = 5 * time.Minute
	}
	if lifetime <= 0 || lifetime > 5*time.Minute {
		return BrokerApprovalChallenge{}, errors.New("Finance approval lifetime must be positive and at most five minutes")
	}

	var result BrokerApprovalChallenge
	err = s.updateBrokerCAS(account, "broker.approval.challenge", order.OrderID, func(state *AccountState) error {
		normalizeBrokerageState(&state.Brokerage)
		if _, err := expireDueBrokerOrders(state, issuedAt); err != nil {
			return err
		}
		for _, challenge := range state.Brokerage.Challenges {
			if challenge.ApprovalState == "pending" || challenge.ApprovalState == "approved" {
				return errors.New("an active Finance order approval already exists for this account")
			}
		}
		mapping, ok := state.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
		if !ok || mapping.Status != "active" || mapping.Account != account || mapping.SubjectID != subjectID || mapping.WalletPublicKey != request.AccountPublicKey {
			return errors.New("active Broker Sandbox mapping is required")
		}
		if _, exists := state.Brokerage.Orders[order.OrderID]; exists {
			return errors.New("Finance order id already exists")
		}
		unsigned := FinanceOrderApprovalUnsignedV1{
			Account: account, AccountPublicKey: request.AccountPublicKey, ApplicationID: FinanceOrderApplicationID,
			BrokerAccountID: mapping.BrokerAccountID, CallbackStateHash: hex.EncodeToString(callbackBytes),
			ChainEnvironment: FinanceOrderChainEnv, ChainID: FinanceOrderChainID, ChallengeID: "challenge_" + challengeUUID,
			ExpiresAt: issuedAt.Add(lifetime).Format("2006-01-02T15:04:05.000Z"), IssuedAt: issuedAt.Format("2006-01-02T15:04:05.000Z"),
			Nonce: nonce, Order: order, OrderHash: orderHash, Origin: FinanceOrderOrigin, Platform: FinanceOrderPlatform,
			ProductID: FinanceOrderProductID, Provider: FinanceOrderProvider, RequestID: "request_" + requestUUID,
			SubjectID: subjectID, TradingEnvironment: FinanceOrderTradingEnv, Version: FinanceOrderApprovalVersion,
		}
		result = BrokerApprovalChallenge{Unsigned: unsigned, ServerTime: issuedAt.Format("2006-01-02T15:04:05.000Z"), ApprovalState: "pending", UpdatedAt: issuedAt}
		state.Brokerage.Challenges[unsigned.RequestID] = result
		state.Brokerage.Orders[order.OrderID] = BrokerOrderRecord{Order: order, RequestID: unsigned.RequestID, ChallengeID: unsigned.ChallengeID, SubjectID: subjectID, BrokerAccountID: mapping.BrokerAccountID, OrderHash: orderHash, ApprovalState: "pending", State: "approval_pending", CreatedAt: issuedAt, UpdatedAt: issuedAt}
		appendBrokerJournal(&state.Brokerage, order.OrderID, unsigned.RequestID, "approval.challenge_created", "pending", "approval_pending", issuedAt)
		state.Idempotency["broker.fee-evidence:"+order.OrderID] = request.FeeEvidenceRef
		return nil
	})
	return result, err
}

func (s *Store) ApproveBrokerOrder(account string, approval FinanceOrderApprovalV1, now time.Time) (BrokerOrderRecord, error) {
	digest, err := VerifyFinanceOrderApprovalV1(approval, now)
	if err != nil {
		return BrokerOrderRecord{}, err
	}
	if approval.Account != account {
		return BrokerOrderRecord{}, errors.New("Finance approval does not match the authenticated account")
	}
	var result BrokerOrderRecord
	err = s.updateBrokerCAS(account, "broker.approval.approved", approval.Order.OrderID, func(state *AccountState) error {
		normalizeBrokerageState(&state.Brokerage)
		challenge, ok := state.Brokerage.Challenges[approval.RequestID]
		if !ok || string(mustFinanceCanonical(challenge.Unsigned)) != string(mustFinanceCanonical(approval.FinanceOrderApprovalUnsignedV1)) {
			return errors.New("Finance approval does not match the durable challenge")
		}
		mapping := state.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
		if mapping.Account != account || mapping.SubjectID != approval.SubjectID || mapping.BrokerAccountID != approval.BrokerAccountID || mapping.Status != "active" || mapping.WalletPublicKey != approval.AccountPublicKey {
			return errors.New("Finance approval no longer matches the current Broker Sandbox mapping")
		}
		order := state.Brokerage.Orders[approval.Order.OrderID]
		if challenge.ApprovalState == "approved" && challenge.ApprovalDigest == digest {
			result = order
			return errBrokerStateUnchanged
		}
		if challenge.ApprovalState != "pending" {
			return fmt.Errorf("Finance approval is already %s", challenge.ApprovalState)
		}
		approvedAt := now.UTC()
		challenge.ApprovalState, challenge.ApprovalDigest, challenge.Signature, challenge.ApprovedAt, challenge.UpdatedAt = "approved", digest, approval.Signature, approvedAt, approvedAt
		order.ApprovalState, order.State, order.ApprovalDigest, order.UpdatedAt = "approved", "approved", digest, approvedAt
		state.Brokerage.Challenges[approval.RequestID], state.Brokerage.Orders[order.Order.OrderID] = challenge, order
		appendBrokerJournal(&state.Brokerage, order.Order.OrderID, approval.RequestID, "approval.approved", "approved", "approved", approvedAt)
		result = order
		return nil
	})
	return result, err
}

func (s *Store) RejectBrokerOrder(account, requestID, callbackStateHash string, now time.Time) (BrokerOrderRecord, error) {
	return s.transitionUnapprovedBrokerOrder(account, requestID, callbackStateHash, "rejected", "approval.rejected", now)
}

func (s *Store) ExpireBrokerOrder(account, requestID string, now time.Time) (BrokerOrderRecord, error) {
	return s.transitionUnapprovedBrokerOrder(account, requestID, "", "expired", "approval.expired", now)
}

// ExpireBrokerOrders durably archives every owner-scoped pending or approved
// challenge whose server-authoritative lifetime has elapsed. It deliberately
// creates no execution outbox and is safe to call at read and callback
// boundaries after restarts.
func (s *Store) ExpireBrokerOrders(account string, now time.Time) (int, error) {
	now = now.UTC()
	expired := 0
	err := s.updateBrokerCAS(account, "broker.approval.expire_due", account, func(state *AccountState) error {
		normalizeBrokerageState(&state.Brokerage)
		var err error
		expired, err = expireDueBrokerOrders(state, now)
		if err != nil {
			return err
		}
		if expired == 0 {
			return errBrokerStateUnchanged
		}
		return nil
	})
	return expired, err
}

func expireDueBrokerOrders(state *AccountState, now time.Time) (int, error) {
	expired := 0
	for requestID, challenge := range state.Brokerage.Challenges {
		if challenge.ApprovalState != "pending" && challenge.ApprovalState != "approved" {
			continue
		}
		expiresAt, err := parseFinanceMilliseconds(challenge.Unsigned.ExpiresAt)
		if err != nil {
			return 0, errors.New("Finance approval lifetime is invalid")
		}
		if now.Before(expiresAt) {
			continue
		}
		order, ok := state.Brokerage.Orders[challenge.Unsigned.Order.OrderID]
		if !ok || order.RequestID != requestID || order.ApprovalState != challenge.ApprovalState {
			return 0, errors.New("Finance approval durable state is inconsistent")
		}
		if _, exists := state.Brokerage.Outbox[order.Order.OrderID]; exists {
			return 0, errors.New("unconsumed Finance approval unexpectedly has an execution outbox")
		}
		challenge.ApprovalState, challenge.UpdatedAt = "expired", now
		order.ApprovalState, order.State, order.UpdatedAt = "expired", "draft", now
		state.Brokerage.Challenges[requestID], state.Brokerage.Orders[order.Order.OrderID] = challenge, order
		appendBrokerJournal(&state.Brokerage, order.Order.OrderID, requestID, "approval.expired", "expired", "draft", now)
		expired++
	}
	return expired, nil
}

func (s *Store) transitionUnapprovedBrokerOrder(account, requestID, callbackStateHash, target, action string, now time.Time) (BrokerOrderRecord, error) {
	var result BrokerOrderRecord
	err := s.updateBrokerCAS(account, action, requestID, func(state *AccountState) error {
		normalizeBrokerageState(&state.Brokerage)
		challenge, ok := state.Brokerage.Challenges[requestID]
		if !ok {
			return errors.New("Finance approval challenge was not found")
		}
		if callbackStateHash != "" && callbackStateHash != challenge.Unsigned.CallbackStateHash {
			return errors.New("Finance approval callback state does not match")
		}
		if target == "expired" {
			expiresAt, _ := parseFinanceMilliseconds(challenge.Unsigned.ExpiresAt)
			if now.UTC().Before(expiresAt) {
				return errors.New("Finance approval is not expired")
			}
		}
		order := state.Brokerage.Orders[challenge.Unsigned.Order.OrderID]
		if challenge.ApprovalState == target {
			result = order
			return errBrokerStateUnchanged
		}
		allowedFrom := challenge.ApprovalState == "pending" || (target == "expired" && challenge.ApprovalState == "approved")
		if !allowedFrom {
			return fmt.Errorf("Finance approval is already %s", challenge.ApprovalState)
		}
		challenge.ApprovalState, challenge.UpdatedAt = target, now.UTC()
		order.ApprovalState, order.State, order.UpdatedAt = target, "draft", now.UTC()
		state.Brokerage.Challenges[requestID], state.Brokerage.Orders[order.Order.OrderID] = challenge, order
		appendBrokerJournal(&state.Brokerage, order.Order.OrderID, requestID, action, target, "draft", now.UTC())
		result = order
		return nil
	})
	return result, err
}

func (s *Store) RevokeBrokerOrder(account, callbackStateHash string, revocation FinanceOrderRevocationV1, now time.Time) (BrokerOrderRecord, error) {
	var result BrokerOrderRecord
	err := s.updateBrokerCAS(account, "broker.approval.revoked", revocation.RequestID, func(state *AccountState) error {
		normalizeBrokerageState(&state.Brokerage)
		challenge, ok := state.Brokerage.Challenges[revocation.RequestID]
		if !ok {
			return errors.New("Finance approval challenge was not found")
		}
		if callbackStateHash != challenge.Unsigned.CallbackStateHash {
			return errors.New("Finance approval callback state does not match")
		}
		if challenge.ApprovalState != "approved" && challenge.ApprovalState != "pending" && challenge.ApprovalState != "revoked" {
			return fmt.Errorf("Finance approval is already %s", challenge.ApprovalState)
		}
		issuedAt, issuedErr := parseFinanceMilliseconds(challenge.Unsigned.IssuedAt)
		expiresAt, expiresErr := parseFinanceMilliseconds(challenge.Unsigned.ExpiresAt)
		if issuedErr != nil || expiresErr != nil {
			return errors.New("Finance approval lifetime is invalid")
		}
		expectedDigest := challenge.ApprovalDigest
		if challenge.ApprovalState == "pending" {
			expectedDigest = digestFinanceCanonical(FinanceOrderApprovalDomain, challenge.Unsigned)
		}
		mapping := state.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
		if mapping.Account != account || mapping.Account != challenge.Unsigned.Account || mapping.SubjectID != challenge.Unsigned.SubjectID || mapping.Provider != FinanceOrderProvider || mapping.TradingEnvironment != FinanceOrderTradingEnv || mapping.BrokerAccountID != challenge.Unsigned.BrokerAccountID || mapping.Status != "active" || mapping.WalletPublicKey != challenge.Unsigned.AccountPublicKey || mapping.WalletPublicKey != revocation.AccountPublicKey {
			return errors.New("Finance approval revocation no longer matches the current Broker Sandbox mapping")
		}
		if err := VerifyFinanceOrderRevocationV1(revocation, account, challenge.Unsigned.RequestID, expectedDigest, issuedAt, expiresAt, now); err != nil {
			return err
		}
		if challenge.ApprovalState == "revoked" {
			if challenge.Revocation == nil || *challenge.Revocation != revocation {
				return errors.New("Finance approval revocation replay does not match")
			}
			result = state.Brokerage.Orders[challenge.Unsigned.Order.OrderID]
			return errBrokerStateUnchanged
		}
		order := state.Brokerage.Orders[challenge.Unsigned.Order.OrderID]
		challenge.ApprovalState, challenge.ApprovalDigest, challenge.Revocation, challenge.UpdatedAt = "revoked", expectedDigest, &revocation, now.UTC()
		order.ApprovalState, order.State, order.UpdatedAt = "revoked", "draft", now.UTC()
		state.Brokerage.Challenges[revocation.RequestID], state.Brokerage.Orders[order.Order.OrderID] = challenge, order
		appendBrokerJournal(&state.Brokerage, order.Order.OrderID, revocation.RequestID, "approval.revoked", "revoked", "draft", now.UTC())
		result = order
		return nil
	})
	return result, err
}

func (s *Store) ConsumeBrokerOrder(account, requestID, approvalDigest string, now time.Time) (BrokerConsumeResult, error) {
	var result BrokerConsumeResult
	err := s.updateBrokerCAS(account, "broker.approval.consumed", requestID, func(state *AccountState) error {
		normalizeBrokerageState(&state.Brokerage)
		challenge, ok := state.Brokerage.Challenges[requestID]
		if !ok {
			return errors.New("Finance approval challenge was not found")
		}
		order := state.Brokerage.Orders[challenge.Unsigned.Order.OrderID]
		if challenge.ApprovalState == "consumed" {
			if challenge.ApprovalDigest != approvalDigest {
				return errors.New("Finance approval replay digest does not match")
			}
			outbox, exists := state.Brokerage.Outbox[order.Order.OrderID]
			if !exists {
				return errors.New("consumed Finance approval is missing its durable outbox")
			}
			result = BrokerConsumeResult{Order: order, Outbox: outbox, Replayed: true, ServerTime: now.UTC().Format("2006-01-02T15:04:05.000Z")}
			return errBrokerStateUnchanged
		}
		if challenge.ApprovalState != "approved" || challenge.ApprovalDigest != approvalDigest {
			return errors.New("only the exact approved Finance proof can be consumed")
		}
		expiresAt, _ := parseFinanceMilliseconds(challenge.Unsigned.ExpiresAt)
		if !expiresAt.After(now.UTC()) {
			return errors.New("Finance approval expired before consumption")
		}
		mapping := state.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
		if mapping.Status != "active" || mapping.SubjectID != challenge.Unsigned.SubjectID || mapping.BrokerAccountID != challenge.Unsigned.BrokerAccountID || mapping.WalletPublicKey != challenge.Unsigned.AccountPublicKey {
			return errors.New("Finance approval mapping changed before consumption")
		}
		outbox := BrokerOrderOutbox{OrderID: order.Order.OrderID, RequestID: requestID, ProviderClientOrderID: order.Order.OrderID, Provider: FinanceOrderProvider, TradingEnvironment: FinanceOrderTradingEnv, Status: "pending_unwired", Attempts: 0, CreatedAt: now.UTC(), UpdatedAt: now.UTC()}
		challenge.ApprovalState, challenge.UpdatedAt = "consumed", now.UTC()
		order.ApprovalState, order.State, order.ProviderClientOrderID, order.UpdatedAt = "consumed", "submitting", outbox.ProviderClientOrderID, now.UTC()
		state.Brokerage.Challenges[requestID], state.Brokerage.Orders[order.Order.OrderID], state.Brokerage.Outbox[order.Order.OrderID] = challenge, order, outbox
		appendBrokerJournal(&state.Brokerage, order.Order.OrderID, requestID, "approval.consumed_outbox_created", "consumed", "submitting", now.UTC())
		result = BrokerConsumeResult{Order: order, Outbox: outbox, ServerTime: now.UTC().Format("2006-01-02T15:04:05.000Z")}
		return nil
	})
	return result, err
}

// VerifyAndConsumeBrokerOrder is the Finance authority boundary used by a
// Wallet callback. Signature verification does not consume on its own: the
// durable challenge check, current mapping check, one-time state transition,
// provider client_order_id allocation and outbox creation commit in one CAS.
// This method never contacts the provider.
func (s *Store) VerifyAndConsumeBrokerOrder(account string, approval FinanceOrderApprovalV1, now time.Time) (BrokerConsumeResult, error) {
	digest, err := VerifyFinanceOrderApprovalV1(approval, now)
	if err != nil {
		return BrokerConsumeResult{}, err
	}
	if approval.Account != account {
		return BrokerConsumeResult{}, errors.New("Finance approval does not match the authenticated account")
	}
	var result BrokerConsumeResult
	err = s.updateBrokerCAS(account, "broker.approval.verified_consumed", approval.RequestID, func(state *AccountState) error {
		normalizeBrokerageState(&state.Brokerage)
		challenge, ok := state.Brokerage.Challenges[approval.RequestID]
		if !ok || string(mustFinanceCanonical(challenge.Unsigned)) != string(mustFinanceCanonical(approval.FinanceOrderApprovalUnsignedV1)) {
			return errors.New("Finance approval does not match the durable challenge")
		}
		order := state.Brokerage.Orders[approval.Order.OrderID]
		if challenge.ApprovalState == "consumed" {
			if challenge.ApprovalDigest != digest {
				return errors.New("Finance approval replay digest does not match")
			}
			outbox, exists := state.Brokerage.Outbox[order.Order.OrderID]
			if !exists {
				return errors.New("consumed Finance approval is missing its durable outbox")
			}
			result = BrokerConsumeResult{Order: order, Outbox: outbox, Replayed: true, ServerTime: now.UTC().Format("2006-01-02T15:04:05.000Z")}
			return errBrokerStateUnchanged
		}
		if challenge.ApprovalState != "pending" && challenge.ApprovalState != "approved" {
			return fmt.Errorf("Finance approval is already %s", challenge.ApprovalState)
		}
		if challenge.ApprovalState == "approved" && challenge.ApprovalDigest != digest {
			return errors.New("Finance approval digest changed before consumption")
		}
		mapping := state.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
		if mapping.Account != account || mapping.Status != "active" || mapping.SubjectID != approval.SubjectID || mapping.BrokerAccountID != approval.BrokerAccountID || mapping.WalletPublicKey != approval.AccountPublicKey {
			return errors.New("Finance approval no longer matches the current Broker Sandbox mapping")
		}
		serverTime := now.UTC()
		if challenge.ApprovalState == "pending" {
			challenge.ApprovalDigest, challenge.Signature, challenge.ApprovedAt = digest, approval.Signature, serverTime
			appendBrokerJournal(&state.Brokerage, order.Order.OrderID, approval.RequestID, "approval.verified", "approved", "approved", serverTime)
		}
		outbox := BrokerOrderOutbox{OrderID: order.Order.OrderID, RequestID: approval.RequestID, ProviderClientOrderID: order.Order.OrderID, Provider: FinanceOrderProvider, TradingEnvironment: FinanceOrderTradingEnv, Status: "pending_unwired", Attempts: 0, CreatedAt: serverTime, UpdatedAt: serverTime}
		challenge.ApprovalState, challenge.UpdatedAt = "consumed", serverTime
		order.ApprovalState, order.State, order.ApprovalDigest, order.ProviderClientOrderID, order.UpdatedAt = "consumed", "submitting", digest, outbox.ProviderClientOrderID, serverTime
		state.Brokerage.Challenges[approval.RequestID], state.Brokerage.Orders[order.Order.OrderID], state.Brokerage.Outbox[order.Order.OrderID] = challenge, order, outbox
		appendBrokerJournal(&state.Brokerage, order.Order.OrderID, approval.RequestID, "approval.consumed_outbox_created", "consumed", "submitting", serverTime)
		result = BrokerConsumeResult{Order: order, Outbox: outbox, ServerTime: serverTime.Format("2006-01-02T15:04:05.000Z")}
		return nil
	})
	return result, err
}

func (s *Store) updateBrokerCAS(account, action, objectID string, fn func(*AccountState) error) error {
	var err error
	for attempt := 0; attempt < brokerCASAttempts; attempt++ {
		err = s.Update(account, action, objectID, fn)
		if errors.Is(err, errBrokerStateUnchanged) {
			return nil
		}
		if !errors.Is(err, errFinanceStateConflict) {
			return err
		}
	}
	return fmt.Errorf("Broker state CAS retry limit reached: %w", err)
}

func appendBrokerJournal(state *BrokerageAccountState, orderID, requestID, action, approvalState, orderState string, now time.Time, provider ...BrokerProviderAudit) {
	seed := strings.Join([]string{orderID, requestID, action, now.UTC().Format(time.RFC3339Nano)}, "\n")
	digest := sha256.Sum256([]byte(seed))
	event := BrokerJournalEvent{ID: "broker_event_" + hex.EncodeToString(digest[:16]), OrderID: orderID, RequestID: requestID, Action: action, ApprovalState: approvalState, OrderState: orderState, CreatedAt: now.UTC()}
	if len(provider) == 1 {
		event.ProviderRawStatus = provider[0].RawStatus
		event.ProviderHTTPRequestID = provider[0].HTTPRequestID
		event.ProviderEventCursor = provider[0].EventCursor
	}
	state.Journal = append(state.Journal, event)
	if len(state.Journal) > 5000 {
		state.Journal = append([]BrokerJournalEvent(nil), state.Journal[len(state.Journal)-5000:]...)
	}
}
