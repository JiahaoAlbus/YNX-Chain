package economics

import (
	"testing"
	"time"
)

func TestLiquidStakingLifecycleStressAndAtomicRejection(t *testing.T) {
	in := LiquidStakingInputs{
		AsOf:                 time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC),
		InitialValidatorYNXT: map[string]int64{"validator-a": 225_000, "validator-b": 225_000, "validator-c": 225_000, "validator-d": 225_000},
		InitialLiquidYNXT:    100_000,
		InitialShareSupply:   1_000_000,
		Actions: []LiquidStakingAction{
			{Epoch: 1, Type: "deposit", Amount: 100_000, Validator: "validator-e"},
			{Epoch: 2, Type: "reward", Amount: 50_000, Validator: "validator-a"},
			{Epoch: 3, Type: "request_withdrawal", Amount: 200_000},
			{Epoch: 4, Type: "pause"},
			{Epoch: 4, Type: "deposit", Amount: 10_000, Validator: "validator-e"},
			{Epoch: 5, Type: "slash", Amount: 100_000, Validator: "validator-a"},
			{Epoch: 6, Type: "secondary_quote", MarketPriceBPSOfNAV: 8_000, MarketAvailableShares: 25_000},
			{Epoch: 10, Type: "fulfill_withdrawal", QueueID: "lstq-000001"},
			{Epoch: 24, Type: "fulfill_withdrawal", QueueID: "lstq-000001"},
		},
	}
	result, err := SimulateLiquidStaking(DefaultLiquidStakingPolicy(), in)
	if err != nil {
		t.Fatal(err)
	}
	if result.MainnetReady || result.ContractExecution || result.GuaranteedAPY || result.GuaranteedPeg || len(result.Steps) != len(in.Actions) {
		t.Fatalf("candidate overclaimed or incomplete: %+v", result)
	}
	deposit := result.Steps[0]
	if !deposit.Accepted || deposit.ShareSupply <= in.InitialShareSupply || deposit.UnderlyingPerShareNano != RateScale {
		t.Fatalf("deposit did not preserve exchange rate: %+v", deposit)
	}
	reward := result.Steps[1]
	if reward.UnderlyingPerShareNano <= deposit.UnderlyingPerShareNano || !reward.ValidatorAllocationLimitBreached {
		t.Fatalf("reward did not increase exchange rate: %+v", reward)
	}
	queued := result.Steps[2]
	if !queued.Accepted || queued.PendingWithdrawalYNXT == 0 || queued.WithdrawalQueue[0].Status != "queued" || queued.ShareSupply >= reward.ShareSupply {
		t.Fatalf("withdrawal was not burned and queued: %+v", queued)
	}
	pausedDeposit := result.Steps[4]
	if pausedDeposit.Accepted || pausedDeposit.Failure != "deposits_paused" || pausedDeposit.BackingYNXT != result.Steps[3].BackingYNXT || pausedDeposit.ShareSupply != result.Steps[3].ShareSupply {
		t.Fatalf("rejected deposit mutated state: %+v", pausedDeposit)
	}
	if result.Steps[5].UnderlyingPerShareNano >= queued.UnderlyingPerShareNano {
		t.Fatalf("slash did not reduce exchange rate: %+v", result.Steps[5])
	}
	quote := result.Steps[6]
	if !quote.SecondaryMarketObserved || quote.SecondaryMarketDiscountBPS != 2_000 || !quote.SecondaryMarketLimitBreached {
		t.Fatalf("secondary depeg stress missing: %+v", quote)
	}
	early := result.Steps[7]
	if early.Accepted || early.Failure != "withdrawal_not_mature" || early.PendingWithdrawalYNXT != result.Steps[6].PendingWithdrawalYNXT {
		t.Fatalf("early fulfillment was not atomic: %+v", early)
	}
	final := result.Steps[8]
	if !final.Accepted || final.PendingWithdrawalYNXT != 0 || final.WithdrawalQueue[0].Status != "fulfilled" || !final.Solvent {
		t.Fatalf("mature withdrawal not fulfilled: %+v", final)
	}
}

func TestLiquidStakingAllocationLimitAndInputBounds(t *testing.T) {
	in := LiquidStakingInputs{AsOf: time.Now(), InitialValidatorYNXT: map[string]int64{"a": 25, "b": 25, "c": 25, "d": 25}, InitialShareSupply: 100, Actions: []LiquidStakingAction{{Epoch: 1, Type: "deposit", Amount: 100, Validator: "a"}}}
	result, err := SimulateLiquidStaking(DefaultLiquidStakingPolicy(), in)
	if err != nil {
		t.Fatal(err)
	}
	if result.Steps[0].Accepted || result.Steps[0].Failure != "validator_allocation_cap_exceeded" || result.Steps[0].BackingYNXT != 100 || result.Steps[0].ShareSupply != 100 {
		t.Fatalf("allocation cap failed closed: %+v", result.Steps[0])
	}
	in.Actions[0].Epoch = -1
	if _, err := SimulateLiquidStaking(DefaultLiquidStakingPolicy(), in); err == nil {
		t.Fatal("negative epoch accepted")
	}
}
