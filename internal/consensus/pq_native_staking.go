package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const pqStakingHistoryMemo = "ynx-abci-pq-staking-v1:"

// Only the original classic/PQ proof verifiers construct this private business
// view. It has no signature surrogate, public verified bit or reusable grant.
type authorizedStakingAction struct {
	Signer, Action string
	Payload        json.RawMessage
}

// Stored inside the original delegation, not in a second staking ledger. The
// string representation has value-copy semantics and omitempty preserves old
// checkpoint hashes. Empty old histories are never treated as authenticated
// creation events; recovering those needs their actual original transactions.
type stakingAuthorization struct {
	Transport []byte    `json:"transport"`
	Height    int64     `json:"height,string"`
	At        time.Time `json:"at"`
}

type verifiedStakingAuthorization struct {
	stakingAuthorization
	auth   authorizedStakingAction
	PQ     bool
	Nonce  uint64
	Hash   string
	Wire   []byte
	Action ynxauth.Action
}

func detachStakingExecution(s executionState) executionState {
	s.accounts = cloneAccounts(s.accounts)
	s.traceLots = cloneTraceLots(s.traceLots)
	s.stakeDelegations = append([]BFTStakeDelegation(nil), s.stakeDelegations...)
	s.unbondings = cloneUnbondings(s.unbondings)
	return s
}

func pqAuthorizedStakingAction(action ynxauth.Action) (authorizedStakingAction, error) {
	auth := authorizedStakingAction{Signer: action.Owner, Action: action.Kind}
	if !isStakingAction(action.Kind) || action.Fee != 1 {
		return auth, errors.New("PQ staking requires the original fee-one billing rule")
	}
	value, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if err != nil {
		return auth, err
	}
	var payload any
	switch p := value.(type) {
	case ynxauth.StakeDelegatePayload:
		payload = StakeDelegatePayload{Validator: p.Validator, AmountYNXT: int64(p.AmountYNXT)}
	case ynxauth.StakeUnbondPayload:
		payload = StakeUnbondPayload{DelegationID: p.DelegationID, AmountYNXT: int64(p.AmountYNXT)}
	case ynxauth.StakeWithdrawPayload:
		payload = StakeWithdrawPayload{UnbondingID: p.UnbondingID}
	default:
		return auth, errors.New("unsupported typed staking payload")
	}
	auth.Payload, err = json.Marshal(payload)
	if err != nil {
		return auth, err
	}
	canonical, err := canonicalStakingActionPayload(auth.Action, auth.Payload)
	if err != nil || !bytes.Equal(canonical, auth.Payload) {
		return auth, errors.New("typed staking payload differs from original business request")
	}
	return auth, nil
}

func stakingActionDelegation(s executionState, auth authorizedStakingAction) (string, error) {
	switch auth.Action {
	case ActionStakeDelegate:
		var p StakeDelegatePayload
		if err := json.Unmarshal(auth.Payload, &p); err != nil {
			return "", err
		}
		return stakingDelegationID(auth.Signer, p.Validator), nil
	case ActionStakeUnbond:
		var p StakeUnbondPayload
		if err := json.Unmarshal(auth.Payload, &p); err != nil {
			return "", err
		}
		return p.DelegationID, nil
	case ActionStakeWithdraw:
		var p StakeWithdrawPayload
		if err := json.Unmarshal(auth.Payload, &p); err != nil {
			return "", err
		}
		i, ok := unbondingIndex(s.unbondings, p.UnbondingID)
		if !ok {
			return "", errors.New("unbonding entry not found")
		}
		return s.unbondings[i].DelegationID, nil
	}
	return "", errors.New("unsupported staking action")
}

func decodeStakingAuthorizations(raw string) ([]stakingAuthorization, error) {
	var values []stakingAuthorization
	if raw == "" || json.Unmarshal([]byte(raw), &values) != nil || len(values) == 0 {
		return nil, errors.New("staking delegation lacks complete original authorization history")
	}
	canonical, err := json.Marshal(values)
	if err != nil || string(canonical) != raw {
		return nil, errors.New("noncanonical staking original history")
	}
	return values, nil
}

