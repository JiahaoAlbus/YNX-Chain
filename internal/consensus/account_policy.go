package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const (
	PQTransferType        = "pq_transfer"
	PQMigrationType       = "account_migration"
	PQRevocationType      = "account_revocation"
	MaxPQTransactionBytes = 2*ynxauth.MaxMigrationBytes + 256
	pqTransferMemo        = "ynx-pq-transfer-v1:"
	pqMigrationMemo       = "ynx-pq-migration-v1:"
	pqRevocationMemo      = "ynx-pq-revocation-v1:"
)

// PQTransaction is the canonical ABCI transport for the existing signed native
// authorization wire. It introduces no new signature domain or alternate proof.
// The Comet transaction hash covers this JSON; native proof identity covers wire.
type PQTransaction struct {
	Version int    `json:"version"`
	Type    string `json:"type"`
	WireHex string `json:"wireHex"`
}

type PQCommittedAuthorization struct {
	ABCITransactionHash string            `json:"abciTransactionHash"`
	Transaction         chain.Transaction `json:"transaction"`
}

func EncodePQTransaction(kind string, wire []byte) ([]byte, error) {
	limit := ynxauth.MaxMigrationBytes
	if kind == PQWholeType {
		limit = chain.MaxPQBatchBytes
	}
	if kind != PQTransferType && kind != PQMigrationType && kind != PQRevocationType && kind != PQWholeType || len(wire) == 0 || len(wire) > limit || kind == PQRevocationType && len(wire) > ynxauth.MaxRevocationBytes {
		return nil, errors.New("unsupported or oversized ABCI PQ authorization")
	}
	return json.Marshal(PQTransaction{Version: 1, Type: kind, WireHex: hex.EncodeToString(wire)})
}

func DecodePQTransaction(payload []byte) (PQTransaction, []byte, error) {
	var tx PQTransaction
	if len(payload) == 0 || len(payload) > MaxPQWholeTransactionBytes {
		return tx, nil, errors.New("ABCI PQ envelope size is invalid")
	}
	d := json.NewDecoder(bytes.NewReader(payload))
	d.DisallowUnknownFields()
	if err := d.Decode(&tx); err != nil {
		return tx, nil, err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return tx, nil, errors.New("trailing ABCI PQ envelope")
	}
	wire, err := hex.DecodeString(tx.WireHex)
	if err != nil || tx.Version != 1 || hex.EncodeToString(wire) != tx.WireHex {
		return tx, nil, errors.New("noncanonical ABCI PQ wire")
	}
	canonical, err := EncodePQTransaction(tx.Type, wire)
	if err != nil || !bytes.Equal(canonical, payload) {
		return tx, nil, errors.New("noncanonical ABCI PQ envelope")
	}
	return tx, wire, nil
}

func cloneConsensusAccountPolicy(s *ynxauth.State) *ynxauth.State {
	if s == nil {
		return nil
	}
	copy := s.Clone()
	return &copy
}

func sameConsensusPolicy(a, b *ynxauth.State) bool { return reflect.DeepEqual(a, b) }

func requireConsensusLegacy(policy *ynxauth.State, owner string, height int64) error {
	if policy == nil {
		return nil
	}
	if height <= 0 {
		return errors.New("account authorization requires actual next execution height")
	}
	return policy.RequireLegacy(owner, uint64(height))
}

