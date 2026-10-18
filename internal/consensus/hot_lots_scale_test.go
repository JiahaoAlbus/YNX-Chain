package consensus

import (
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// Synthetic native execution costs only: dense receiver/fee lot maps model the
// traceability records that accumulate when many senders pay common addresses.
// The fixture is not a migrated/persisted chain or business-throughput result.
func BenchmarkNativeHotLots(b *testing.B) {
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
	for _, lotCount := range []int{1, 64, 256, 2048} {
		b.Run(fmt.Sprint(lotCount), func(b *testing.B) {
			const accountsCount = 2048
			accounts := make([]chain.ConsensusAccount, 0, accountsCount)
			for i := 0; i < accountsCount-3; i++ {
				accounts = append(accounts, chain.ConsensusAccount{Address: fmt.Sprintf("0x%040x", i+1), Balance: 10000, Lots: map[string]int64{"local-scale": 10000}})
			}
			accounts = append(accounts, chain.ConsensusAccount{Address: sender, Balance: 10000, Lots: map[string]int64{"local-scale": 10000}})
			for _, address := range []string{receiver, fee} {
				lots := make(map[string]int64, lotCount)
				for i := 0; i < lotCount; i++ {
					amount := int64(10000 / lotCount)
					if i == 0 {
						amount += int64(10000 % lotCount)
					}
					lots[fmt.Sprintf("hot-lot-%08d", i)] = amount
				}
				accounts = append(accounts, chain.ConsensusAccount{Address: address, Balance: 10000, Lots: lots})
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
			for i, address := range []string{sender, receiver, fee} {
				before, _ := accountIndex(state.accounts, address)
				after, _ := accountIndex(result.accounts, address)
				want := int64(10001)
				if i == 0 {
					want = 9998
				}
				var oldLots, newLots int64
				for _, amount := range state.accounts[before].Lots {
					oldLots += amount
				}
				for _, amount := range result.accounts[after].Lots {
					newLots += amount
				}
				if state.accounts[before].Balance != 10000 || oldLots != 10000 || result.accounts[after].Balance != want || newLots != want {
					b.Fatal("hot lots execution or input isolation failed")
				}
			}
		})
	}
}
