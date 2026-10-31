package consensus

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// Verbatim pre-change coverage logic (only the function identifier is renamed).
// It exercises the real admitted message/authorization path, not a mock ledger.
// Original function SHA256: 551fa1d7ce6615a5207dce01aac012f64c02be55b500eeef50cda88643be55fe
func legacyPQBatchCoverage(state CommittedState, migration chain.ConsensusMigrationState, batchHash string, proof PQCommittedBatch, admission *consensusBatchAdmission, refs map[uint32]PQCommittedAuthorization) error {
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

func pqCoverageFixture(t *testing.T) (*abciRevocationFixture, string, PQCommittedBatch, map[uint32]PQCommittedAuthorization) {
	t.Helper()
	f := activeABCIWholeFixture(t)
	messages := make([][]byte, 16)
	for i := range messages {
		nonce := uint64(i + 1)
		if i == 0 {
			nonce = 2
		}
		if i == 1 {
			nonce = 999
		}
		messages[i] = f.transferMessage(t, false, nonce, 1)
	}
	wire := abciWhole(t, f, messages...)
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), mustPQEnvelope(t, PQWholeType, wire))
	// The second Whole brings actual effects past the indexed-path threshold.
	next := abciWhole(t, f, f.transferMessage(t, false, 17, 1))
	commitSponsorBlock(t, f.a, 4, time.Unix(4, 0).UTC(), mustPQEnvelope(t, PQWholeType, next))
	hash := SignedTransactionHash(wire)
	proof, ok := f.a.committed.PQBatches[hash]
	if !ok || len(proof.Results) != 16 || proof.Results[1].Outcome != "rejected" {
		t.Fatal("real partial Whole fixture did not commit")
	}
	refs := make(map[uint32]PQCommittedAuthorization)
	for _, entry := range f.a.committed.PQHistory {
		batch, index, err := parseConsensusBatchMemberMemo(entry.Transaction.Memo)
		if err == nil && batch == hash {
			refs[index] = entry
		}
	}
	return f, hash, proof, refs
}