func appendStakingAuthorization(s *executionState, id string, existed bool, raw []byte, height int64, at time.Time) error {
	i, ok := stakingDelegationIndex(s.stakeDelegations, id)
	if !ok {
		return errors.New("staking execution lost its delegation")
	}
	record := s.stakeDelegations[i]
	if existed && record.AuthorizationHistory == "" {
		return errors.New("cannot append PQ authority to an opaque classic delegation")
	}
	var values []stakingAuthorization
	if existed {
		var err error
		values, err = decodeStakingAuthorizations(record.AuthorizationHistory)
		if err != nil {
			return err
		}
	}
	values = append(values, stakingAuthorization{Transport: bytes.Clone(raw), Height: height, At: at.UTC()})
	encoded, err := json.Marshal(values)
	if err != nil {
		return err
	}
	record.AuthorizationHistory = string(encoded)
	record.AuditHash = stakingAuditHash(record)
	s.stakeDelegations[i] = record
	return nil
}

func stakingHistoryTransaction(action ynxauth.Action, raw, wire []byte, height int64, at time.Time, flows []chain.LotFlow) chain.Transaction {
	value, _ := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	to, amount := "", int64(0)
	switch p := value.(type) {
	case ynxauth.StakeDelegatePayload:
		to, amount = p.Validator, int64(p.AmountYNXT)
	case ynxauth.StakeUnbondPayload:
		to, amount = p.DelegationID, int64(p.AmountYNXT)
	case ynxauth.StakeWithdrawPayload:
		// Withdrawal amount is derived from the original unbonding, not an
		// unsigned caller amount. The complete replayed record is query evidence.
		to = p.UnbondingID
	}
	return chain.Transaction{Hash: SignedTransactionHash(wire), Type: action.Kind, From: action.Owner, To: to, Amount: amount, Fee: 1, Nonce: action.Nonce, BlockNum: uint64(height), Timestamp: at.UTC(), Memo: pqStakingHistoryMemo + hex.EncodeToString(raw), LotFlows: flows}
}

func (a *Application) applyPQStakingAction(state executionState, raw []byte, height int64, at time.Time) (executionState, transactionExecution, error) {
	fail := func(err error) (executionState, transactionExecution, error) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	wire, action, err := DecodePQNativeActionTransaction(raw)
	if err != nil {
		return fail(err)
	}
	if height <= 0 || state.accountPolicy == nil || action.NativeChainID != uint64(a.migration.Network.ChainID) || !bytes.Equal(action.ChainID, state.accountPolicy.NetworkID) {
		return fail(errors.New("PQ staking requires actual network, owner policy and height"))
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return fail(err)
	}
	if err := a.pqCertificateCache.VerifyDecodedMember(state.accountPolicy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, uint64(height)); err != nil {
		return fail(err)
	}
	for _, e := range state.pqHistory {
		if e.Transaction.Hash == SignedTransactionHash(wire) || e.ABCITransactionHash == SignedTransactionHash(raw) {
			return fail(errors.New("original PQ staking authorization already executed"))
		}
	}
	auth, err := pqAuthorizedStakingAction(action)
	if err != nil {
		return fail(err)
	}
	id, err := stakingActionDelegation(state, auth)
	if err != nil {
		return fail(err)
	}
	i, existed := stakingDelegationIndex(state.stakeDelegations, id)
	if existed && state.stakeDelegations[i].AuthorizationHistory == "" {
		return fail(errors.New("PQ staking needs the missing original delegation transactions; an unsigned checkpoint is not a substitute"))
	}
	i, ok := accountIndex(state.accounts, action.Owner)
	if !ok || state.accounts[i].Nonce == math.MaxUint64 || action.Nonce != state.accounts[i].Nonce+1 {
		return fail(errors.New("PQ staking requires exact next owner nonce"))
	}
	validationOnly := at.IsZero()
	if validationOnly {
		at = time.Unix(height, 0)
	}
	at = at.UTC()
	next := detachStakingExecution(state)
	// Same fee-one/BW-one rule as classic staking, with real traceable movement.
	flows, err := a.chargePQContract(&next, action, 0)
	if err != nil {
		return fail(err)
	}
	abciHash := SignedTransactionHash(raw)
	next, execution, err := applyAuthorizedStakingBusiness(next, auth, abciHash, height, at, validationOnly, a.activeValidator)
	if err != nil {
		return fail(err)
	}
	if err = appendStakingAuthorization(&next, id, existed, raw, height, at); err != nil {
		return fail(err)
	}
	next.feeEvents = next.feeEvents.append(newCurrentFeeEvent(abciHash, PQActionType, action.Owner, a.feeRecipient, 1, height, at))
	tx := stakingHistoryTransaction(action, raw, wire, height, at, flows)
	next.pqHistory = append(clonePQHistory(state.pqHistory), PQCommittedAuthorization{ABCITransactionHash: abciHash, Transaction: tx})
	execution.typeName, execution.hash = PQActionType, abciHash
	return next, execution, nil
}

