package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const (
	PQWholeType                = "pq_whole"
	MaxPQWholeTransactionBytes = 2*chain.MaxPQBatchBytes + 256
	pqBatchMemberMemoPrefix    = "ynx-pq-batch-member-v1:"
)

// PQCommittedBatch preserves one original Whole and its ordered partial results.
// The actual Comet transaction has one hash; each native effect has the original
// protocol's independent batch/member hash. Neither identity replaces the other.
type PQCommittedBatch struct {
	chain.PQBatchProof
	ABCITransactionHash string `json:"abciTransactionHash"`
}

type PQBatchExecutionResult struct {
	ABCITransactionHash string                      `json:"abciTransactionHash"`
	BatchHash           string                      `json:"batchHash"`
	ExecutionHeight     uint64                      `json:"executionHeight,string"`
	Results             []chain.PQBatchMemberResult `json:"results"`
}

func cloneConsensusPQBatches(input map[string]PQCommittedBatch) map[string]PQCommittedBatch {
	if input == nil {
		return nil
	}
	out := make(map[string]PQCommittedBatch, len(input))
	for hash, proof := range input {
		proof.Whole = bytes.Clone(proof.Whole)
		proof.Results = append([]chain.PQBatchMemberResult(nil), proof.Results...)
		out[hash] = proof
	}
	return out
}

// Only this constructor can create admission. It authenticates both signatures
// and both full trees through the standard verifier against complete trusted
// policy. Its lifetime is one call, and no boolean/caller callback grants trust.
type consensusBatchAdmission struct {
	whole    ynxbatch.Whole
	verifier *ynxbatch.Verifier
	policy   *ynxauth.State
	record   ynxauth.Record
	height   uint64
	chainID  int64
	enableAt uint64
}

func authenticateConsensusBatch(wire []byte, policy *ynxauth.State, height uint64, chainID int64) (*consensusBatchAdmission, error) {
	if len(wire) == 0 || len(wire) > chain.MaxPQBatchBytes || policy == nil || height < policy.EnableAt {
		return nil, errors.New("invalid ABCI Whole size, policy or execution height")
	}
	if err := policy.Validate(policy.NetworkID); err != nil {
		return nil, err
	}
	whole, err := ynxbatch.DecodeWhole(wire)
	if err != nil {
		return nil, err
	}
	cert, err := ynxbatch.EncodeCertificate(whole.Certificate)
	if err != nil {
		return nil, err
	}
	verifier, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: policy.NetworkID, Purpose: ynxauth.TransactionPurpose, CacheEntries: 1, Optimized: true, ResolveTrustedOwner: func(req ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		return policy.TrustedRegistration(req.Owner, ynxauth.TransactionPurpose, req.Height)
	}})
	if err != nil {
		return nil, err
	}
	if err = verifier.VerifyWholeBatch(cert, whole.Messages, height); err != nil {
		verifier.Clear()
		return nil, err
	}
	record, active := policy.PolicyAt(whole.Certificate.Owner, height)
	if !active {
		verifier.Clear()
		return nil, ynxauth.ErrPolicy
	}
	return &consensusBatchAdmission{whole: whole, verifier: verifier, policy: policy, record: record, height: height, chainID: chainID, enableAt: policy.EnableAt}, nil
}

func (a *consensusBatchAdmission) transfer(index uint32) (ynxauth.Transfer, error) {
	if a == nil || a.verifier == nil || a.policy == nil || index >= a.whole.Certificate.N || int(index) >= len(a.whole.Messages) || a.policy.EnableAt != a.enableAt || a.height < a.enableAt || !bytes.Equal(a.policy.NetworkID, a.whole.Certificate.ChainID) || a.whole.Certificate.Purpose != ynxauth.TransactionPurpose {
		return ynxauth.Transfer{}, ynxauth.ErrPolicy
	}
	// Re-resolve eligibility for EVERY member, including revocation and revision;
	// bare PolicyAt is deliberately insufficient to authorize a terminal owner.
	if _, err := a.policy.TrustedRegistration(a.whole.Certificate.Owner, ynxauth.TransactionPurpose, a.height); err != nil {
		return ynxauth.Transfer{}, err
	}
	record, active := a.policy.PolicyAt(a.whole.Certificate.Owner, a.height)
	if !active || !reflect.DeepEqual(record, a.record) || record.AlgorithmVersion != ynxbatch.Version || !bytes.Equal(record.PKA, a.whole.Certificate.PKA) || !bytes.Equal(record.PKB, a.whole.Certificate.PKB) {
		return ynxauth.Transfer{}, ynxauth.ErrPolicy
	}
	transfer, err := ynxauth.DecodeTransfer(a.whole.Messages[index])
	if err != nil {
		return transfer, err
	}
	if transfer.From != a.whole.Certificate.Owner || !bytes.Equal(transfer.ChainID, a.whole.Certificate.ChainID) || transfer.NativeChainID != uint64(a.chainID) || transfer.Fee != uint64(SignedTransactionFeeYNXT) {
		return transfer, errors.New("Whole transfer differs from trusted owner, network or fixed fee")
	}
	return transfer, nil
}