func coverageError(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func TestPQBatchCoverageIndexDifferentialAndFirstCause(t *testing.T) {
	f, hash, original, originalRefs := pqCoverageFixture(t)
	admission, err := authenticateConsensusBatch(original.Whole, f.a.committed.AccountPolicy, original.Height, f.a.committed.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	defer admission.verifier.Clear()
	member := original.Results[0].TransactionHash
	rejected, err := chain.PQBatchTransactionHash(hash, 1)
	if err != nil {
		t.Fatal(err)
	}
	mutations := map[string]func(*CommittedState, *PQCommittedBatch, map[uint32]PQCommittedAuthorization){
		"valid": func(*CommittedState, *PQCommittedBatch, map[uint32]PQCommittedAuthorization) {},
		"duplicate-identical-receipt": func(s *CommittedState, _ *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			for _, r := range s.NativeTransfers {
				if r.TransactionHash == member {
					s.NativeTransfers = append(s.NativeTransfers, r)
					break
				}
			}
		},
		"duplicate-wrong-receipt": func(s *CommittedState, _ *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			for _, r := range s.NativeTransfers {
				if r.TransactionHash == member {
					r.Amount++
					s.NativeTransfers = append([]BFTNativeTransfer{r}, s.NativeTransfers...)
					break
				}
			}
		},
		"duplicate-identical-fee": func(s *CommittedState, _ *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			for _, r := range s.FeeEvents {
				if r.TxHash == member {
					s.FeeEvents = append(s.FeeEvents, r)
					break
				}
			}
		},
		"duplicate-wrong-receipt-last": func(s *CommittedState, _ *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			for _, r := range s.NativeTransfers {
				if r.TransactionHash == member {
					r.Amount++
					s.NativeTransfers = append(s.NativeTransfers, r)
					break
				}
			}
		},
		"wrong-receipt-and-fee": func(s *CommittedState, _ *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			for i := range s.NativeTransfers {
				if s.NativeTransfers[i].TransactionHash == member {
					s.NativeTransfers[i].Amount++
				}
			}
			for i := range s.FeeEvents {
				if s.FeeEvents[i].TxHash == member {
					s.FeeEvents[i].GrossFeeYNXT++
				}
			}
		},
		"wrong-fee-before-count": func(s *CommittedState, _ *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			for _, r := range s.FeeEvents {
				if r.TxHash == member {
					r.GrossFeeYNXT++
					s.FeeEvents = append(s.FeeEvents, r)
					break
				}
			}
		},
		"missing-receipt": func(s *CommittedState, _ *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			out := s.NativeTransfers[:0]
			for _, r := range s.NativeTransfers {
				if r.TransactionHash != member {
					out = append(out, r)
				}
			}
			s.NativeTransfers = out
		},
		"rejected-receipt": func(s *CommittedState, _ *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			s.NativeTransfers = append(s.NativeTransfers, BFTNativeTransfer{TransactionHash: rejected})
		},
		"rejected-fee": func(s *CommittedState, _ *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			s.FeeEvents = append(s.FeeEvents, BFTFeeEvent{TxHash: rejected})
		},
		"missing-reference": func(_ *CommittedState, _ *PQCommittedBatch, refs map[uint32]PQCommittedAuthorization) {
			delete(refs, 0)
		},
		"bad-result-order": func(_ *CommittedState, p *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			p.Results[0].Index = 1
		},
		"bad-result-count": func(_ *CommittedState, p *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			p.Results = p.Results[:len(p.Results)-1]
		},
		"unconsumed-nonce": func(s *CommittedState, _ *PQCommittedBatch, _ map[uint32]PQCommittedAuthorization) {
			i, ok := accountIndex(s.Accounts, f.owner)
			if !ok {
				t.Fatal("fixture owner missing")
			}
			s.Accounts[i].Nonce = 0
		},
	}
	stable := mustJSON(t, f.a.committed)
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			s := copyWholeCommittedState(t, f.a.committed)
			proof := s.PQBatches[hash]
			refs := make(map[uint32]PQCommittedAuthorization, len(originalRefs))
			for i, v := range originalRefs {
				refs[i] = v
			}
			mutate(&s, &proof, refs)
			s.PQBatches[hash] = proof
			before := mustJSON(t, s)
			legacy := legacyPQBatchCoverage(s, f.m, hash, proof, admission, refs)
			scan := validateConsensusBatchCoverage(s, f.m, hash, proof, admission, refs)
			indexed := validateConsensusBatchCoverageWithEffects(s, f.m, hash, proof, admission, refs, indexConsensusBatchEffects(s))
			if coverageError(legacy) != coverageError(scan) || coverageError(legacy) != coverageError(indexed) {
				t.Fatalf("coverage first cause differs: legacy=%v scan=%v index=%v", legacy, scan, indexed)
			}
			if name == "valid" && indexed != nil || name != "valid" && indexed == nil {
				t.Fatal("missing original coverage rejection", name, indexed)
			}
			if name == "wrong-receipt-and-fee" && coverageError(indexed) != "Whole native receipt differs from its signed member" {
				t.Fatal("receipt no longer precedes fee/count")
			}
			if name == "wrong-fee-before-count" && coverageError(indexed) != "Whole fee receipt differs from its signed member" {
				t.Fatal("fee no longer precedes duplicate count")
			}
			if !bytes.Equal(before, mustJSON(t, s)) || !bytes.Equal(stable, mustJSON(t, f.a.committed)) {
				t.Fatal("validation changed original or candidate state")
			}
		})
	}
}

