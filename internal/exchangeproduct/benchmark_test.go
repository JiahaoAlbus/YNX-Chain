package exchangeproduct

import (
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// BenchmarkPlaceOrderPersistent measures the complete durable write path: Wallet
// signature verification, reservation, event/audit creation, fsync and atomic rename.
// Orders are deliberately non-crossing so matching latency can be measured separately.
func BenchmarkPlaceOrderPersistent(b *testing.B) {
	statePath := filepath.Join(b.TempDir(), "benchmark-state.json")
	service, err := New(Config{
		StatePath:      statePath,
		APIKey:         adminKey,
		WalletCallback: "ynxexchange://wallet/callback",
		MakerFeeBPS:    10,
		TakerFeeBPS:    20,
	})
	if err != nil {
		b.Fatal(err)
	}
	service.state.Balances[balanceKey(alice, NativeAsset)] = Balance{Account: alice, Asset: NativeAsset, AvailableMicro: int64(b.N+1) * AmountScale}
	session := WalletSession{Account: alice, WalletPublicKey: hex.EncodeToString(aliceKey.PubKey().SerializeCompressed())}
	b.ReportAllocs()
	latencies := make([]int64, 0, b.N)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := PlaceOrderRequest{Market: DefaultMarket, Side: "sell", Type: "limit", TimeInForce: "gtc", PriceMicro: int64(100+(i%100_000)) * AmountScale, AmountMicro: AmountScale, IdempotencyKey: fmt.Sprintf("benchmark-order-%012d", i)}
		req.WalletSignature = signAction(aliceKey, OrderAuthorizationPayload(alice, req))
		started := time.Now()
		if _, err := service.PlaceOrder(session, req); err != nil {
			b.Fatal(err)
		}
		latencies = append(latencies, time.Since(started).Nanoseconds())
	}
	b.StopTimer()
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	if len(latencies) > 0 {
		b.ReportMetric(float64(latencies[(len(latencies)-1)*50/100])/1e6, "p50-ms")
		b.ReportMetric(float64(latencies[(len(latencies)-1)*95/100])/1e6, "p95-ms")
		b.ReportMetric(float64(latencies[(len(latencies)-1)*99/100])/1e6, "p99-ms")
		if info, err := os.Stat(statePath); err == nil {
			b.ReportMetric(float64(info.Size())/float64(len(latencies)), "state-B/order")
		}
	}
}

func BenchmarkOrderBookSnapshot1000(b *testing.B) {
	service, err := New(Config{StatePath: filepath.Join(b.TempDir(), "book-state.json"), APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback"})
	if err != nil {
		b.Fatal(err)
	}
	for i := 0; i < 1000; i++ {
		id := fmt.Sprintf("order-%04d", i)
		service.state.Orders[id] = Order{ID: id, Account: alice, Market: DefaultMarket, Side: "sell", Type: "limit", TimeInForce: "gtc", PriceMicro: int64(1_000_000+i) * AmountScale, AmountMicro: AmountScale, Status: "open"}
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		book := service.Book()
		if len(book.Asks) != 1000 {
			b.Fatalf("asks=%d", len(book.Asks))
		}
	}
}
