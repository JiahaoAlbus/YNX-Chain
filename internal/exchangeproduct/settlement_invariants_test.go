package exchangeproduct

import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"os"
	"testing"
)

func assertAccounting(t *testing.T, s *Service, initialBase, initialQuote int64) {
	t.Helper()
	base, quote := int64(0), int64(0)
	available, reserved := map[string]int64{}, map[string]int64{}
	orderReserved := map[string]int64{}
	for _, o := range s.state.Orders {
		asset := NativeAsset
		if o.Side == "buy" {
			asset = QuoteAsset
		}
		orderReserved[balanceKey(o.Account, asset)] += o.ReservedMicro
	}
	for _, entry := range s.state.Ledger {
		key := balanceKey(entry.Account, entry.Asset)
		available[key] += entry.AvailableDelta
		reserved[key] += entry.ReservedDelta
	}
	for key, b := range s.state.Balances {
		if b.AvailableMicro < 0 || b.ReservedMicro < 0 || available[key] != b.AvailableMicro || reserved[key] != b.ReservedMicro || orderReserved[key] != b.ReservedMicro {
			t.Fatalf("negative or unreconciled ledger: %+v", b)
		}
		if b.Asset == NativeAsset {
			base += b.AvailableMicro + b.ReservedMicro
		} else if b.Asset == QuoteAsset {
			quote += b.AvailableMicro + b.ReservedMicro
		}
	}
	for _, f := range s.state.Fees {
		if f.Kind == "trade" && f.Asset == QuoteAsset {
			quote += f.AmountMicro
		}
	}
	if base != initialBase || quote != initialQuote {
		t.Fatalf("value not conserved base=%d/%d quote+fees=%d/%d", base, initialBase, quote, initialQuote)
	}
	for _, o := range s.state.Orders {
		if o.ReservedMicro < 0 {
			t.Fatal("negative order reserve")
		}
	}
}

func TestDustAdmissionAndRemainderNeverTransferUnpaidBase(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "dust-seller", "exchange:trade")
	buyer := accountSession(t, s, bob, "dust-buyer", "exchange:trade")
	other := accountSession(t, s, carol, "dust-other", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "eeeeeeeeeeeeee01", 1_000_001)
	for _, account := range []string{bob, carol} {
		if _, err := s.CreditTestQuote(adminKey, account, 100, "dust-credit-"+account); err != nil {
			t.Fatal(err)
		}
	}
	before := digest(s.state)
	if _, err := place(t, s, buyer, "buy", 1, 1, "zero-quote-order"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("dust admitted: %v", err)
	}
	if digest(s.state) != before {
		t.Fatal("dust rejection mutated state")
	}
	if _, err := place(t, s, seller, "sell", 1, 1_000_001, "dust-seller-order"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, buyer, "buy", 1, 1_000_000, "dust-first-match"); err != nil {
		t.Fatal(err)
	}
	if len(s.state.Trades) != 1 {
		t.Fatal("expected positive quote match")
	}
	if _, err := place(t, s, other, "buy", AmountScale, 1, "dust-second-buy"); err != nil {
		t.Fatal(err)
	}
	if len(s.state.Trades) != 1 || s.Snapshot(carol).Balances[0].AvailableMicro != 0 {
		t.Fatal("zero quote remainder transferred unpaid base")
	}
	assertAccounting(t, s, 1_000_001, 200)
}

func TestFragmentedFeesShortfallRollsBackWholeIncomingRequest(t *testing.T) {
	s, chain, path := newTestService(t)
	seller := accountSession(t, s, alice, "fragment-seller", "exchange:trade")
	buyer := accountSession(t, s, bob, "fragment-buyer", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "eeeeeeeeeeeeee02", 10)
	if _, err := s.CreditTestQuote(adminKey, bob, 100, "fragment-credit"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		if _, err := place(t, s, seller, "sell", AmountScale, 1, fmt.Sprintf("fragment-sell-%02d", i)); err != nil {
			t.Fatal(err)
		}
	}
	before, diskBefore := digest(s.state), mustRead(t, path)
	sequence, revision, auditCount, keyCount := s.state.Sequence, s.state.Revision, len(s.state.Audit), len(s.state.Idempotency)
	if _, err := place(t, s, buyer, "buy", AmountScale, 10, "fragment-buy-all"); !errors.Is(err, ErrInsufficient) {
		t.Fatalf("unfunded fill did not fail: %v", err)
	}
	if digest(s.state) != before || string(mustRead(t, path)) != string(diskBefore) {
		t.Fatal("partial fills/fees/audit/idempotency survived atomic rejection")
	}
	if s.state.Sequence != sequence || s.state.Revision != revision || len(s.state.Audit) != auditCount || len(s.state.Idempotency) != keyCount {
		t.Fatal("rejected request left sequence, revision, audit or idempotency state")
	}
	if len(s.state.Trades) != 0 {
		t.Fatal("unpaid trade persisted")
	}
	assertAccounting(t, s, 10, 100)
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if digest(restarted.state) != before {
		t.Fatal("restart differs after rejected fragment execution")
	}
}