func isPQStakingHistory(tx chain.Transaction) bool {
	return strings.HasPrefix(tx.Memo, pqStakingHistoryMemo)
}

func decodePQStakingHistory(e PQCommittedAuthorization) ([]byte, ynxauth.Action, error) {
	tx := e.Transaction
	var action ynxauth.Action
	if !isPQStakingHistory(tx) || len(tx.Memo) > 4*chain.MaxPQActionMemberBytes+1024 {
		return nil, action, errors.New("missing or oversized staking original")
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, pqStakingHistoryMemo))
	if err != nil || tx.Memo != pqStakingHistoryMemo+hex.EncodeToString(raw) {
		return nil, action, errors.New("noncanonical staking original")
	}
	wire, action, err := DecodePQNativeActionTransaction(raw)
	if err != nil {
		return nil, action, err
	}
	if _, err := pqAuthorizedStakingAction(action); err != nil {
		return nil, action, err
	}
	if tx.BlockNum > math.MaxInt64 || tx.Timestamp.IsZero() || tx.Timestamp.Location() != time.UTC || e.ABCITransactionHash != SignedTransactionHash(raw) || !reflect.DeepEqual(tx, stakingHistoryTransaction(action, raw, wire, int64(tx.BlockNum), tx.Timestamp, tx.LotFlows)) {
		return nil, action, errors.New("staking original execution fields differ from signed action")
	}
	return wire, action, nil
}

func pqStakingFeeHash(s CommittedState, hash string) bool {
	for _, entry := range s.PQHistory {
		if entry.ABCITransactionHash == hash && isPQStakingHistory(entry.Transaction) {
			return true
		}
	}
	return false
}

// Replays the original business records from their actual PQ creation. Classic
// staking effects keep their old hashes and cannot supply an implicit baseline.
// The replay account is a local arithmetic accumulator only;
// it grants no live funds and is never written into the committed ledger.
func replayStakingAuthorization(record BFTStakeDelegation, policy *ynxauth.State, chainID int64, active func(string) bool) (executionState, []verifiedStakingAuthorization, error) {
	events, err := decodeStakingAuthorizations(record.AuthorizationHistory)
	if err != nil {
		return executionState{}, nil, err
	}
	replay := executionState{accounts: []chain.ConsensusAccount{{Address: record.Delegator, Balance: math.MaxInt64}}}
	verified := make([]verifiedStakingAuthorization, 0, len(events))
	cache := chain.NewPQCertificateCache()
	var previousHeight int64
	var previousNonce uint64
	for i, event := range events {
		if event.Height <= 0 || event.Height < previousHeight || event.At.IsZero() || event.At.Location() != time.UTC {
			return executionState{}, nil, errors.New("staking original chronology is invalid")
		}
		v := verifiedStakingAuthorization{stakingAuthorization: event, Hash: SignedTransactionHash(event.Transport)}
		kind, err := TransactionEnvelopeType(event.Transport)
		if err != nil {
			return executionState{}, nil, err
		}
		if kind == PQActionType {
			v.PQ = true
			v.Wire, v.Action, err = DecodePQNativeActionTransaction(event.Transport)
			if err != nil {
				return executionState{}, nil, err
			}
			v.auth, err = pqAuthorizedStakingAction(v.Action)
			if err != nil {
				return executionState{}, nil, err
			}
			if policy == nil || v.Action.NativeChainID != uint64(chainID) || !bytes.Equal(v.Action.ChainID, policy.NetworkID) {
				return executionState{}, nil, errors.New("staking original network or policy mismatch")
			}
			member, err := ynxbatch.DecodeMember(v.Wire)
			if err != nil {
				return executionState{}, nil, err
			}
			if err := cache.VerifyDecodedMember(policy, v.Action.Owner, ynxauth.TransactionPurpose, member.Message, member, uint64(event.Height)); err != nil {
				return executionState{}, nil, err
			}
			v.Nonce = v.Action.Nonce
		} else {
			return executionState{}, nil, errors.New("PQ staking history cannot invent a classic checkpoint witness")
		}
		if v.auth.Signer != record.Delegator || v.Nonce <= previousNonce || i == 0 && v.auth.Action != ActionStakeDelegate {
			return executionState{}, nil, errors.New("staking original owner, creation or nonce mismatch")
		}
		id, err := stakingActionDelegation(replay, v.auth)
		if err != nil || id != record.ID {
			return executionState{}, nil, errors.New("staking original targets another delegation")
		}
		replay, _, err = applyAuthorizedStakingBusiness(replay, v.auth, v.Hash, event.Height, event.At, false, active)
		if err != nil {
			return executionState{}, nil, err
		}
		if err := appendStakingAuthorization(&replay, id, i != 0, event.Transport, event.Height, event.At); err != nil {
			return executionState{}, nil, err
		}
		previousHeight, previousNonce = event.Height, v.Nonce
		verified = append(verified, v)
	}
	if len(replay.stakeDelegations) != 1 || !reflect.DeepEqual(replay.stakeDelegations[0], record) {
		return executionState{}, nil, errors.New("staking delegation differs from original signed business replay")
	}
	return replay, verified, nil
}

