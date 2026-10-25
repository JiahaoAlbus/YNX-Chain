package chain

import "testing"

func TestPQFreshPendingSnapshotDefaultsStable(t *testing.T) {
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	pqMust(t, err)
	if d.validators[0].PeerStatus != "configured" {
		t.Fatal("initial checkpoint differs from recovery metadata defaults")
	}
	pqMust(t, d.EnableAccountPQ(1))
	before := moduleBusinessState(t, d)
	restored, err := NewPersistentDevnet(d.cfg, d.dataDir)
	pqMust(t, err)
	assertModuleState(t, restored, before)
}

func TestPQRestartPreservesExistingZeroValidatorBalances(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		name := "legacy"
		if enabled {
			name = "pq"
		}
		t.Run(name, func(t *testing.T) {
			d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
			pqMust(t, err)
			if enabled {
				pqMust(t, d.EnableAccountPQ(1))
			}
			d.mu.Lock()
			account := d.accounts[d.validators[0].Address]
			// A valid zero-valued stored account is not an absent account. Preserve
			// totals in this state fixture; no production key or network is involved.
			treasury := d.accounts[ProtocolResourceTreasury]
			treasury.Balance += account.Balance
			treasury.Staked += account.Staked
			account.Balance, account.Staked = 0, 0
			account.Nonce = 9007199254740993
			err = d.persistSnapshotLocked()
			d.mu.Unlock()
			pqMust(t, err)
			before := moduleBusinessState(t, d)
			restored, err := NewPersistentDevnet(d.cfg, d.dataDir)
			pqMust(t, err)
			assertModuleState(t, restored, before)
			a, ok := restored.Account(account.Address)
			if !ok || a.Balance != 0 || a.Staked != 0 || a.Nonce != 9007199254740993 {
				t.Fatal("restart recreated funds/stake or changed exact nonce")
			}
		})
	}
}
