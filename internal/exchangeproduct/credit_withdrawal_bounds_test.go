package exchangeproduct

import (
	"bytes"
	"math"
	"os"
	"sync"
	"testing"
)

func TestTestQuoteCreditRejectsInvalidAndOverflowLedgerWithoutMutation(t *testing.T) {
	for _, balance := range []Balance{
		{AvailableMicro: math.MaxInt64},
		{AvailableMicro: math.MaxInt64 - 1, ReservedMicro: 1},
		{AvailableMicro: -1},
		{ReservedMicro: -1},
	} {
		s, _, statePath := newTestService(t)
		balance.Account = alice
		balance.Asset = QuoteAsset
		s.state.Balances[balanceKey(alice, QuoteAsset)] = balance
		before := digest(s.state)
		disk, err := os.ReadFile(statePath)
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.CreditTestQuote(adminKey, alice, 1, "bounded-credit-key")
		if err != ErrConflict {
			t.Fatalf("balance=%+v accepted invalid credit: %v", balance, err)
		}
		after, err := os.ReadFile(statePath)
		if err != nil || !bytes.Equal(disk, after) || digest(s.state) != before {
			t.Fatal("rejected credit mutated state")
		}
	}
}

func TestTestQuoteConcurrentExactReplayCreditsOnce(t *testing.T) {
	s, _, _ := newTestService(t)
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			b, err := s.CreditTestQuote(adminKey, alice, AmountScale, "concurrent-bound-credit")
			if err != nil || b.AvailableMicro != AmountScale {
				t.Errorf("exact replay balance=%+v err=%v", b, err)
			}
		}()
	}
	wg.Wait()
	s.mu.Lock()
	b := s.balanceLocked(alice, QuoteAsset)
	s.mu.Unlock()
	if b.AvailableMicro != AmountScale {
		t.Fatalf("duplicate credit: %+v", b)
	}
}

func TestQuoteCreditAndWithdrawalAcceptExactTotalBoundary(t *testing.T) {
	s, _, _ := newTestService(t)
	s.state.Balances[balanceKey(alice, QuoteAsset)] = Balance{Account: alice, Asset: QuoteAsset, AvailableMicro: math.MaxInt64 - 2, ReservedMicro: 1}
	if b, err := s.CreditTestQuote(adminKey, alice, 1, "exact-max-credit"); err != nil || b.AvailableMicro != math.MaxInt64-1 || b.ReservedMicro != 1 {
		t.Fatalf("credit=%+v err=%v", b, err)
	}
	a := accountSession(t, s, alice, "exact-total-withdrawal", "exchange:withdraw")
	s.state.Balances[balanceKey(alice, NativeAsset)] = Balance{Account: alice, Asset: NativeAsset, AvailableMicro: 2 * AmountScale, ReservedMicro: math.MaxInt64 - 2*AmountScale}
	req := WithdrawalReviewRequest{Asset: NativeAsset, Network: "YNX Testnet", Destination: bob, AmountMicro: AmountScale, IdempotencyKey: "exact-max-withdrawal"}
	req.WalletSignature = signAction(a.private, WithdrawalAuthorizationPayload(alice, req, s.cfg.WithdrawalFeeMicroYNXT))
	if _, err := s.ReviewWithdrawal(a.session, req); err != nil {
		t.Fatal(err)
	}
	b := s.state.Balances[balanceKey(alice, NativeAsset)]
	if b.AvailableMicro != AmountScale || b.ReservedMicro != math.MaxInt64-AmountScale {
		t.Fatalf("total not preserved: %+v", b)
	}
}

func TestWithdrawalReviewRejectsInvalidLedgerWithoutMutation(t *testing.T) {
	for _, balance := range []Balance{
		{AvailableMicro: 2 * AmountScale, ReservedMicro: math.MaxInt64},
		{AvailableMicro: 2 * AmountScale, ReservedMicro: -1},
	} {
		s, _, statePath := newTestService(t)
		a := accountSession(t, s, alice, "withdraw-bounds", "exchange:withdraw")
		balance.Account = alice
		balance.Asset = NativeAsset
		s.state.Balances[balanceKey(alice, NativeAsset)] = balance
		req := WithdrawalReviewRequest{Asset: NativeAsset, Network: "YNX Testnet", Destination: bob, AmountMicro: AmountScale, IdempotencyKey: "bounded-withdrawal"}
		req.WalletSignature = signAction(a.private, WithdrawalAuthorizationPayload(alice, req, s.cfg.WithdrawalFeeMicroYNXT))
		before := digest(s.state)
		disk, err := os.ReadFile(statePath)
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.ReviewWithdrawal(a.session, req)
		if err != ErrConflict {
			t.Fatalf("balance=%+v invalid reservation accepted: %v", balance, err)
		}
		after, err := os.ReadFile(statePath)
		if err != nil || !bytes.Equal(disk, after) || digest(s.state) != before {
			t.Fatal("rejected withdrawal mutated state")
		}
	}
}