func consensusBatchMemberMemo(hash string, index uint32) string {
	return pqBatchMemberMemoPrefix + hash + ":" + strconv.FormatUint(uint64(index), 10)
}

func parseConsensusBatchMemberMemo(memo string) (string, uint32, error) {
	value := strings.TrimPrefix(memo, pqBatchMemberMemoPrefix)
	if value == memo || len(value) < 68 || value[66] != ':' {
		return "", 0, errors.New("invalid ABCI Whole reference")
	}
	hash := value[:66]
	index, err := strconv.ParseUint(value[67:], 10, 32)
	if err != nil || strconv.FormatUint(index, 10) != value[67:] {
		return "", 0, errors.New("noncanonical ABCI Whole index")
	}
	if _, err = chain.PQBatchTransactionHash(hash, uint32(index)); err != nil {
		return "", 0, err
	}
	return hash, uint32(index), nil
}

// Detach every branch transfer admission can write. All other business modules
// remain untouched. A failed member cannot contaminate the preceding successes
// or its caller, even if a slice happens to have spare backing capacity.
func cloneBatchTransferCandidate(state executionState) executionState {
	state.accounts = cloneAccounts(state.accounts)
	state.traceLots = cloneTraceLots(state.traceLots)
	state.feeEvents = append([]BFTFeeEvent(nil), state.feeEvents...)
	state.nativeTransfers = append([]BFTNativeTransfer(nil), state.nativeTransfers...)
	state.pqHistory = clonePQHistory(state.pqHistory)
	return state
}

