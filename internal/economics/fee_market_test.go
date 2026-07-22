package economics

import (
	"testing"
	"time"
)

func TestFeeMarketLanesBurnSplitSponsorshipAndAdjustment(t *testing.T) {
	block1 := emptyFeeMarketBlock(1)
	setLaneTransactions(&block1, "transfer", []FeeMarketTransaction{{ID: "tx-transfer-1", User: "user-a", Units: 1_500, MaxFeePerUnit: 20, PriorityFeePerUnit: 2}, {ID: "tx-transfer-over-cap", User: "user-b", Units: 600, MaxFeePerUnit: 20, PriorityFeePerUnit: 2}})
	setLaneTransactions(&block1, "contract", []FeeMarketTransaction{{ID: "tx-contract-low-cap", User: "user-c", Units: 100, MaxFeePerUnit: 9, PriorityFeePerUnit: 1}})
	setLaneTransactions(&block1, "ai", []FeeMarketTransaction{{ID: "tx-ai-sponsored", User: "user-d", Sponsor: "sponsor-a", Units: 100, MaxFeePerUnit: 20, PriorityFeePerUnit: 5}})
	block2 := emptyFeeMarketBlock(2)
	result, err := SimulateFeeMarket(DefaultFeeMarketPolicy(), FeeMarketInputs{AsOf: time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC), Blocks: []FeeMarketBlockInput{block1, block2}})
	if err != nil {
		t.Fatal(err)
	}
	if result.ConsensusActive || result.GovernanceActivated || result.ExplorerIntegrated || !result.Reconciled {
		t.Fatalf("candidate status or reconciliation incorrect: %+v", result)
	}
	transfer := feeLaneByID(t, result.Blocks[0], "transfer")
	if transfer.UsedUnits != 1_500 || transfer.OpeningBaseFeePerUnit != 10 || transfer.ClosingBaseFeePerUnit != 11 || !transfer.Reconciled {
		t.Fatalf("transfer lane adjustment mismatch: %+v", transfer)
	}
	if !transfer.Events[0].Accepted || transfer.Events[1].Accepted || transfer.Events[1].Failure != "units_or_lane_capacity_invalid" {
		t.Fatalf("capacity rejection mismatch: %+v", transfer.Events)
	}
	if transfer.GrossFeeYNXT != 18_000 || transfer.BaseFeeBurnYNXT != 15_000 || transfer.ServiceBurnYNXT != 0 || transfer.ValidatorYNXT != 2_100 || transfer.ProviderYNXT != 300 || transfer.ProtocolYNXT != 300 || transfer.TreasuryYNXT != 300 {
		t.Fatalf("transfer conservation mismatch: %+v", transfer)
	}
	contract := feeLaneByID(t, result.Blocks[0], "contract")
	if contract.Events[0].Accepted || contract.Events[0].Failure != "max_fee_below_base_and_service_fee" || contract.UsedUnits != 0 || contract.ClosingBaseFeePerUnit >= contract.OpeningBaseFeePerUnit {
		t.Fatalf("low max fee handling mismatch: %+v", contract)
	}
	ai := feeLaneByID(t, result.Blocks[0], "ai")
	event := ai.Events[0]
	if !event.Accepted || !event.Sponsored || event.User != "user-d" || event.Payer != "sponsor-a" || event.GrossFeeYNXT != 1_700 || event.BaseFeeBurnYNXT != 1_000 || event.ServiceBurnYNXT != 20 || event.ValidatorYNXT != 68 || event.ProviderYNXT != 408 || event.ProtocolYNXT != 136 || event.TreasuryYNXT != 68 || event.AuditHash != candidateFeeAuditHash(event) {
		t.Fatalf("sponsored service fee mismatch: %+v", event)
	}
	transfer2 := feeLaneByID(t, result.Blocks[1], "transfer")
	if transfer2.OpeningBaseFeePerUnit != 11 || transfer2.ClosingBaseFeePerUnit != 10 {
		t.Fatalf("empty block did not lower lane base fee: %+v", transfer2)
	}
}

func TestFeeMarketRejectsDuplicateAndInvalidPolicy(t *testing.T) {
	block := emptyFeeMarketBlock(1)
	setLaneTransactions(&block, "transfer", []FeeMarketTransaction{{ID: "duplicate", User: "a", Units: 1, MaxFeePerUnit: 20}})
	setLaneTransactions(&block, "contract", []FeeMarketTransaction{{ID: "duplicate", User: "b", Units: 1, MaxFeePerUnit: 20}})
	if _, err := SimulateFeeMarket(DefaultFeeMarketPolicy(), FeeMarketInputs{AsOf: time.Now(), Blocks: []FeeMarketBlockInput{block}}); err == nil {
		t.Fatal("duplicate transaction ID accepted")
	}
	policy := DefaultFeeMarketPolicy()
	lane := policy.Lanes["transfer"]
	lane.TreasuryShareBPS++
	policy.Lanes["transfer"] = lane
	if err := policy.Validate(); err == nil {
		t.Fatal("unreconciled fee shares accepted")
	}
}

func emptyFeeMarketBlock(height int64) FeeMarketBlockInput {
	block := FeeMarketBlockInput{Height: height, Lanes: make([]FeeMarketLaneBlock, 0, len(CanonicalFeeLaneIDs))}
	for _, id := range CanonicalFeeLaneIDs {
		block.Lanes = append(block.Lanes, FeeMarketLaneBlock{Lane: id, Transactions: []FeeMarketTransaction{}})
	}
	return block
}

func setLaneTransactions(block *FeeMarketBlockInput, lane string, transactions []FeeMarketTransaction) {
	for i := range block.Lanes {
		if block.Lanes[i].Lane == lane {
			block.Lanes[i].Transactions = transactions
			return
		}
	}
}

func feeLaneByID(t *testing.T, block FeeMarketBlockResult, id string) FeeLaneBlockResult {
	t.Helper()
	for _, lane := range block.Lanes {
		if lane.Lane == id {
			return lane
		}
	}
	t.Fatalf("lane %s missing", id)
	return FeeLaneBlockResult{}
}