func TestPQBatchCoverageIndexActualCommitAndColdRestore(t *testing.T) {
	f, _, _, _ := pqCoverageFixture(t)
	state := f.a.committed
	if len(state.NativeTransfers)+len(state.FeeEvents) < 32 {
		t.Fatal("actual Commit did not exercise the indexed branch")
	}
	original := mustJSON(t, state)
	disk, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	if err = state.validateOwned(f.a.validatedMigration); err != nil {
		t.Fatal(err)
	}
	if err = state.Validate(f.m); err != nil {
		t.Fatal("independent public full validation", err)
	}
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal("normal cold full validation", err)
	}
	after, err := os.ReadFile(f.path)
	if err != nil || !bytes.Equal(disk, after) || !bytes.Equal(original, mustJSON(t, cold.committed)) || cold.committed.AppHash != state.AppHash {
		t.Fatal("indexed validation changed canonical state, AppHash or original disk", err)
	}
	if cold.validatedMigration.historyCertificates == f.a.validatedMigration.historyCertificates || cold.validatedMigration.historyCertificates.Stats().Certificates.Misses == 0 {
		t.Fatal("cold restore borrowed warm math instead of full AND verification")
	}
	bad := copyWholeCommittedState(t, state)
	r := bad.NativeTransfers[0]
	bad.NativeTransfers = append(bad.NativeTransfers, r)
	warmErr, coldErr := bad.validateOwned(f.a.validatedMigration), bad.Validate(f.m)
	if warmErr == nil || coldErr == nil || warmErr.Error() != coldErr.Error() {
		t.Fatal("warm and cold dynamic effect checks differ", warmErr, coldErr)
	}
	// A later height uses the same real retained history and still fully checks
	// policy/authorization. No index survives the preceding call.
	commitSponsorBlock(t, f.a, 5, time.Unix(5, 0).UTC())
	if err = f.a.committed.Validate(f.m); err != nil {
		t.Fatal("next-height state equivalence", err)
	}
}

func TestPQBatchCoverageIndexLocalMeasurement(t *testing.T) {
	f, hash, proof, refs := pqCoverageFixture(t)
	admission, err := authenticateConsensusBatch(proof.Whole, f.a.committed.AccountPolicy, proof.Height, f.a.committed.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	defer admission.verifier.Clear()
	// Coverage-only workload: unrelated effects are synthetic, never persisted
	// or claimed to pass full state validation. Both implementations get the
	// exact same original signed batch and padded effect slices.
	s := copyWholeCommittedState(t, f.a.committed)
	for i := 0; i < 512; i++ {
		s.NativeTransfers = append(s.NativeTransfers, BFTNativeTransfer{TransactionHash: fmt.Sprintf("0x%064x", 100000+i)})
		s.FeeEvents = append(s.FeeEvents, BFTFeeEvent{TxHash: fmt.Sprintf("0x%064x", 200000+i)})
	}
	legacy := func() error { return legacyPQBatchCoverage(s, f.m, hash, proof, admission, refs) }
	indexed := func() error {
		return validateConsensusBatchCoverageWithEffects(s, f.m, hash, proof, admission, refs, indexConsensusBatchEffects(s))
	}
	for _, run := range []func() error{legacy, indexed} {
		if err := run(); err != nil {
			t.Fatal(err)
		}
	}
	if index := indexConsensusBatchEffects(s); len(index) != 17 {
		t.Fatalf("index included unrelated effects or omitted rejected member: %d", len(index))
	}
	measure := func(run func() error) time.Duration {
		start := time.Now()
		for i := 0; i < 12; i++ {
			if err := run(); err != nil {
				t.Fatal(err)
			}
		}
		return time.Since(start) / 12
	}
	a, b := measure(legacy), measure(indexed)
	t.Logf("PQ_COVERAGE_LOCAL legacy_ns=%d indexed_including_build_ns=%d receipts=%d fees=%d members=%d actual_commit_comparison=false", a.Nanoseconds(), b.Nanoseconds(), len(s.NativeTransfers), len(s.FeeEvents), len(proof.Results))
}
