package exchangeproduct

import (
	"testing"
	"time"
)

// Isolated native signature/funding fixture, not public trade authorization.
func expiredOrderRecoveryFixture(t *testing.T) (*Service, testAccount, testAccount, PlaceOrderRequest, Order) {
	t.Helper()
	s, chain, _ := newTestService(t)
	owner := accountSession(t, s, alice, "deadman-recovery-owner", "exchange:read", "exchange:trade")
	other := accountSession(t, s, bob, "deadman-recovery-other", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, owner, "dcdcdcdcdcdcdcdc", 2*AmountScale)
	req := PlaceOrderRequest{Market: DefaultMarket, Side: "sell", Type: "limit", TimeInForce: "gtc", PriceMicro: 2 * AmountScale, AmountMicro: AmountScale, IdempotencyKey: "deadman-recovery-order"}
	req.WalletSignature = signAction(owner.private, OrderAuthorizationPayload(owner.account, req))
	order, err := s.PlaceOrder(owner.session, req)
	if err != nil || order.Status != "open" {
		t.Fatal("fixture order unavailable", err)
	}
	arm := DeadManRequest{Action: "arm", TimeoutSeconds: 5, NonceDomain: "deadman:recovery", IdempotencyKey: "deadman-recovery-arm"}
	arm.WalletSignature = signAction(owner.private, DeadManAuthorizationPayload(owner.account, arm))
	armed, err := s.ConfigureDeadMan(owner.session, arm)
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.Now = func() time.Time { return armed.ExpiresAt }
	if count, err := s.SweepDeadMan(); err != nil || count != 1 {
		t.Fatal("fixture expiry failed", count, err)
	}
	cancelled := s.state.Orders[order.ID]
	if cancelled.Status != "cancelled" || cancelled.ReservedMicro != 0 || cancelled.RejectReason != "dead_man_expired" {
		t.Fatal("fixture did not settle cancellation")
	}
	return s, owner, other, req, cancelled
}

func TestOrderExactReplayAfterDeadManExpiryReadsTerminalEffectWithoutReopening(t *testing.T) {
	s, owner, other, req, cancelled := expiredOrderRecoveryFixture(t)
	before := digest(s.state)
	check := func(service *Service) {
		t.Helper()
		for i := 0; i < 3; i++ {
			replay, err := service.PlaceOrder(owner.session, req)
			if err != nil || digest(replay) != digest(cancelled) {
				t.Fatal("exact recovery did not return existing terminal order", err)
			}
		}
		changed := req
		changed.AmountMicro++
		changed.WalletSignature = signAction(owner.private, OrderAuthorizationPayload(owner.account, changed))
		if order, err := service.PlaceOrder(owner.session, changed); err != ErrConflict || order.ID != "" {
			t.Fatal("changed recovery was not fenced", err)
		}
		foreign := req
		foreign.WalletSignature = signAction(other.private, OrderAuthorizationPayload(other.account, foreign))
		if order, err := service.PlaceOrder(other.session, foreign); err != ErrConflict || order.ID != "" {
			t.Fatal("foreign intent returned an owner effect", err)
		}
		fresh := req
		fresh.IdempotencyKey = "deadman-recovery-fresh"
		fresh.WalletSignature = signAction(owner.private, OrderAuthorizationPayload(owner.account, fresh))
		if order, err := service.PlaceOrder(owner.session, fresh); err != ErrForbidden || order.ID != "" {
			t.Fatal("fresh order bypassed expired risk fence", err)
		}
		if digest(service.state) != before || len(service.state.Orders) != 1 || len(service.state.Trades) != 0 {
			t.Fatal("recovery changed durable effects")
		}
		assertLedgerBalances(t, service.Snapshot(owner.account))
		assertLedgerBalances(t, service.Snapshot(other.account))
	}
	check(s)
	cfg := s.cfg
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	check(restarted)
}
