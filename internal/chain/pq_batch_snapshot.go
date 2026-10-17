package chain

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type pqHistoricalReference struct {
	tx     Transaction
	height uint64
}

func parsePQBatchMemo(memo string) (string, uint32, error) {
	value := strings.TrimPrefix(memo, pqBatchMemo)
	if value == memo || len(value) < 68 || value[66] != ':' {
		return "", 0, errors.New("invalid PQ shared proof reference")
	}
	hash := value[:66]
	n, err := strconv.ParseUint(value[67:], 10, 32)
	if err != nil || n >= ynxbatch.MaxN || strconv.FormatUint(n, 10) != value[67:] {
		return "", 0, errors.New("noncanonical PQ shared proof index")
	}
	if _, err = PQBatchTransactionHash(hash, uint32(n)); err != nil {
		return "", 0, err
	}
	return hash, uint32(n), nil
}

// validatePQBatchSnapshot establishes all three directions of coverage:
// admitted outcome -> exactly one transaction, reference -> existing complete
// proof, and rejected outcome -> no transaction. Each complete proof incurs one
// AND signature check and one dual-tree rebuild, never one per historical tx.
// Partial replication State documents defer transaction coverage to the complete
// candidate assembled with its history before persistence.
func validatePQBatchSnapshot(snapshot devnetSnapshot) error {
	for _, p := range snapshot.PQBatches {
		if len(p.Whole) == 0 || len(p.Whole) > MaxPQBatchBytes || len(p.Results) == 0 || len(p.Results) > ynxbatch.MaxN || p.Height == 0 {
			return errors.New("snapshot PQ shared proof exceeds bound")
		}
	}
	refs := make(map[string]map[uint32]pqHistoricalReference)
	remember := func(tx Transaction, height uint64) error {
		if !strings.HasPrefix(tx.Memo, pqBatchMemo) {
			return nil
		}
		hash, index, err := parsePQBatchMemo(tx.Memo)
		if err != nil {
			return err
		}
		proof, ok := snapshot.PQBatches[hash]
		if !ok || int(index) >= len(proof.Results) {
			return errors.New("transaction references missing PQ shared proof or index")
		}
		if refs[hash] == nil {
			refs[hash] = make(map[uint32]pqHistoricalReference)
		}
		if _, duplicate := refs[hash][index]; duplicate {
			return errors.New("duplicate transaction for PQ batch member")
		}
		refs[hash][index] = pqHistoricalReference{tx: tx, height: height}
		return nil
	}
	for _, block := range snapshot.Blocks {
		for _, tx := range block.Transactions {
			if err := remember(tx, block.Height); err != nil {
				return err
			}
		}
	}
	height := uint64(0)
	complete := len(snapshot.Blocks) != 0
	if complete {
		height = snapshot.Blocks[len(snapshot.Blocks)-1].Height
		if height < math.MaxUint64 {
			height++
		}
		for _, tx := range snapshot.Pending {
			if err := remember(tx, height); err != nil {
				return err
			}
		}
		if len(snapshot.PQBatches) > len(refs) {
			return errors.New("orphan PQ shared proof has no transaction references")
		}
	}
	for hash, proof := range snapshot.PQBatches {
		if hash != pqBatchHash(proof.Whole) || (complete && proof.Height > height) {
			return errors.New("PQ shared proof hash or execution height mismatch")
		}
		a, err := authenticatePQBatch(proof.Whole, snapshot.AccountPolicy, proof.Height, snapshot.Config.ChainID)
		if err != nil {
			return fmt.Errorf("authenticate shared PQ history: %w", err)
		}
		err = validatePQBatchCoverage(hash, proof, a, refs[hash], complete)
		a.verifier.Clear()
		if err != nil {
			return err
		}
	}
	return nil
}

func validatePQBatchCoverage(hash string, proof PQBatchProof, a *pqBatchAdmission, refs map[uint32]pqHistoricalReference, complete bool) error {
	if len(proof.Results) != len(a.whole.Messages) {
		return errors.New("PQ batch result count differs from complete message count")
	}
	admitted := 0
	for i, r := range proof.Results {
		if r.Index != uint32(i) || len(r.Error) > 256 {
			return errors.New("PQ batch result order or error bound invalid")
		}
		ref, found := refs[r.Index]
		switch r.Outcome {
		case "admitted":
			admitted++
			txHash, err := PQBatchTransactionHash(hash, r.Index)
			if err != nil || r.TransactionHash != txHash || r.Error != "" {
				return errors.New("admitted PQ result has invalid identity")
			}
			message, err := a.transfer(r.Index, proof.Height)
			if err != nil {
				return err
			}
			if complete && (!found || ref.height != proof.Height || ref.tx.Hash != txHash || ref.tx.Type != "transfer" || ref.tx.Memo != pqBatchMemberMemo(hash, r.Index) || ref.tx.From != message.From || ref.tx.To != message.To || ref.tx.Amount != int64(message.Amount) || ref.tx.Fee != int64(message.Fee) || ref.tx.Nonce != message.Nonce) {
				return errors.New("PQ batch admitted result lacks exactly matching historical execution")
			}
		case "rejected":
			if r.TransactionHash != "" || r.Error == "" || found {
				return errors.New("rejected PQ member has a transaction or invalid result")
			}
		default:
			return errors.New("unknown PQ batch business outcome")
		}
	}
	if admitted == 0 || (complete && admitted != len(refs)) {
		return errors.New("PQ shared proof has no admissions or incomplete transaction coverage")
	}
	return nil
}