func TestExistingBuyCannotBorrowAnotherOrdersReserve(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "reserve-seller", "exchange:trade")
	buyer := accountSession(t, s, bob, "reserve-buyer", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "eeeeeeeeeeeeee03", 10)
	if _, err := s.CreditTestQuote(adminKey, bob, 100, "reserve-credit"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, buyer, "buy", AmountScale, 10, "reserve-main-buy"); err != nil {
		t.Fatal(err)
	}
	other, err := place(t, s, buyer, "buy", AmountScale/2, 10, "reserve-other-buy")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if _, err := place(t, s, seller, "sell", AmountScale, 1, fmt.Sprintf("reserve-sell-%02d", i)); err != nil {
			t.Fatal(err)
		}
	}
	before := digest(s.state)
	if _, err := place(t, s, seller, "sell", AmountScale, 1, "reserve-sell-over"); !errors.Is(err, ErrInsufficient) {
		t.Fatalf("borrowed another reserve: %v", err)
	}
	if digest(s.state) != before || s.state.Orders[other.ID].ReservedMicro != other.ReservedMicro {
		t.Fatal("unrelated order funds changed")
	}
	assertAccounting(t, s, 10, 100)
}

func TestInconsistentAggregateReserveFailsBeforeAnySettlement(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "corrupt-seller", "exchange:trade")
	buyer := accountSession(t, s, bob, "corrupt-buyer", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "eeeeeeeeeeeeee04", 2*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 10*AmountScale, "corrupt-credit"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, seller, "sell", AmountScale, AmountScale, "corrupt-sell-order"); err != nil {
		t.Fatal(err)
	}
	key := balanceKey(alice, NativeAsset)
	b := s.state.Balances[key]
	b.ReservedMicro--
	s.state.Balances[key] = b
	before := digest(s.state)
	if _, err := place(t, s, buyer, "buy", AmountScale, AmountScale, "corrupt-buy-order"); !errors.Is(err, ErrConflict) {
		t.Fatalf("inconsistent reservation accepted: %v", err)
	}
	if digest(s.state) != before {
		t.Fatal("failed settlement changed state")
	}
}

func TestReserveReleaseDoesNotSilentlyForgiveDeficits(t *testing.T) {
	s, _, _ := newTestService(t)
	o := Order{Account: alice, Side: "buy", ReservedMicro: 10}
	s.state.Balances[balanceKey(alice, QuoteAsset)] = Balance{Account: alice, Asset: QuoteAsset, ReservedMicro: 9}
	before := digest(s.state)
	if err := s.releaseOrderReserveLocked(&o); !errors.Is(err, ErrConflict) {
		t.Fatal("reserve deficit silently forgiven")
	}
	if o.ReservedMicro != 10 || digest(s.state) != before {
		t.Fatal("invalid release mutated state")
	}
}

func TestFeeArithmeticMatchesBigIntegerAtInt64Boundary(t *testing.T) {
	for _, amount := range []int64{1, 9999, 10000, 1_000_000_000_000_000_000, math.MaxInt64} {
		for _, bps := range []int64{0, 1, 10, 20, 43, 1000} {
			expected := new(big.Int).Mul(big.NewInt(amount), big.NewInt(bps))
			expected.Add(expected, big.NewInt(9999))
			expected.Div(expected, big.NewInt(10000))
			if got := fee(amount, bps); got != expected.Int64() {
				t.Fatalf("amount=%d bps=%d fee=%d expected=%s", amount, bps, got, expected)
			}
		}
	}
}

func TestUnsafeFeeConfigurationsRejectedBeforeVenueStartup(t *testing.T) {
	s, _, _ := newTestService(t)
	for _, pair := range [][2]int64{{21, 20}, {-1, 20}, {10, 1001}, {1001, 1001}, {10, -1}} {
		cfg := s.cfg
		cfg.MakerFeeBPS = pair[0]
		cfg.TakerFeeBPS = pair[1]
		if other, err := New(cfg); err == nil {
			other.Close()
			t.Fatalf("unsafe maker/taker fees accepted: %v", pair)
		}
	}
}

func TestFullyFundedFragmentsConserveAssetsAndFees(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "funded-fragment-seller", "exchange:trade")
	buyer := accountSession(t, s, bob, "funded-fragment-buyer", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "eeeeeeeeeeeeee05", 1000)
	if _, err := s.CreditTestQuote(adminKey, bob, 2000, "funded-fragment-credit"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := place(t, s, seller, "sell", AmountScale, 500, fmt.Sprintf("funded-fragment-sell-%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	order, err := place(t, s, buyer, "buy", AmountScale, 1000, "funded-fragment-buy")
	if err != nil || order.Status != "filled" || order.ReservedMicro != 0 {
		t.Fatalf("funded fill failed: %+v %v", order, err)
	}
	if len(s.state.Trades) != 2 {
		t.Fatal("funded fragment matches missing")
	}
	assertAccounting(t, s, 1000, 2000)
}

func TestSettlementReceiveOverflowFailsWithoutMutation(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "overflow-seller", "exchange:trade")
	buyer := accountSession(t, s, bob, "overflow-buyer", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "eeeeeeeeeeeeee06", AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 10*AmountScale, "overflow-credit"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, seller, "sell", AmountScale, AmountScale, "overflow-sell-order"); err != nil {
		t.Fatal(err)
	}
	s.state.Balances[balanceKey(bob, NativeAsset)] = Balance{Account: bob, Asset: NativeAsset, AvailableMicro: math.MaxInt64}
	before := digest(s.state)
	if _, err := place(t, s, buyer, "buy", AmountScale, AmountScale, "overflow-buy-order"); !errors.Is(err, ErrConflict) {
		t.Fatalf("receiver overflow accepted: %v", err)
	}
	if digest(s.state) != before {
		t.Fatal("overflow rejected after changing ledger")
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	value, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return value
}
