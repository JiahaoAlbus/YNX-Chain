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
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const pqNativeActionHistoryMemo = "ynx-abci-pq-native-action-v1:"

// EncodePQNativeActionTransaction carries the existing native Action Member;
// it does not sign a JSON surrogate or grant a reusable authorization token.
// Each kind is enabled only with its actual executor and restore validator.
func EncodePQNativeActionTransaction(wire []byte) ([]byte, error) {
	if len(wire) == 0 || len(wire) > chain.MaxPQActionMemberBytes {
		return nil, errors.New("PQ native action member size is invalid")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return nil, err
	}
	action, err := ynxauth.DecodeAction(member.Message)
	if err != nil {
		return nil, err
	}
	if action.Kind != ynxauth.ActionStake && action.Kind != ynxauth.ActionResourceDelegate && action.Kind != ynxauth.ActionResourceRent && !isDexAction(action.Kind) && !isStakingAction(action.Kind) {
		return nil, errors.New("ABCI native action executor is not enabled for this kind")
	}
	return json.Marshal(PQTransaction{Version: 1, Type: PQActionType, WireHex: hex.EncodeToString(wire)})
}

func DecodePQNativeActionTransaction(raw []byte) ([]byte, ynxauth.Action, error) {
	var e PQTransaction
	var action ynxauth.Action
	if len(raw) == 0 || len(raw) > 2*chain.MaxPQActionMemberBytes+256 {
		return nil, action, errors.New("PQ native action transport size is invalid")
	}
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, action, err
	}
	wire, err := hex.DecodeString(e.WireHex)
	if err != nil || e.Version != 1 || e.Type != PQActionType || e.WireHex != hex.EncodeToString(wire) {
		return nil, action, errors.New("noncanonical PQ native action envelope")
	}
	canonical, err := EncodePQNativeActionTransaction(wire)
	if err != nil || !bytes.Equal(canonical, raw) {
		return nil, action, errors.New("noncanonical or unsupported PQ native action transport")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return nil, action, err
	}
	action, err = ynxauth.DecodeAction(member.Message)
	return wire, action, err
}

// Both routes verify the original Member themselves against the exact current
// owner policy and height. Routing is not an authorization decision.
func (a *Application) applyPQActionTransaction(state executionState, raw []byte, height int64, at time.Time) (executionState, transactionExecution, error) {
	var e PQTransaction
	if len(raw) == 0 || len(raw) > MaxPQContractTransactionBytes || json.Unmarshal(raw, &e) != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("invalid PQ action envelope"))
	}
	wire, err := hex.DecodeString(e.WireHex)
	if err != nil || len(wire) > chain.MaxPQActionMemberBytes {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("invalid PQ action member"))
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	action, err := ynxauth.DecodeAction(member.Message)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if action.Kind == ynxauth.ActionContractDeploy || action.Kind == ynxauth.ActionContractExecute {
		return a.applyPQContractAction(state, raw, height, at)
	}
	if action.Kind == ynxauth.ActionResourceDelegate || action.Kind == ynxauth.ActionResourceRent {
		return a.applyPQResourceAction(state, raw, height, at)
	}
	if isDexAction(action.Kind) {
		return a.applyPQDexAction(state, raw, height, at)
	}
	if isStakingAction(action.Kind) {
		return a.applyPQStakingAction(state, raw, height, at)
	}
	return a.applyPQNativeAction(state, raw, height, at)
}

