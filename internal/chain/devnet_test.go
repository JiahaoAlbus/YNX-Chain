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
	if _, after, err := devnet.Stake("ynx_staker", 200); err != nil {
		t.Fatal(err)
	} else if after.BandwidthLimit <= before.BandwidthLimit {
		t.Fatalf("expected bandwidth to increase, before=%d after=%d", before.BandwidthLimit, after.BandwidthLimit)
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
		t.Fatalf("expected restored latest block %s, got %s", block.Hash, restored.LatestBlock().Hash)
	}
	account, ok := restored.Account("ynx_persist_bob")
	if !ok {
		t.Fatal("expected restored account")
	}
	if account.Balance != 125 {
		t.Fatalf("expected restored balance 125, got %d", account.Balance)
	}
	trace, err := restored.TrustTrace("ynx_persist_bob")
	if err != nil {
		t.Fatal(err)
	}
	if len(trace.Lots) != 1 {
		t.Fatalf("expected restored trace lot, got %v", trace.Lots)
	}
}