func (a *Application) applyPQTransaction(state executionState, payload []byte, height int64, blockTime time.Time) (executionState, transactionExecution, error) {
	fail := func(err error) (executionState, transactionExecution, error) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if state.accountPolicy == nil || height <= 0 {
		return fail(errors.New("ABCI PQ admission requires persisted policy and execution height"))
	}
	envelope, wire, err := DecodePQTransaction(payload)
	if err != nil {
		return fail(err)
	}
	if envelope.Type == PQWholeType {
		return a.applyPQWhole(state, payload, wire, height, blockTime)
	}
	nativeHash, abciHash := SignedTransactionHash(wire), SignedTransactionHash(payload)
	for _, prior := range state.pqHistory {
		if prior.Transaction.Hash == nativeHash {
			return fail(errors.New("PQ authorization already executed"))
		}
	}
	var tx chain.Transaction
	var executed transactionExecution
	if envelope.Type == PQTransferType {
		member, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			return fail(err)
		}
		transfer, err := ynxauth.DecodeTransfer(member.Message)
		if err != nil {
			return fail(err)
		}
		if transfer.NativeChainID != uint64(a.migration.Network.ChainID) || !bytes.Equal(transfer.ChainID, state.accountPolicy.NetworkID) || transfer.Fee != uint64(SignedTransactionFeeYNXT) {
			return fail(errors.New("PQ transfer network or fee mismatch"))
		}
		if err := a.pqCertificateCache.VerifyDecodedMember(state.accountPolicy, transfer.From, ynxauth.TransactionPurpose, member.Message, member, uint64(height)); err != nil {
			return fail(err)
		}
		native := SignedTransaction{Version: SignedTransactionVersion, ChainID: a.migration.Network.ChainID, Type: SignedTransactionType, From: transfer.From, To: transfer.To, Amount: int64(transfer.Amount), Fee: int64(transfer.Fee), Nonce: transfer.Nonce}
		state, executed, err = a.applyAuthorizedTransfer(state, native, abciHash, height, blockTime)
		if err != nil {
			return executionState{}, transactionExecution{}, err
		}
		tx = chain.Transaction{Hash: nativeHash, Type: SignedTransactionType, From: native.From, To: native.To, Amount: native.Amount, Fee: native.Fee, Nonce: native.Nonce, Memo: pqTransferMemo + envelope.WireHex}
	} else if envelope.Type == PQMigrationType {
		migration, err := ynxauth.DecodeMigration(wire)
		if err != nil {
			return fail(err)
		}
		index, ok := accountIndex(state.accounts, migration.Intent.Owner)
		if !ok {
			return fail(errors.New("PQ migration account does not exist"))
		}
		next, err := state.accountPolicy.AdmitMigration(migration, uint64(height), state.accounts[index].Nonce)
		if err != nil {
			return fail(err)
		}
		state.accounts = cloneAccounts(state.accounts)
		charge := SignedApplicationAction{Signer: migration.Intent.Owner, Nonce: migration.Intent.LedgerNonce, Fee: 1}
		if err := a.chargeApplicationAction(&state, charge); err != nil {
			return executionState{}, transactionExecution{}, err
		}
		state.accountPolicy = &next
		state.feeEvents = append(state.feeEvents, newCurrentFeeEvent(abciHash, PQMigrationType, migration.Intent.Owner, a.feeRecipient, 1, height, blockTime))
		tx = chain.Transaction{Hash: nativeHash, Type: PQMigrationType, From: migration.Intent.Owner, To: migration.Intent.Owner, Fee: 1, Nonce: migration.Intent.LedgerNonce, Memo: pqMigrationMemo + envelope.WireHex}
		executed = transactionExecution{typeName: PQMigrationType, hash: abciHash, event: abcitypes.Event{Type: "ynx.account_migration", Attributes: []abcitypes.EventAttribute{{Key: "owner", Value: tx.From, Index: true}, {Key: "revision", Value: fmt.Sprint(migration.Intent.NewRevision)}}}}
	} else {
		state, tx, executed, err = a.applyPQRevocation(state, wire, nativeHash, abciHash, height, blockTime)
		if err != nil {
			return fail(err)
		}
	}
	tx.BlockNum, tx.Timestamp = uint64(height), blockTime.UTC()
	state.pqHistory = append(clonePQHistory(state.pqHistory), PQCommittedAuthorization{ABCITransactionHash: abciHash, Transaction: tx})
	return state, executed, nil
}