func (a *Application) applyPQWhole(state executionState, payload, wire []byte, height int64, blockTime time.Time) (executionState, transactionExecution, error) {
	fail := func(err error) (executionState, transactionExecution, error) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	hash, outerHash := SignedTransactionHash(wire), SignedTransactionHash(payload)
	if _, exists := state.pqBatches[hash]; exists {
		return fail(errors.New("Whole already committed; its rejected members cannot be retried"))
	}
	if a.migration.Runtime != nil {
		if _, exists := a.migration.Runtime.PQBatches[hash]; exists {
			return fail(errors.New("Whole already executed in source history"))
		}
	}
	admission, err := authenticateConsensusBatch(wire, state.accountPolicy, uint64(height), a.migration.Network.ChainID)
	if err != nil {
		return fail(err)
	}
	defer admission.verifier.Clear()
	out := PQBatchExecutionResult{ABCITransactionHash: outerHash, BatchHash: hash, ExecutionHeight: uint64(height), Results: make([]chain.PQBatchMemberResult, len(admission.whole.Messages))}
	admitted := 0
	for i := range out.Results {
		result := chain.PQBatchMemberResult{Index: uint32(i), Outcome: "rejected"}
		transfer, memberErr := admission.transfer(result.Index)
		if memberErr == nil {
			memberHash, hashErr := chain.PQBatchTransactionHash(hash, result.Index)
			memberErr = hashErr
			if memberErr == nil {
				for _, tx := range state.pqHistory {
					if tx.Transaction.Hash == memberHash {
						memberErr = errors.New("Whole member already exists without its proof")
						break
					}
				}
			}
			if memberErr == nil {
				_, _, exists := findPayRecord(state.nativeTransfers, memberHash, func(v BFTNativeTransfer) string { return v.TransactionHash })
				if exists {
					memberErr = errors.New("Whole member receipt already exists without its proof")
				}
			}
			if memberErr == nil {
				native := SignedTransaction{Version: SignedTransactionVersion, ChainID: a.migration.Network.ChainID, Type: SignedTransactionType, From: transfer.From, To: transfer.To, Amount: int64(transfer.Amount), Fee: int64(transfer.Fee), Nonce: transfer.Nonce}
				candidate, _, executionErr := a.applyAuthorizedTransfer(cloneBatchTransferCandidate(state), native, memberHash, height, blockTime)
				memberErr = executionErr
				if memberErr == nil {
					tx := chain.Transaction{Hash: memberHash, Type: SignedTransactionType, From: native.From, To: native.To, Amount: native.Amount, Fee: native.Fee, Nonce: native.Nonce, BlockNum: uint64(height), Timestamp: blockTime.UTC(), Memo: consensusBatchMemberMemo(hash, result.Index)}
					candidate.pqHistory = append(candidate.pqHistory, PQCommittedAuthorization{ABCITransactionHash: outerHash, Transaction: tx})
					state = candidate
					result.Outcome, result.TransactionHash = "admitted", memberHash
					admitted++
				}
			}
		}
		if memberErr != nil {
			result.Error = memberErr.Error()
			if len(result.Error) > 256 {
				result.Error = result.Error[:256]
			}
		}
		out.Results[i] = result
	}
	data, err := json.Marshal(out)
	if err != nil {
		return fail(err)
	}
	if admitted == 0 {
		// Return original per-index rejection data, but no proof or ledger effects.
		return executionState{}, transactionExecution{typeName: PQWholeType, hash: outerHash, resultData: data}, invalidTransaction(CodeInvalidTx, errors.New("Whole contains no admissible transfer; no result or proof was committed"))
	}
	state.pqBatches = cloneConsensusPQBatches(state.pqBatches)
	if state.pqBatches == nil {
		state.pqBatches = make(map[string]PQCommittedBatch)
	}
	state.pqBatches[hash] = PQCommittedBatch{PQBatchProof: chain.PQBatchProof{Whole: bytes.Clone(wire), Height: uint64(height), Results: append([]chain.PQBatchMemberResult(nil), out.Results...)}, ABCITransactionHash: outerHash}
	return state, transactionExecution{typeName: PQWholeType, hash: outerHash, resultData: data, event: abcitypes.Event{Type: "ynx.pq_whole", Attributes: []abcitypes.EventAttribute{{Key: "batch_hash", Value: hash, Index: true}, {Key: "admitted", Value: fmt.Sprint(admitted)}, {Key: "members", Value: fmt.Sprint(len(out.Results))}}}}, nil
}

// Complete proof/ref/effect coverage runs once per Whole at its original height.
// Historical proofs use full policy, including future tombstones; current
// eligibility is rechecked independently when admitting a new transaction.
func validateConsensusPQBatches(state CommittedState, migration chain.ConsensusMigrationState) error {
	refs := make(map[string]map[uint32]PQCommittedAuthorization)
	closed := make(map[string]bool)
	active := ""
	var priorIndex uint32
	for _, entry := range state.PQHistory {
		if !strings.HasPrefix(entry.Transaction.Memo, pqBatchMemberMemoPrefix) {
			if active != "" {
				closed[active] = true
				active = ""
			}
			continue
		}
		hash, index, err := parseConsensusBatchMemberMemo(entry.Transaction.Memo)
		if err != nil {
			return err
		}
		if hash == active {
			if index <= priorIndex {
				return errors.New("Whole member history is not in original index order")
			}
		} else {
			if active != "" {
				closed[active] = true
			}
			if closed[hash] {
				return errors.New("Whole member history was interleaved with another transaction")
			}
			active = hash
		}
		priorIndex = index
		proof, exists := state.PQBatches[hash]
		if !exists || int(index) >= len(proof.Results) {
			return errors.New("ABCI history references missing Whole or index")
		}
		if refs[hash] == nil {
			refs[hash] = make(map[uint32]PQCommittedAuthorization)
		}
		if _, exists = refs[hash][index]; exists {
			return errors.New("duplicate ABCI Whole member history")
		}
		refs[hash][index] = entry
	}
	for hash, proof := range state.PQBatches {
		if hash != SignedTransactionHash(proof.Whole) || proof.Height <= migration.Height || proof.Height > uint64(state.Height) || len(proof.Results) == 0 || len(proof.Results) > ynxbatch.MaxN {
			return errors.New("invalid ABCI Whole proof identity, height or result bound")
		}
		if migration.Runtime != nil {
			if _, exists := migration.Runtime.PQBatches[hash]; exists {
				return errors.New("ABCI Whole duplicates source execution")
			}
		}
		payload, err := EncodePQTransaction(PQWholeType, proof.Whole)
		if err != nil || SignedTransactionHash(payload) != proof.ABCITransactionHash {
			return errors.New("ABCI Whole outer transport hash mismatch")
		}
		admission, err := authenticateConsensusBatch(proof.Whole, state.AccountPolicy, proof.Height, state.ChainID)
		if err != nil {
			return err
		}
		err = validateConsensusBatchCoverage(state, migration, hash, proof, admission, refs[hash])
		admission.verifier.Clear()
		if err != nil {
			return err
		}
	}
	return nil
}

