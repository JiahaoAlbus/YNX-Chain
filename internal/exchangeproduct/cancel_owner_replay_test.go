package exchangeproduct

import "testing"

func TestCancelledOrderReplayRemainsBoundToOwner(t *testing.T) {
	s, chain, _ := newTestService(t)
	owner := accountSession(t, s, alice, "cancel-owner", "exchange:read", "exchange:trade")
	other := accountSession(t, s, bob, "cancel-other", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, owner, "edededededededed", 2*AmountScale)
	order, err := place(t, s, owner, "sell", 2*AmountScale, AmountScale, "cancel-owner-placement")
	if err != nil {
		t.Fatal(err)
	}
	key := "cancel-owner-replay-key"
	signature := signAction(owner.private, OrderCancelAuthorizationPayload(owner.account, order.ID, key))
	cancelled, err := s.CancelOrder(owner.session, order.ID, key, signature)
	if err != nil || cancelled.Status != "cancelled" {
		t.Fatal("owner cancel failed", err)
	}
	before := digest(s.state)
	foreignSignature := signAction(other.private, OrderCancelAuthorizationPayload(other.account, order.ID, key))
	foreign, err := s.CancelOrder(other.session, order.ID, key, foreignSignature)
	if err != ErrForbidden || foreign.ID != "" {
		t.Fatalf("foreign cancellation replay returned order=%q error=%v", foreign.ID, err)
	}
	for i := 0; i < 3; i++ {
		replayed, err := s.CancelOrder(owner.session, order.ID, key, signature)
		if err != nil || digest(replayed) != digest(cancelled) {
			t.Fatal("owner exact replay changed", err)
		}
	}
	if digest(s.state) != before {
		t.Fatal("replay changed balances, orders or audit")
	}
	assertLedgerBalances(t, s.Snapshot(owner.account))
	assertLedgerBalances(t, s.Snapshot(other.account))
}
