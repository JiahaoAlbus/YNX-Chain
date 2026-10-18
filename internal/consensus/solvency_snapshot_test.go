package consensus

import (
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestSolvencySnapshotReconcilesEveryNativeLiabilityDomain(t *testing.T) {
	state := CommittedState{
		Height:  12,
		AppHash: strings.Repeat("a", 64),
		Accounts: []chain.ConsensusAccount{
			{Address: "ynx1-a", Balance: 10, Staked: 5},
			{Address: "ynx1-b", Balance: 7},
		},
		Unbondings: []BFTUnbondingEntry{
			{Delegator: "ynx1-a", AmountYNXT: 3, Status: "queued"},
			{Delegator: "ynx1-b", AmountYNXT: 4, Status: "withdrawn"},
		},
		StrategyVaults: []assetauth.StrategyVault{{Owner: "ynx1-b", BalanceYNXT: 2}},
		Paymasters:     []BFTPaymaster{{Policy: assetauth.PaymasterPolicy{Sponsor: "ynx1-a", GlobalBudget: 10, GlobalSpent: 4}}},
	}
	migration := chain.ConsensusMigrationState{LiquidSupplyYNXT: 20, StakedSupplyYNXT: 13}
	snapshot, err := buildSolvencySnapshot(migration, state)
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.Reconciled || snapshot.Failure || snapshot.ConsensusIssuedAssetsYNXT != 33 || snapshot.Liabilities.TotalYNXT != 33 || snapshot.Liabilities.LiquidYNXT != 17 || snapshot.Liabilities.StakedYNXT != 5 || snapshot.Liabilities.PendingUnbondingYNXT != 3 || snapshot.Liabilities.StrategyVaultYNXT != 2 || snapshot.Liabilities.PaymasterBudgetYNXT != 6 || snapshot.EncumberedYNXT != 16 || snapshot.OnChainReconciliationBPS != 10_000 {
		t.Fatalf("unexpected solvency reconciliation: %+v", snapshot)
	}
	if snapshot.ExternalReserveRatio.Available || snapshot.ExternalReserveRatio.ValueBPS != nil || snapshot.WithdrawalCapacity.ExternalRedemptionAvailable || snapshot.WithdrawalCapacity.OnChainTransferableYNXT != 17 {
		t.Fatalf("external reserve or withdrawal coverage was overstated: %+v", snapshot)
	}
	for _, address := range []string{"ynx1-a", "ynx1-b"} {
		proof, err := buildSolvencyLiabilityProof(state, address)
		if err != nil || !proof.Verified || !VerifySolvencyLiabilityProof(proof) || proof.LiabilityMerkleRoot != snapshot.LiabilityMerkleRoot {
			t.Fatalf("invalid liability proof for %s: %+v %v", address, proof, err)
		}
		proof.Leaf.TotalYNXT++
		if VerifySolvencyLiabilityProof(proof) {
			t.Fatal("tampered liability proof verified")
		}
	}
}

func TestSolvencySnapshotFailsClosedOnSupplyMismatch(t *testing.T) {
	state := CommittedState{Accounts: []chain.ConsensusAccount{{Address: "ynx1-a", Balance: 1}}}
	snapshot, err := buildSolvencySnapshot(chain.ConsensusMigrationState{LiquidSupplyYNXT: 2}, state)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Reconciled || !snapshot.Failure || snapshot.OnChainReconciliationBPS != 0 {
		t.Fatalf("mismatched solvency snapshot did not fail closed: %+v", snapshot)
	}
}
