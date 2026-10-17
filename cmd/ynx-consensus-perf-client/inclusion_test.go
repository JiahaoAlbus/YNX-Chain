package main

import (
	"testing"
	"time"
)

func TestInclusionIntervalsExcludeEdgesGapsAndUnverifiedTransactions(t *testing.T) {
	zero := uint32(0)
	start, end := time.Unix(100, 0), time.Unix(104, 0)
	var results []transactionResult
	for block := 0; block < 4; block++ {
		at := start.Add(time.Duration(block) * time.Second)
		for index := 0; index < 2; index++ {
			results = append(results, transactionResult{Height: int64(10 + block), BlockTime: &at, BlockHash: string(rune('a' + block)), DurableStateVerified: true, DurableStateHeight: int64(10 + block), DurableSnapshotSHA256: "unit-gate-fixture", BlockTxIndex: uint32(index), BlockTxTotal: 2, ExecutionCode: &zero, TransactionProofVerified: true, QuorumVerified: true, OfferedAt: &start})
		}
	}
	results[len(results)-1].OfferedAt = &end
	s := summarizeBlocks(results)
	if s.ActiveOfferInteriorIntervals != 2 || s.ActiveOfferInteriorTransactions != 4 || s.ActiveOfferInteriorSeconds != 2 || s.ActiveOfferInteriorTPS == nil || *s.ActiveOfferInteriorTPS != 2 {
		t.Fatalf("wrong complete interior rate: %+v", s)
	}
	results[len(results)-1].Round = 2
	if multiple := summarizeBlocks(results); multiple.ActiveOfferInteriorTPS != nil || multiple.ActiveOfferInteriorIntervals != 0 || !multiple.CompleteObservedBlockCoverage || len(multiple.Blocks) != 4 {
		t.Fatal("round barriers invented continuous offered throughput")
	}
	results[len(results)-1].Round = 1
	results[2].DurableStateVerified = false
	if got := summarizeBlocks(results); got.ActiveOfferInteriorTPS != nil {
		t.Fatal("proof and RPC code alone inflated effective inclusion")
	}
	results[2].DurableStateVerified = true
	results[2].TransactionProofVerified = false
	s = summarizeBlocks(results)
	if s.ActiveOfferInteriorTPS != nil {
		t.Fatalf("incomplete interior block invented throughput: %+v", s)
	}
	results[2].TransactionProofVerified = true
	results[4].Height = 20
	results[5].Height = 20
	results[4].DurableStateHeight = 20
	results[5].DurableStateHeight = 20
	s = summarizeBlocks(results)
	if s.ActiveOfferInteriorIntervals != 1 {
		t.Fatalf("gap was treated as a consecutive interval: %+v", s)
	}
	if s.ActiveOfferInteriorTPS != nil || s.CompleteObservedBlockCoverage {
		t.Fatal("partial success intervals were promoted into a complete interior rate")
	}
}

func TestInclusionIntervalsDoNotInventSteadyStateForSmallSamples(t *testing.T) {
	if got := summarizeBlocks(nil); got.ActiveOfferInteriorTPS != nil {
		t.Fatal("empty observation invented throughput")
	}
	zero := uint32(0)
	at := time.Unix(100, 0)
	result := transactionResult{Height: 1, DurableStateVerified: true, DurableStateHeight: 1, DurableSnapshotSHA256: "unit-gate-fixture", BlockTime: &at, BlockHash: "block", BlockTxTotal: 1, ExecutionCode: &zero, TransactionProofVerified: true, QuorumVerified: true, OfferedAt: &at}
	if got := summarizeBlocks([]transactionResult{result}); got.ActiveOfferInteriorTPS != nil {
		t.Fatal("single block invented interior rate")
	}
	got := summarizeBlocks([]transactionResult{result, result})
	if got.Blocks[0].Complete {
		t.Fatal("duplicate proof index was counted as a complete block")
	}
}
