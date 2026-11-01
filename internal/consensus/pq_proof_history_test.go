package consensus

import (
	"bytes"
	"context"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestPQProofHistoryPersistentBranchesAndOwnedMaterialization(t *testing.T) {
	proof := PQCommittedBatch{PQBatchProof: chain.PQBatchProof{Whole: []byte{1, 2}, Height: 3, Results: []chain.PQBatchMemberResult{{Index: 0, Outcome: "admitted", TransactionHash: "member"}}}, ABCITransactionHash: "outer"}
	base := executionState{pqBatches: map[string]PQCommittedBatch{"original": ownedExecutionPQBatch(proof)}}
	left, right := base, base
	if !putExecutionPQBatch(&left, "left", proof) || !putExecutionPQBatch(&right, "right", proof) {
		t.Fatal("independent append failed")
	}
	proof.Whole[0], proof.Results[0].Outcome = 9, "rejected"
	if _, ok := executionPQBatch(base, "left"); ok {
		t.Fatal("child changed base")
	}
	if _, ok := executionPQBatch(left, "right"); ok {
		t.Fatal("sibling overlay leaked")
	}
	if _, ok := executionPQBatch(right, "left"); ok {
		t.Fatal("sibling overlay leaked")
	}
	if putExecutionPQBatch(&left, "original", proof) || putExecutionPQBatch(&left, "left", proof) {
		t.Fatal("append-only proof replaced")
	}
	got, _ := executionPQBatch(left, "left")
	if got.Whole[0] != 1 || got.Results[0].Outcome != "admitted" {
		t.Fatal("input proof aliases stored append")
	}
	owned := cloneExecutionPQBatches(left)
	p := owned["left"]
	p.Whole[0] = 8
	p.Results[0].Error = "rewrite"
	owned["left"] = p
	p = owned["original"]
	p.Whole[0] = 8
	owned["original"] = p
	got, _ = executionPQBatch(left, "left")
	if got.Whole[0] != 1 || got.Results[0].Error != "" || base.pqBatches["original"].Whole[0] != 1 {
		t.Fatal("outward materialization aliases base or append")
	}
	if cloneExecutionPQBatches(executionState{}) != nil {
		t.Fatal("nil base changed")
	}
	if out := cloneExecutionPQBatches(executionState{pqBatches: map[string]PQCommittedBatch{}}); out == nil || len(out) != 0 {
		t.Fatal("empty owned base changed")
	}
}

func indexedWholeHistoryFixture() executionState {
	s := executionState{}
	for i := 0; i < 64; i++ {
		hash := fmt.Sprintf("hash-%03d", i)
		s.pqHistory = append(s.pqHistory, PQCommittedAuthorization{Transaction: chain.Transaction{Hash: hash}})
		s.nativeTransfers = append(s.nativeTransfers, BFTNativeTransfer{TransactionHash: hash})
	}
	return s
}

func TestPQProofHistoryIndexMatchesOriginalQueriesAndFallsBack(t *testing.T) {
	s := indexedWholeHistoryFixture()
	index := newPQWholeMemberIndex(s, 16)
	if index == nil || !index.historyComplete || !index.transferComplete {
		t.Fatal("complete index not built")
	}
	for i := -1; i < 66; i++ {
		hash := fmt.Sprintf("hash-%03d", i)
		if pqWholeHistoryContains(s, index, hash) != pqWholeHistoryContains(s, nil, hash) || pqWholeNativeReceiptContains(s, index, hash) != pqWholeNativeReceiptContains(s, nil, hash) {
			t.Fatal("original key/query semantics differ", hash)
		}
	}
	if newPQWholeMemberIndex(s, 1) != nil || newPQWholeMemberIndex(executionState{}, 16) != nil {
		t.Fatal("single/small batch built full history index")
	}
	foreign := cloneBatchTransferCandidate(s)
	foreign.pqHistory[0].Transaction.Hash = "foreign-history"
	foreign.nativeTransfers = insertNativeTransferReceipt(foreign.nativeTransfers, BFTNativeTransfer{TransactionHash: "foreign-receipt"})
	if !pqWholeHistoryContains(foreign, index, "foreign-history") || !pqWholeNativeReceiptContains(foreign, index, "foreign-receipt") {
		t.Fatal("stale generation inferred absence")
	}
	incomplete := *index
	incomplete.historyComplete, incomplete.transferComplete = false, false
	incomplete.historyBase, incomplete.transferBase = nil, nil
	if !pqWholeHistoryContains(s, &incomplete, "hash-001") || !pqWholeNativeReceiptContains(s, &incomplete, "hash-001") {
		t.Fatal("incomplete table became authority")
	}
	unordered := cloneBatchTransferCandidate(s)
	unordered.nativeTransfers[0], unordered.nativeTransfers[63] = unordered.nativeTransfers[63], unordered.nativeTransfers[0]
	bad := newPQWholeMemberIndex(unordered, 16)
	if bad.transferComplete {
		t.Fatal("unordered original receipt query gained new semantics")
	}
	for _, hash := range []string{"hash-000", "hash-001", "hash-063"} {
		if pqWholeNativeReceiptContains(unordered, bad, hash) != pqWholeNativeReceiptContains(unordered, nil, hash) {
			t.Fatal("unordered fallback differs from original sorted search")
		}
	}
}

func TestPQProofHistoryIndexAdvanceIsPersistentAndCandidateBound(t *testing.T) {
	s := indexedWholeHistoryFixture()
	index := newPQWholeMemberIndex(s, 16)
	left, right := cloneBatchTransferCandidate(s), cloneBatchTransferCandidate(s)
	for _, c := range []struct {
		state *executionState
		hash  string
	}{{&left, "left"}, {&right, "right"}} {
		c.state.pqHistory = append(c.state.pqHistory, PQCommittedAuthorization{Transaction: chain.Transaction{Hash: c.hash}})
		c.state.nativeTransfers = insertNativeTransferReceipt(c.state.nativeTransfers, BFTNativeTransfer{TransactionHash: c.hash})
	}
	li, ri := advancePQWholeMemberIndex(index, s, left, "left"), advancePQWholeMemberIndex(index, s, right, "right")
	if li == nil || ri == nil || index.historyAppend != nil || index.transferAppend != nil {
		t.Fatal("older derived snapshot changed")
	}
	if !pqWholeHistoryContains(left, li, "left") || pqWholeHistoryContains(left, li, "right") || !pqWholeNativeReceiptContains(right, ri, "right") || pqWholeNativeReceiptContains(right, ri, "left") {
		t.Fatal("sibling derived updates leaked")
	}
	if !pqWholeHistoryContains(right, li, "right") {
		t.Fatal("foreign derived view did not fall back")
	}
	if advancePQWholeMemberIndex(index, left, right, "right") != nil {
		t.Fatal("stale before generation adopted")
	}
	if advancePQWholeMemberIndex(index, s, cloneBatchTransferCandidate(s), "missing") != nil {
		t.Fatal("unappended candidate adopted")
	}
}

func TestPQProofHistoryWholeFullStateEagerDifferentialAndColdRecovery(t *testing.T) {
	f := activeABCIWholeFixture(t)
	committedBefore := mustJSON(t, f.a.committed)
	messages := make([][]byte, 32)
	for i := range messages {
		messages[i] = f.transferMessage(t, false, uint64(i+2), 1)
	}
	seed := mustPQEnvelope(t, PQWholeType, abciWhole(t, f, messages...))
	partial := mustPQEnvelope(t, PQWholeType, abciWhole(t, f, f.transferMessage(t, false, 34, 999), f.transferMessage(t, false, 34, 1), f.transferMessage(t, false, 37, 1), f.transferMessage(t, false, 35, 1)))
	fast := f.a.committedExecutionStateView()
	eager := f.a.cloneExecutionState()
	for _, payload := range [][]byte{seed, partial} {
		var fastResult, eagerResult transactionExecution
		var err error
		fast, fastResult, err = f.a.applyTransaction(fast, payload, 3, time.Unix(3, 0).UTC())
		if err != nil {
			t.Fatal(err)
		}
		eager, eagerResult, err = f.a.applyTransaction(eager, payload, 3, time.Unix(3, 0).UTC())
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(fastResult.resultData, eagerResult.resultData) || !reflect.DeepEqual(fastResult.event, eagerResult.event) {
			t.Fatal("partial result/error/order changed under deferred proof ownership")
		}
		// Eager reference is the same real execution with the original owned map
		// restored after EACH Whole, not a toy ledger or projected state hash.
		eager.pqBatches, eager.pqBatchDelta = cloneExecutionPQBatches(eager), nil
	}
	if len(fast.pqBatches) != len(f.a.committed.PQBatches) || deltaCount(fast.pqBatchDelta) != 2 {
		t.Fatal("Whole copied complete proof map instead of private append paths")
	}
	if !bytes.Equal(committedBefore, mustJSON(t, f.a.committed)) {
		t.Fatal("candidate mutated immutable committed base")
	}
	fastSealed, err := sealCommittedState(f.m, 3, fast)
	if err != nil {
		t.Fatal(err)
	}
	eagerSealed, err := sealCommittedState(f.m, 3, eager)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mustJSON(t, fastSealed), mustJSON(t, eagerSealed)) || fastSealed.AppHash != eagerSealed.AppHash {
		t.Fatal("full canonical state/AppHash differs from eager proof format")
	}
	owned := cloneExecutionStateValue(fast)
	if owned.pqBatchDelta != nil || !reflect.DeepEqual(owned.pqBatches, fastSealed.PQBatches) {
		t.Fatal("generic clone failed to restore full owned proof representation")
	}
	before := batchCandidateJSON(t, fast)
	if _, _, err := f.a.applyTransaction(fast, partial, 3, time.Unix(3, 0).UTC()); err == nil || !bytes.Equal(before, batchCandidateJSON(t, fast)) {
		t.Fatal("overlay proof replay changed original decision or caller")
	}
	rejected := mustPQEnvelope(t, PQWholeType, abciWhole(t, f, f.transferMessage(t, false, 99, 1)))
	if _, _, err := f.a.applyTransaction(fast, rejected, 3, time.Unix(3, 0).UTC()); err == nil || !bytes.Equal(before, batchCandidateJSON(t, fast)) {
		t.Fatal("all-rejected candidate leaked proof/effects")
	}
	final, err := f.a.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{seed, partial}})
	if err != nil || len(final.TxResults) != 2 || final.TxResults[0].Code != 0 || final.TxResults[1].Code != 0 {
		t.Fatal("normal multi-Whole finalization", err)
	}
	if _, err = f.a.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mustJSON(t, f.a.committed), mustJSON(t, fastSealed)) {
		t.Fatal("normal durable state differs from complete candidate seal")
	}
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
		t.Fatal("cold recovery lost original proof/history fields")
	}
}
