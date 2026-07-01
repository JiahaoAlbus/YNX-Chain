package chain

import "testing"

func TestStakeIncreasesResources(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	if _, err := devnet.Faucet("ynx_staker", 500); err != nil {
		t.Fatal(err)
	}
	before, err := devnet.Resources("ynx_staker")
	if err != nil {
		t.Fatal(err)
	}
	_, after, err := devnet.Stake("ynx_staker", 200)
	if err != nil {
		t.Fatal(err)
	}
	if after.BandwidthLimit <= before.BandwidthLimit {
		t.Fatalf("expected bandwidth to increase")
	}
}

func TestResourceDelegationRentalIncomeAndPersistence(t *testing.T) {
	dir := t.TempDir()
	devnet, err := NewPersistentDevnet(DefaultNetworkConfig("devnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_provider", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_renter", 1000); err != nil {
		t.Fatal(err)
	}
	delegation, tx, resources, err := devnet.DelegateResources("ynx_provider", "ynx_provider", 500)
	if err != nil {
		t.Fatal(err)
	}
	if delegation.Status != "active" || tx.Type != "resource_delegate" {
		t.Fatalf("unexpected delegation: %+v tx=%+v", delegation, tx)
	}
	if resources.BandwidthLimit <= 1000 {
		t.Fatalf("expected delegated resources to increase provider capacity: %+v", resources)
	}
	rental, _, err := devnet.RentResources("ynx_renter", "ynx_provider", 100, 5, 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	if rental.Provider != "ynx_provider" || rental.ProviderIncomeYNXT <= 0 || rental.ProtocolFeeYNXT <= 0 {
		t.Fatalf("unexpected rental split: %+v", rental)
	}
	income := devnet.ResourceIncome("ynx_provider")
	if len(income) != 1 || income[0].Amount != rental.ProviderIncomeYNXT {
		t.Fatalf("expected provider income record: %+v", income)
	}
	analytics := devnet.ResourceAnalytics()
	if analytics.ActiveDelegationCount != 1 || analytics.ResourceRentalCount != 1 || analytics.ProviderIncomeYNXT != rental.ProviderIncomeYNXT {
		t.Fatalf("unexpected analytics: %+v", analytics)
	}

	restored, err := NewPersistentDevnet(DefaultNetworkConfig("devnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.ResourceDelegations("ynx_provider")) != 1 {
		t.Fatal("expected restored resource delegation")
	}
	if len(restored.ResourceIncome("ynx_provider")) != 1 {
		t.Fatal("expected restored resource income")
	}
}

func TestTransferRequiresTraceableLots(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	if _, err := devnet.Transfer("ynx_empty", "ynx_receiver", 1); err == nil {
		t.Fatal("expected transfer to fail without balance")
	}
}

func TestPersistentDevnetRestoresBlocksAndAccounts(t *testing.T) {
	dir := t.TempDir()
	cfg := DefaultNetworkConfig("devnet")
	devnet, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_persist_alice", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Transfer("ynx_persist_alice", "ynx_persist_bob", 125); err != nil {
		t.Fatal(err)
	}
	block := devnet.ProduceBlock()
	if block.Height == 0 {
		t.Fatal("expected produced block")
	}
	restored, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if restored.LatestBlock().Hash != block.Hash {
		t.Fatalf("expected restored latest block")
	}
	account, ok := restored.Account("ynx_persist_bob")
	if !ok {
		t.Fatal("expected restored account")
	}
	if account.Balance != 125 {
		t.Fatalf("expected balance 125, got %d", account.Balance)
	}
	trace, err := restored.TrustTrace("ynx_persist_bob")
	if err != nil {
		t.Fatal(err)
	}
	if len(trace.Lots) != 1 {
		t.Fatalf("expected restored trace lot")
	}
}

func TestPersistentDevnetRestoresProductState(t *testing.T) {
	dir := t.TempDir()
	cfg := DefaultNetworkConfig("devnet")
	devnet, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_product", 1000); err != nil {
		t.Fatal(err)
	}
	intent, err := devnet.CreatePayIntent("merchant_product", 75, "")
	if err != nil {
		t.Fatal(err)
	}
	invoice, err := devnet.CreateInvoice(intent.ID, 24)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.AddRiskLabel("ynx_product", "reviewed", 100, "unit"); err != nil {
		t.Fatal(err)
	}
	evidence, err := devnet.EvidencePacket("ynx_product")
	if err != nil {
		t.Fatal(err)
	}
	source := "pragma solidity ^0.8.24; contract Persisted {}"
	contract, _, err := devnet.DeployContract("ynx_product", "Persisted", source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.VerifyContract(contract.Address, source); err != nil {
		t.Fatal(err)
	}

	restored, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := restored.Invoice(invoice.ID); !ok {
		t.Fatal("expected restored invoice")
	}
	if _, ok := restored.StoredEvidencePacket(evidence.ID); !ok {
		t.Fatal("expected restored evidence packet")
	}
	restoredContract, ok := restored.Contract(contract.Address)
	if !ok {
		t.Fatal("expected restored contract")
	}
	if !restoredContract.Verified {
		t.Fatal("expected restored contract verification")
	}
}