func validateConsensusPQStaking(s CommittedState, m chain.ConsensusMigrationState) error {
	active := func(address string) bool {
		for _, v := range m.Validators {
			if v.Address == address && v.Active {
				return true
			}
		}
		return false
	}
	feeRecipient := ""
	for _, v := range m.Validators {
		if v.Active {
			feeRecipient = v.Address
			break
		}
	}
	entries := map[string]PQCommittedAuthorization{}
	for _, e := range s.PQHistory {
		if isPQStakingHistory(e.Transaction) {
			if _, duplicate := entries[e.ABCITransactionHash]; duplicate {
				return errors.New("duplicate PQ staking original")
			}
			if _, _, err := decodePQStakingHistory(e); err != nil {
				return err
			}
			entries[e.ABCITransactionHash] = e
		}
	}
	seen, nonces := map[string]bool{}, map[string]map[uint64]bool{}
	for _, record := range s.StakeDelegations {
		if record.AuthorizationHistory == "" {
			continue
		}
		if s.Version < CommittedStateVersion {
			return errors.New("historical state cannot acquire PQ staking effects")
		}
		replay, originals, err := replayStakingAuthorization(record, s.AccountPolicy, s.ChainID, active)
		if err != nil {
			return err
		}
		var actual []BFTUnbondingEntry
		for _, e := range s.Unbondings {
			if e.DelegationID == record.ID {
				actual = append(actual, e)
			}
		}
		if !reflect.DeepEqual(actual, replay.unbondings) {
			return errors.New("queued or withdrawn staking entries differ from original replay")
		}
		for _, original := range originals {
			if original.Height <= int64(m.Height) || original.Height > s.Height || seen[original.Hash] {
				return errors.New("staking original height or replay mismatch")
			}
			seen[original.Hash] = true
			owner := original.auth.Signer
			if nonces[owner] == nil {
				nonces[owner] = map[uint64]bool{}
			}
			if nonces[owner][original.Nonce] {
				return errors.New("staking original owner nonce reused")
			}
			nonces[owner][original.Nonce] = true
			i, ok := accountIndex(s.Accounts, owner)
			if !ok || s.Accounts[i].Nonce < original.Nonce {
				return errors.New("staking original nonce not consumed")
			}
			feeType := original.auth.Action
			if original.PQ {
				feeType = PQActionType
			}
			wantFee := newCurrentFeeEvent(original.Hash, feeType, owner, feeRecipient, 1, original.Height, original.At)
			feeCount := 0
			for _, fee := range s.FeeEvents {
				if fee.TxHash == original.Hash {
					feeCount++
					if fee != wantFee {
						return errors.New("staking original fee differs from actual execution")
					}
				}
			}
			if feeCount != 1 {
				return errors.New("staking original requires one exact fee event")
			}
			if original.PQ {
				entry, exists := entries[original.Hash]
				if !exists || !reflect.DeepEqual(entry.Transaction, stakingHistoryTransaction(original.Action, original.Transport, original.Wire, original.Height, original.At, entry.Transaction.LotFlows)) {
					return errors.New("staking record lacks its exact original PQ proof")
				}
				if err := validatePQActionFee(entry, pqActionEffects{FeeRecipient: feeRecipient, Fee: &wantFee, TraceLots: s.TraceLots}); err != nil {
					return err
				}
			}
		}
	}
	for hash := range entries {
		if !seen[hash] {
			return errors.New("PQ staking proof has no complete original delegation history")
		}
	}
	// Once an owner has entered its active PQ sequence, every successful action
	// is present in PQHistory, including transfers, rotations and revocations.
	// A genuinely pending first registration can still precede classic nonces.
	last, activeSequence := map[string]uint64{}, map[string]bool{}
	for owner := range nonces {
		if i, ok := accountIndex(m.Accounts, owner); ok {
			last[owner] = m.Accounts[i].Nonce
		}
		if m.AccountPolicy != nil && m.Height < math.MaxUint64 {
			_, bound := m.AccountPolicy.PolicyAt(owner, m.Height+1)
			activeSequence[owner] = bound && m.AccountPolicy.RequireLegacy(owner, m.Height+1) != nil
		}
	}
	for _, e := range s.PQHistory {
		tx := e.Transaction
		if nonces[tx.From] == nil {
			continue
		}
		if tx.Nonce <= last[tx.From] || activeSequence[tx.From] && (last[tx.From] == math.MaxUint64 || tx.Nonce != last[tx.From]+1) {
			return errors.New("PQ staking owner nonce history changed")
		}
		last[tx.From] = tx.Nonce
		if tx.Type != PQMigrationType || s.AccountPolicy.RequireLegacy(tx.From, tx.BlockNum) != nil {
			activeSequence[tx.From] = true
		}
	}
	for owner, nonce := range last {
		i, ok := accountIndex(s.Accounts, owner)
		if !ok || s.Accounts[i].Nonce != nonce {
			return errors.New("PQ staking final nonce differs from complete original history")
		}
	}
	return nil
}