func (a *Application) applyPQNativeAction(state executionState, raw []byte, height int64, at time.Time) (executionState, transactionExecution, error) {
	fail := func(err error) (executionState, transactionExecution, error) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	wire, action, err := DecodePQNativeActionTransaction(raw)
	if err != nil {
		return fail(err)
	}
	if height <= 0 || state.accountPolicy == nil || action.NativeChainID != uint64(a.migration.Network.ChainID) || !bytes.Equal(action.ChainID, state.accountPolicy.NetworkID) {
		return fail(errors.New("PQ native action requires actual network, policy and execution height"))
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return fail(err)
	}
	if err = a.pqCertificateCache.VerifyDecodedMember(state.accountPolicy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, uint64(height)); err != nil {
		return fail(err)
	}
	nativeHash, abciHash := SignedTransactionHash(wire), SignedTransactionHash(raw)
	for _, prior := range state.pqHistory {
		if prior.Transaction.Hash == nativeHash || prior.ABCITransactionHash == abciHash {
			return fail(errors.New("PQ native original authorization already executed"))
		}
	}
	index, ok := accountIndex(state.accounts, action.Owner)
	if !ok || state.accounts[index].Nonce == math.MaxUint64 || action.Nonce != state.accounts[index].Nonce+1 {
		return fail(errors.New("PQ native action requires exact next owner nonce"))
	}
	value, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if err != nil {
		return fail(err)
	}
	if action.Kind != ynxauth.ActionStake || action.Fee != 0 {
		return fail(errors.New("unsupported native execution or stake fee"))
	}
	amount := int64(value.(ynxauth.StakePayload).Amount)
	account := state.accounts[index]
	if account.Balance < amount || account.Staked < 0 || account.Staked > math.MaxInt64-amount || account.ResourceUsage.ComputeUsed < 0 || account.ResourceUsage.ComputeUsed == math.MaxInt64 {
		return fail(errors.New("PQ stake balance or resource capacity is insufficient"))
	}
	// Native stake has fee zero, no bandwidth charge and one compute unit.
	// The existing account's lot lineage remains where the legacy stake keeps
	// it; staking does not invent a transfer to a synthetic fee recipient.
	state.accounts = cloneAccounts(state.accounts)
	state.accounts[index].Balance -= amount
	state.accounts[index].Staked += amount
	state.accounts[index].Nonce = action.Nonce
	state.accounts[index].ResourceUsage.ComputeUsed++
	if at.IsZero() {
		at = time.Unix(height, 0)
	}
	tx := chain.Transaction{Hash: nativeHash, Type: "stake", From: action.Owner, To: "ynx_staking", Amount: amount, Nonce: action.Nonce, BlockNum: uint64(height), Timestamp: at.UTC(), Memo: pqNativeActionHistoryMemo + hex.EncodeToString(raw)}
	state.pqHistory = append(clonePQHistory(state.pqHistory), PQCommittedAuthorization{ABCITransactionHash: abciHash, Transaction: tx})
	return state, transactionExecution{typeName: PQActionType, hash: abciHash, event: abcitypes.Event{Type: "ynx.pq_native_action", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: action.Kind, Index: true}, {Key: "owner", Value: action.Owner, Index: true}, {Key: "native_hash", Value: nativeHash, Index: true}}}}, nil
}

func isPQNativeActionHistory(tx chain.Transaction) bool {
	return strings.HasPrefix(tx.Memo, pqNativeActionHistoryMemo)
}

func decodePQNativeActionHistory(entry PQCommittedAuthorization) ([]byte, ynxauth.Action, error) {
	tx := entry.Transaction
	var action ynxauth.Action
	if !isPQNativeActionHistory(tx) || len(tx.Memo) > 4*chain.MaxPQActionMemberBytes+1024 {
		return nil, action, errors.New("missing or oversized PQ native history")
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, pqNativeActionHistoryMemo))
	if err != nil || tx.Memo != pqNativeActionHistoryMemo+hex.EncodeToString(raw) {
		return nil, action, errors.New("noncanonical PQ native history bytes")
	}
	wire, action, err := DecodePQNativeActionTransaction(raw)
	if err != nil {
		return nil, action, err
	}
	value, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if err != nil {
		return nil, action, err
	}
	if action.Kind != ynxauth.ActionStake {
		return nil, action, errors.New("non-stake action in stake history")
	}
	expected := chain.Transaction{Hash: SignedTransactionHash(wire), Type: "stake", From: action.Owner, To: "ynx_staking", Amount: int64(value.(ynxauth.StakePayload).Amount), Nonce: action.Nonce, BlockNum: tx.BlockNum, Timestamp: tx.Timestamp, Memo: tx.Memo}
	if action.Fee != 0 || entry.ABCITransactionHash != SignedTransactionHash(raw) || tx.Timestamp.IsZero() || tx.Timestamp.Location() != time.UTC || !reflect.DeepEqual(tx, expected) {
		return nil, action, errors.New("PQ native history differs from its original exact execution fields")
	}
	return wire, action, nil
}

