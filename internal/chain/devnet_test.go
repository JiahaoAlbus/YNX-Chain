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