func pqActionStakingEffectsFor(s CommittedState, hash string) (*pqActionStakingEffects, error) {
	for _, record := range s.StakeDelegations {
		if record.AuthorizationHistory == "" {
			continue
		}
		originals, err := decodeStakingAuthorizations(record.AuthorizationHistory)
		if err != nil {
			return nil, err
		}
		for _, original := range originals {
			if SignedTransactionHash(original.Transport) != hash {
				continue
			}
			e := &pqActionStakingEffects{Delegation: record}
			for _, entry := range s.Unbondings {
				if entry.DelegationID == record.ID {
					e.Unbondings = append(e.Unbondings, entry)
				}
			}
			return e, nil
		}
	}
	return nil, errors.New("staking original has no committed delegation effects")
}

func validatePQActionStaking(entry PQCommittedAuthorization, effects pqActionStakingEffects, auth PQWalletAccountView) error {
	// Membership here is an observation from the configured RPC, not a light
	// proof. The producer first verifies it against its real migration validators;
	// the consumer still replays every original signature and business effect.
	replay, originals, err := replayStakingAuthorization(effects.Delegation, auth.Policy, auth.NativeChainID, func(v string) bool { return v == effects.Delegation.Validator })
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(replay.unbondings, effects.Unbondings) {
		return errors.New("staking query unbondings differ from complete original replay")
	}
	if _, _, err := decodePQStakingHistory(entry); err != nil {
		return err
	}
	found := 0
	for _, original := range originals {
		if original.Height > auth.CommittedHeight || original.Nonce > auth.LedgerNonce || original.auth.Signer != auth.Owner {
			return errors.New("staking query original exceeds committed owner view")
		}
		if original.Hash == entry.ABCITransactionHash {
			if !original.PQ || !reflect.DeepEqual(entry.Transaction, stakingHistoryTransaction(original.Action, original.Transport, original.Wire, original.Height, original.At, entry.Transaction.LotFlows)) {
				return errors.New("staking query original differs from execution identity")
			}
			found++
		}
	}
	if found != 1 {
		return errors.New("staking query needs its unique original authorization")
	}
	return nil
}
