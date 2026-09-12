package chain

import (
	"math"
	"strconv"
	"sync"
	"testing"
)

func TestFinanceSnapshotExactIntegersCompleteCoverageAndDetachedShares(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	address := "0x1111111111111111111111111111111111111111"
	d.accounts[address] = &Account{Address: address, Balance: 9007199254740993, Staked: math.MaxInt64, Nonce: math.MaxUint64}
	d.dexAssets["test-token"] = NativeDexAsset{ID: "test-token", Symbol: "TEST", Decimals: 6}
	d.dexPools["dex_test"] = NativeDexPool{ID: "dex_test", Asset0: "YNXT", Asset1: "test-token", Shares: map[string]int64{address: 9007199254740993}}
	s, err := d.NativeFinanceSnapshot(address)
	if err != nil {
		t.Fatal(err)
	}
	a := s["account"].(map[string]any)
	if a["balance"] != "9007199254740993" || a["staked"] != "9223372036854775807" || a["nonce"] != "18446744073709551615" || a["nextNonce"] != nil {
		t.Fatal("lost precision or overflowed next nonce")
	}
	b := s["balances"].([]map[string]any)
	if len(b) != 2 || b[1]["amount"] != "0" || b[1]["assetId"] != "test-token" {
		t.Fatal("zero registered asset omitted from complete coverage")
	}
	shares := s["pools"].([]map[string]any)[0]["shares"].([]map[string]any)
	shares[0]["shares"] = "0"
	if d.dexPools["dex_test"].Shares[address] != 9007199254740993 {
		t.Fatal("response aliases ledger shares")
	}
	again, err := d.NativeFinanceSnapshot(address)
	if err != nil {
		t.Fatal(err)
	}
	if s["snapshotId"] != again["snapshotId"] {
		t.Fatal("observation time changed content identity")
	}
	if s["appHash"] != nil || s["consensusFinality"] != false {
		t.Fatal("projection falsely claims consensus")
	}
	d.dexBalances["orphan"] = map[string]int64{address: 1}
	if _, err = d.NativeFinanceSnapshot(address); err == nil {
		t.Fatal("orphan balance claimed complete")
	}
}

func TestFinanceSnapshotCopiesOneLedgerGeneration(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	address := "0x1111111111111111111111111111111111111111"
	d.accounts[address] = &Account{Address: address, Balance: 1000}
	d.dexAssets["test-token"] = NativeDexAsset{ID: "test-token"}
	d.dexPools["dex_test"] = NativeDexPool{ID: "dex_test", Asset0: "YNXT", Asset1: "test-token", Reserve0: 0, Shares: map[string]int64{address: 1}}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := int64(0); i < 1000; i++ {
			d.mu.Lock()
			d.accounts[address].Balance = 1000 - i
			p := d.dexPools["dex_test"]
			p.Reserve0 = i
			d.dexPools["dex_test"] = p
			d.mu.Unlock()
		}
	}()
	for i := 0; i < 1000; i++ {
		s, err := d.NativeFinanceSnapshot(address)
		if err != nil {
			t.Fatal(err)
		}
		a, _ := strconv.ParseInt(s["account"].(map[string]any)["balance"].(string), 10, 64)
		p, _ := strconv.ParseInt(s["pools"].([]map[string]any)[0]["reserve0"].(string), 10, 64)
		if a+p != 1000 {
			t.Fatal("snapshot mixed ledger generations")
		}
	}
	wg.Wait()
}
