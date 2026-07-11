package chain

import (
	"encoding/json"
	"testing"
)

func TestConsensusMigrationStateIsDeterministicAndTamperEvident(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet("ynx_consensus_alice", 10_000); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Transfer("ynx_consensus_alice", "ynx_consensus_bob", 250); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()

	first, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	second, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if first.StateHash != second.StateHash {
		t.Fatalf("deterministic export hashes differ: %s != %s", first.StateHash, second.StateHash)
	}
	firstJSON, err := first.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	secondJSON, err := second.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if string(firstJSON) != string(secondJSON) {
		t.Fatal("deterministic consensus exports differ")
	}
	if first.Network.ChainID != 6423 || first.Network.NativeCurrencySymbol != "YNXT" {
		t.Fatalf("unexpected network identity: %+v", first.Network)
	}
	if first.Height != devnet.LatestBlock().Height || first.LastBlockHash != devnet.LatestBlock().Hash {
		t.Fatal("migration commit point does not match latest block")
	}
	if first.LiquidSupplyYNXT <= 0 || first.StakedSupplyYNXT <= 0 {
		t.Fatalf("migration supply totals are not populated: %+v", first)
	}

	var decoded ConsensusMigrationState
	if err := json.Unmarshal(firstJSON, &decoded); err != nil {
		t.Fatal(err)
	}
	if err := decoded.Validate(); err != nil {
		t.Fatalf("round-tripped migration state failed validation: %v", err)
	}

	decoded.Accounts[0].Balance++
	decoded.LiquidSupplyYNXT++
	if err := decoded.Validate(); err == nil {
		t.Fatal("tampered account balance passed consensus migration validation")
	}
}

func TestConsensusMigrationExcludesOperationalValidatorEvidence(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("testnet"))
	before, err := devnet.ExportConsensusMigrationState()
	if err == nil {
		t.Fatal("genesis-only state should not be accepted as a migration commit point")
	}

	devnet.ProduceBlock()
	before, err = devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	ready := true
	if _, err := devnet.UpdateValidatorPeerState(ValidatorPeerHeartbeatInput{Address: ValidatorAddress, Ready: &ready, Status: "ready", LatestHeight: 1, Evidence: "operational-only"}); err != nil {
		t.Fatal(err)
	}
	after, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if before.StateHash != after.StateHash {
		t.Fatalf("operational heartbeat changed consensus state hash: %s != %s", before.StateHash, after.StateHash)
	}
}
