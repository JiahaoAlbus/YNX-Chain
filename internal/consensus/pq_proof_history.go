package consensus

import (
	"bytes"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// A candidate borrows the immutable committed proof map. Each new Whole owns
// its proof bytes/results and changes only an immutable AVL path. No writable
// map or proof slice is shared with another execution phase or proposal.
func executionPQBatch(state executionState, hash string) (PQCommittedBatch, bool) {
	if proof, ok := deltaGet(state.pqBatchDelta, hash); ok {
		return proof, true
	}
	proof, ok := state.pqBatches[hash]
	return proof, ok
}

func ownedExecutionPQBatch(proof PQCommittedBatch) PQCommittedBatch {
	proof.Whole = bytes.Clone(proof.Whole)
	proof.Results = append([]chain.PQBatchMemberResult(nil), proof.Results...)
	return proof
}

func putExecutionPQBatch(state *executionState, hash string, proof PQCommittedBatch) bool {
	if _, exists := executionPQBatch(*state, hash); exists {
		return false
	}
	state.pqBatchDelta = deltaPut(state.pqBatchDelta, hash, ownedExecutionPQBatch(proof))
	return true
}

// Materialize only at the existing full-clone, canonical/hash or outward
// ownership boundary. Restore the original nil/empty representation as well as
// every original byte/result; delta nodes and immutable base remain untouched.
func cloneExecutionPQBatches(state executionState) map[string]PQCommittedBatch {
	out := cloneConsensusPQBatches(state.pqBatches)
	if state.pqBatchDelta == nil {
		return out
	}
	if out == nil {
		out = make(map[string]PQCommittedBatch)
	}
	deltaWalk(state.pqBatchDelta, func(hash string, proof PQCommittedBatch) {
		out[hash] = ownedExecutionPQBatch(proof)
	})
	return out
}

// This index is a complete derived view for ONE applyPQWhole call, never
// authorization or committed state. Small/single-member batches use the exact
// old queries without first building an index. No incomplete/stale view may
// infer absence. The owning execution path keeps each captured slice immutable.
const pqWholeMemberIndexMinimumRecords = 64

type pqWholeMemberIndex struct {
	history          []PQCommittedAuthorization
	transfers        []BFTNativeTransfer
	historyBase      map[string]int
	historyAppend    *nativeDelta[int]
	transferBase     map[string]struct{}
	transferAppend   *nativeDelta[struct{}]
	historyComplete  bool
	transferComplete bool
}

func samePQHistoryView(a, b []PQCommittedAuthorization) bool {
	return len(a) == len(b) && (len(a) == 0 || &a[0] == &b[0])
}
func sameNativeTransferView(a, b []BFTNativeTransfer) bool {
	return len(a) == len(b) && (len(a) == 0 || &a[0] == &b[0])
}
func (index *pqWholeMemberIndex) matches(state executionState) bool {
	return index != nil && samePQHistoryView(index.history, state.pqHistory) && sameNativeTransferView(index.transfers, state.nativeTransfers)
}

func newPQWholeMemberIndex(state executionState, members int) *pqWholeMemberIndex {
	if members < 2 || len(state.pqHistory)+len(state.nativeTransfers) < pqWholeMemberIndexMinimumRecords {
		return nil
	}
	index := &pqWholeMemberIndex{history: state.pqHistory, transfers: state.nativeTransfers,
		historyBase: make(map[string]int, len(state.pqHistory)), transferBase: make(map[string]struct{}, len(state.nativeTransfers))}
	for i, record := range state.pqHistory {
		// Preserve the original linear query's first occurrence semantics.
		if _, exists := index.historyBase[record.Transaction.Hash]; !exists {
			index.historyBase[record.Transaction.Hash] = i
		}
	}
	index.historyComplete = true
	index.transferComplete = true
	for i, record := range state.nativeTransfers {
		if i > 0 && state.nativeTransfers[i-1].TransactionHash >= record.TransactionHash {
			// Original native lookup is a sorted search, not a linear query.
			// An unordered/duplicate source cannot gain new lookup semantics.
			index.transferComplete = false
		}
		index.transferBase[record.TransactionHash] = struct{}{}
	}
	return index
}

func pqWholeHistoryContains(state executionState, index *pqWholeMemberIndex, hash string) bool {
	if index.matches(state) && index.historyComplete {
		at, found := deltaGet(index.historyAppend, hash)
		if !found {
			at, found = index.historyBase[hash]
		}
		if !found {
			return false
		}
		if at >= 0 && at < len(state.pqHistory) && state.pqHistory[at].Transaction.Hash == hash {
			return true
		}
	}
	for _, record := range state.pqHistory {
		if record.Transaction.Hash == hash {
			return true
		}
	}
	return false
}

func pqWholeNativeReceiptContains(state executionState, index *pqWholeMemberIndex, hash string) bool {
	if index.matches(state) && index.transferComplete {
		_, found := deltaGet(index.transferAppend, hash)
		if !found {
			_, found = index.transferBase[hash]
		}
		if !found {
			return false
		}
	}
	_, _, exists := findPayRecord(state.nativeTransfers, hash, func(v BFTNativeTransfer) string { return v.TransactionHash })
	return exists
}

// Called only after the original isolated member clone, original native
// execution and successful history append. Those callees preserve old entries;
// this is not a public rebind operation or a way to adopt an arbitrary state.
// A mismatch drops the derived view so subsequent members use original queries.
func advancePQWholeMemberIndex(index *pqWholeMemberIndex, before, after executionState, hash string) *pqWholeMemberIndex {
	if !index.matches(before) || len(after.pqHistory) != len(before.pqHistory)+1 || after.pqHistory[len(before.pqHistory)].Transaction.Hash != hash {
		return nil
	}
	addedReceipt := len(after.nativeTransfers) == len(before.nativeTransfers)+1
	if !addedReceipt && len(after.nativeTransfers) != len(before.nativeTransfers) {
		return nil
	}
	if addedReceipt {
		if _, _, exists := findPayRecord(after.nativeTransfers, hash, func(v BFTNativeTransfer) string { return v.TransactionHash }); !exists {
			return nil
		}
	}
	next := *index
	next.history, next.transfers = after.pqHistory, after.nativeTransfers
	next.historyAppend = deltaPut(index.historyAppend, hash, len(before.pqHistory))
	if addedReceipt {
		next.transferAppend = deltaPut(index.transferAppend, hash, struct{}{})
	}
	return &next
}