// This supplies the resource validator's exact stake equation. It is not a
// standalone authorization: CommittedState.Validate must also call the full
// original-proof validator below before any state can be persisted or restored.
func pqNativeStakeContributions(s CommittedState) (map[string]int64, error) {
	amounts := map[string]int64{}
	for _, entry := range s.PQHistory {
		if !isPQNativeActionHistory(entry.Transaction) {
			continue
		}
		_, action, err := decodePQNativeActionHistory(entry)
		if err != nil {
			return nil, err
		}
		amount := entry.Transaction.Amount
		if amount <= 0 || amounts[action.Owner] > math.MaxInt64-amount {
			return nil, errors.New("PQ native stake contribution overflows")
		}
		amounts[action.Owner] += amount
	}
	return amounts, nil
}

func validateConsensusPQNativeActions(s CommittedState, m chain.ConsensusMigrationState) error {
	cache := chain.NewPQCertificateCache()
	counts, first, lastNonce := map[string]int64{}, map[string]uint64{}, map[string]uint64{}
	seen := map[string]bool{}
	for _, entry := range s.PQHistory {
		tx := entry.Transaction
		if !isPQNativeActionHistory(tx) {
			continue
		}
		wire, action, err := decodePQNativeActionHistory(entry)
		if err != nil {
			return err
		}
		if s.AccountPolicy == nil || action.NativeChainID != uint64(s.ChainID) || !bytes.Equal(action.ChainID, s.AccountPolicy.NetworkID) || tx.BlockNum <= m.Height || tx.BlockNum > uint64(s.Height) || seen[entry.ABCITransactionHash] {
			return errors.New("PQ native history network, height or replay mismatch")
		}
		member, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			return err
		}
		if err = cache.VerifyDecodedMember(s.AccountPolicy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum); err != nil {
			return err
		}
		seen[entry.ABCITransactionHash] = true
		if counts[action.Owner] == math.MaxInt64 {
			return errors.New("PQ native resource count overflows")
		}
		counts[action.Owner]++
		if first[action.Owner] == 0 {
			first[action.Owner] = tx.BlockNum
			if i, ok := accountIndex(m.Accounts, action.Owner); ok {
				lastNonce[action.Owner] = m.Accounts[i].Nonce
			}
		}
	}
	for _, entry := range s.PQHistory {
		tx := entry.Transaction
		if _, tracked := counts[tx.From]; !tracked {
			continue
		}
		if tx.Nonce <= lastNonce[tx.From] {
			return errors.New("PQ native owner authorization nonce regressed or repeated")
		}
		lastNonce[tx.From] = tx.Nonce
		if isPQContractHistory(tx) {
			compute := int64(1)
			if tx.Type == "contract_deploy" {
				compute = 5
			}
			if counts[tx.From] > math.MaxInt64-compute {
				return errors.New("PQ native plus contract resource usage overflows")
			}
			counts[tx.From] += compute
			if tx.BlockNum < first[tx.From] {
				first[tx.From] = tx.BlockNum
			}
		}
	}
	for owner := range counts {
		index, ok := accountIndex(s.Accounts, owner)
		if !ok || s.Accounts[index].Nonce < lastNonce[owner] {
			return errors.New("PQ native final owner or nonce is missing")
		}
	}
	for _, event := range s.FeeEvents {
		if seen[event.TxHash] {
			return errors.New("fee-zero PQ native stake acquired an unexecuted fee event")
		}
	}
	return nil
}
