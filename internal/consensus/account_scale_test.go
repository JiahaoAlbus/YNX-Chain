package consensus

import (
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

var nativeAccountScaleSink executionState

// This isolates native execution over synthetic account tables. It has no
// proposals, BFT network, persistent Commit or business-throughput qualification.
// A real signed envelope is primed once; repeated execution uses the existing
// static verification cache while every nonce/balance/lot check still runs.
func BenchmarkNativeAccountScale(b *testing.B) {
	key := deterministicPrivateKey(151)
	sender, err := NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		b.Fatal(err)
	}
	receiver, err := NativeAddress(deterministicPrivateKey(152).PubKey().SerializeCompressed())
	if err != nil {
		b.Fatal(err)
	}
	fee, err := NativeAddress(deterministicPrivateKey(153).PubKey().SerializeCompressed())
	if err != nil {
		b.Fatal(err)
	}
	tx, err := NewSignedTransfer(key, 6423, receiver, 1, 1)
	if err != nil {
		b.Fatal(err)
	}
	raw, err := EncodeSignedTransaction(tx)
	if err != nil {
		b.Fatal(err)
	}
	for _, count := range []int{256, 2048, 8192} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			accounts := make([]chain.ConsensusAccount, 0, count)
			for i := 0; i < count-3; i++ {
				accounts = append(accounts, chain.ConsensusAccount{Address: fmt.Sprintf("0x%040x", i+1), Balance: 10000, Lots: map[string]int64{"local-scale": 10000}})
			}
			for _, address := range []string{sender, receiver, fee} {
				accounts = append(accounts, chain.ConsensusAccount{Address: address, Balance: 10000, Lots: map[string]int64{"local-scale": 10000}})
			}
			sort.Slice(accounts, func(i, j int) bool { return accounts[i].Address < accounts[j].Address })
			state := executionState{accounts: accounts}
			app := &Application{migration: chain.ConsensusMigrationState{Network: chain.DefaultNetworkConfig("testnet")}, feeRecipient: fee}
			if _, _, err := app.applyTransaction(state, raw, 2, time.Unix(100, 0)); err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				var err error
				nativeAccountScaleSink, _, err = app.applyTransaction(state, raw, 2, time.Unix(100, 0))
				if err != nil {
					b.Fatal(err)
				}
			}
			b.StopTimer()
			result := cloneExecutionStateValue(nativeAccountScaleSink)
			if len(result.accounts) != count || len(result.feeEvents.events()) != 1 {
				b.Fatal("execution lost account or fee records")
			}
			for i, address := range []string{sender, receiver, fee} {
				before, _ := accountIndex(state.accounts, address)
				after, _ := accountIndex(result.accounts, address)
				want := int64(10001)
				if i == 0 {
					want = 9998
				}
				if state.accounts[before].Balance != 10000 || state.accounts[before].Lots["local-scale"] != 10000 || result.accounts[after].Balance != want || result.accounts[after].Lots["local-scale"] != want {
					b.Fatal("input isolation or actual transfer result failed")
				}
			}
		})
	}
}