func validateConsensusBatchCoverage(state CommittedState, migration chain.ConsensusMigrationState, batchHash string, proof PQCommittedBatch, admission *consensusBatchAdmission, refs map[uint32]PQCommittedAuthorization) error {
	if len(proof.Results) != len(admission.whole.Messages) {
		return errors.New("Whole result count differs from original messages")
	}
	feeRecipient := ""
	for _, validator := range migration.Validators {
		if validator.Active {
			feeRecipient = validator.Address
			break
		}
	}
	admitted := 0
	var priorNonce uint64
	var timestamp time.Time
	for i, result := range proof.Results {
		if result.Index != uint32(i) || len(result.Error) > 256 {
			return errors.New("Whole result ordering or error bound invalid")
		}
		memberHash, err := chain.PQBatchTransactionHash(batchHash, result.Index)
		if err != nil {
			return err
		}
		entry, exists := refs[result.Index]
		receiptCount, feeCount := 0, 0
		for _, receipt := range state.NativeTransfers {
			if receipt.TransactionHash == memberHash {
				receiptCount++
			}
		}
		for _, fee := range state.FeeEvents {
			if fee.TxHash == memberHash {
				feeCount++
			}
		}
		switch result.Outcome {
		case "rejected":
			if result.TransactionHash != "" || result.Error == "" || exists || receiptCount != 0 || feeCount != 0 {
				return errors.New("rejected Whole member acquired a historical effect")
			}
		case "admitted":
			transfer, err := admission.transfer(result.Index)
			if err != nil {
				return err
			}
			tx := entry.Transaction
			if !exists || result.Error != "" || result.TransactionHash != memberHash || tx.Hash != memberHash || tx.Type != SignedTransactionType || tx.From != transfer.From || tx.To != transfer.To || tx.Amount != int64(transfer.Amount) || tx.Fee != int64(transfer.Fee) || tx.Nonce != transfer.Nonce || tx.BlockNum != proof.Height || entry.ABCITransactionHash != proof.ABCITransactionHash || tx.Timestamp.IsZero() || tx.Timestamp.Location() != time.UTC {
				return errors.New("Whole admission lacks matching original execution")
			}
			if admitted > 0 && (tx.Nonce != priorNonce+1 || !tx.Timestamp.Equal(timestamp)) {
				return errors.New("Whole admitted nonce/time ordering differs from execution")
			}
			priorNonce, timestamp = tx.Nonce, tx.Timestamp
			index, ok := accountIndex(state.Accounts, tx.From)
			if !ok || state.Accounts[index].Nonce < tx.Nonce {
				return errors.New("Whole admission nonce was not consumed")
			}
			expectedReceipt := BFTNativeTransfer{TransactionHash: memberHash, From: tx.From, To: tx.To, Amount: tx.Amount, Fee: tx.Fee, BlockHeight: int64(proof.Height), CommittedAt: tx.Timestamp}
			expectedFee := newCurrentFeeEvent(memberHash, SignedTransactionType, tx.From, feeRecipient, tx.Fee, int64(proof.Height), tx.Timestamp)
			for _, receipt := range state.NativeTransfers {
				if receipt.TransactionHash == memberHash && receipt != expectedReceipt {
					return errors.New("Whole native receipt differs from its signed member")
				}
			}
			for _, fee := range state.FeeEvents {
				if fee.TxHash == memberHash && fee != expectedFee {
					return errors.New("Whole fee receipt differs from its signed member")
				}
			}
			if receiptCount != 1 || feeCount != 1 {
				return errors.New("Whole admission requires exactly one native and fee receipt")
			}
			admitted++
		default:
			return errors.New("unknown Whole business outcome")
		}
	}
	if admitted == 0 || admitted != len(refs) {
		return errors.New("Whole lacks complete admitted transaction coverage")
	}
	return nil
}
