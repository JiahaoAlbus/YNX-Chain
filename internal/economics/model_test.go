package economics

import (
	"testing"
	"time"
)

func TestSimulationSeparatesBurnAndRevenue(t *testing.T) {
	p := DefaultCandidatePolicy()
	in := Inputs{AsOf: time.Unix(1_800_000_000, 0), TotalSupplyYNXT: 1_000_000_000, StakedSupplyYNXT: 500_000_000, ValidatorCount: 16, LargestOperatorBPS: 3000, AnnualNetworkFeesYNXT: 10_000_000, AnnualServiceBurnYNXT: 1_000_000, Years: 2}
	out, err := Simulate(p, in)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Years) != 2 {
		t.Fatalf("got %d years", len(out.Years))
	}
	first := out.Years[0]
	if first.BaseFeeBurnYNXT != in.AnnualNetworkFeesYNXT || first.ValidatorRevenueYNXT != 0 || first.TotalBurnYNXT != 11_000_000 {
		t.Fatalf("burn/revenue accounting is not explicit: %+v", first)
	}
	if first.ClosingSupplyYNXT != first.OpeningSupplyYNXT+first.IssuanceYNXT-first.TotalBurnYNXT {
		t.Fatal("supply reconciliation failed")
	}
}

func TestPolicyRejectsHiddenFeeAllocation(t *testing.T) {
	p := DefaultCandidatePolicy()
	p.TreasuryFeeShareBPS--
	if err := p.Validate(); err == nil {
		t.Fatal("fee allocation below 100% was accepted")
	}
}

func TestIssuanceStaysWithinPublicBounds(t *testing.T) {
	p := DefaultCandidatePolicy()
	in := Inputs{AsOf: time.Now(), TotalSupplyYNXT: 1_000_000, StakedSupplyYNXT: 1, ValidatorCount: 1, LargestOperatorBPS: 10_000, Years: 1}
	out, err := Simulate(p, in)
	if err != nil {
		t.Fatal(err)
	}
	if got := out.Years[0].IssuanceRateBPS; got < p.AnnualIssuanceFloorBPS || got > p.AnnualIssuanceCeilingBPS {
		t.Fatalf("issuance %d outside bounds", got)
	}
}