func validateConsensusPQState(state CommittedState, migration chain.ConsensusMigrationState) error {
	cache := chain.NewPQCertificateCache()
	if state.Version < 15 && (state.AccountPolicy != nil || len(state.PQHistory) != 0 || len(state.PQBatches) != 0 || migration.AccountPolicy != nil) {
		return errors.New("legacy ABCI state cannot carry or erase account policy")
	}
	if migration.AccountPolicy == nil && state.AccountPolicy != nil {
		return errors.New("ABCI account policy activation requires an authenticated migration schedule")
	}
	if err := chain.ValidateConsensusAccountPolicyContinuation(migration.AccountPolicy, state.AccountPolicy); err != nil {
		return err
	}
	if !state.Initialized && (!sameConsensusPolicy(state.AccountPolicy, migration.AccountPolicy) || len(state.PQHistory) != 0 || len(state.PQBatches) != 0) {
		return errors.New("uninitialized ABCI policy differs from migration anchor")
	}
	if state.AccountPolicy == nil {
		if len(state.PQHistory) != 0 || len(state.PQBatches) != 0 {
			return errors.New("PQ history without account policy")
		}
		for _, event := range state.FeeEvents {
			if event.TransactionType == PQRevocationType {
				return errors.New("ABCI revocation fee event without account policy")
			}
		}
		return nil
	}
	network, err := hex.DecodeString(migration.OriginalGenesisHash)
	if err != nil || state.AccountPolicy.Validate(network) != nil {
		return errors.New("ABCI account policy genesis mismatch")
	}
	type key struct {
		owner    string
		revision uint64
	}
	known := map[key]bool{}
	for _, r := range migration.AccountPolicy.Records {
		known[key{r.Owner, r.Revision}] = true
	}
	proofs := map[key]int{}
	knownRevocations := map[string]bool{}
	for _, r := range migration.AccountPolicy.Revocations {
		knownRevocations[r.Owner] = true
	}
	revocationProofs := map[string]int{}
	revocationTransactions := map[string]bool{}
	seen := map[string]bool{}
	previousHeight := migration.Height
	for _, entry := range state.PQHistory {
		tx := entry.Transaction
		// These fields are never produced by the ABCI PQ executors. A valid
		// signature over a migration/transfer/revocation cannot grant sponsorship,
		// mint resource usage or manufacture source-chain receipts on restore.
		if tx.BlockHash != "" || len(tx.Logs) != 0 || tx.Sponsor != "" || tx.SponsorPoolID != "" || tx.ResourceSource != "" || tx.ResourceType != "" || tx.ResourceConsumed != 0 || tx.ActionReference != "" || tx.Type != PQRevocationType && !isPQContractHistory(tx) && len(tx.LotFlows) != 0 {
			return errors.New("ABCI PQ history contains unexecuted receipt or resource metadata")
		}
		if tx.BlockNum <= migration.Height || tx.BlockNum < previousHeight || tx.BlockNum > uint64(state.Height) || seen[tx.Hash] {
			return errors.New("invalid ABCI PQ history height or replay")
		}
		previousHeight, seen[tx.Hash] = tx.BlockNum, true
		// Contract history has its own complete signed intent, code/prestate,
		// execution and trace-lot validator in CommittedState.Validate. Keep the
		// common metadata, height and replay gates above for every contract too.
		if isPQContractHistory(tx) || isPQNativeActionHistory(tx) {
			continue
		}
		if strings.HasPrefix(tx.Memo, pqBatchMemberMemoPrefix) {
			continue
		}
		if err := chain.ValidateConsensusHistoricalPQTransactionWithCache(tx, state.AccountPolicy, tx.BlockNum, state.ChainID, cache); err != nil {
			return err
		}
		kind, memo := PQTransferType, pqTransferMemo
		if tx.Type == PQMigrationType {
			kind, memo = PQMigrationType, pqMigrationMemo
		} else if tx.Type == PQRevocationType {
			kind, memo = PQRevocationType, pqRevocationMemo
		}
		if !strings.HasPrefix(tx.Memo, memo) {
			return errors.New("unrecognized ABCI PQ history envelope")
		}
		wire, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, memo))
		if err != nil {
			return err
		}
		payload, err := EncodePQTransaction(kind, wire)
		if err != nil || SignedTransactionHash(payload) != entry.ABCITransactionHash {
			return errors.New("ABCI PQ transport hash mismatch")
		}
		if kind == PQMigrationType {
			m, err := ynxauth.DecodeMigration(wire)
			if err != nil {
				return err
			}
			id := key{m.Intent.Owner, m.Intent.NewRevision}
			proofs[id]++
			if known[id] || proofs[id] != 1 {
				return errors.New("duplicate ABCI registration evidence")
			}
		} else if kind == PQRevocationType {
			revocationTransactions[entry.ABCITransactionHash] = true
			revocationProofs[tx.From]++
			if knownRevocations[tx.From] || revocationProofs[tx.From] != 1 {
				return errors.New("duplicate ABCI revocation evidence")
			}
			if err := validateConsensusRevocationEffects(state, migration, entry); err != nil {
				return err
			}
		}
	}
	for _, r := range state.AccountPolicy.Records {
		if r.RegisteredAt > uint64(state.Height) || (!known[key{r.Owner, r.Revision}] && proofs[key{r.Owner, r.Revision}] != 1) {
			return errors.New("ABCI registration lacks its committed migration evidence")
		}
	}
	for _, r := range state.AccountPolicy.Revocations {
		if r.RegisteredAt > uint64(state.Height) || (!knownRevocations[r.Owner] && revocationProofs[r.Owner] != 1) {
			return errors.New("ABCI revocation lacks its committed original proof")
		}
	}
	if err := validateConsensusPQBatchesCached(state, migration, cache); err != nil {
		return err
	}
	for _, event := range state.FeeEvents {
		if event.TransactionType == PQRevocationType && !revocationTransactions[event.TxHash] {
			return errors.New("ABCI revocation fee event lacks its original authorization proof")
		}
	}
	return nil
}
