package consensus

import (
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestTreasurySnapshotDoesNotInventUnconfiguredAssets(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	state := initialCommittedState(migration)
	state.Initialized = true
	snapshot := buildTreasurySnapshot(migration, state)
	if snapshot.TotalYNXT != 0 || !snapshot.Reconciled || snapshot.TransferExecutionEnabled || snapshot.SecretMarketSupport || len(snapshot.Buckets) != 7 {
		t.Fatalf("Treasury snapshot overclaimed state: %+v", snapshot)
	}
	for _, bucket := range snapshot.Buckets {
		if bucket.ID == "development_public_goods" {
			if !bucket.Configured || bucket.Account != chain.ProtocolResourceTreasury || bucket.Source != "ynx-consensus-account" {
				t.Fatalf("configured Treasury bucket mismatch: %+v", bucket)
			}
			continue
		}
		if bucket.Configured || bucket.BalanceYNXT != 0 || bucket.Source != "not_configured" {
			t.Fatalf("unconfigured bucket was invented: %+v", bucket)
		}
	}
}
