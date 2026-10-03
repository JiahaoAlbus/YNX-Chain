package exchangeproduct

import (
	"testing"
	"time"
)

func TestAmendExactReplayAfterDeadManExpiryPreservesTerminalEffect(t *testing.T) {
	s, chain, _ := newTestService(t)
	owner := accountSession(t, s, alice, "amend-recovery-owner", "exchange:read", "exchange:trade")
	other := accountSession(t, s, bob, "amend-recovery-other", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, owner, "edededededededed", 2*AmountScale)
	place := PlaceOrderRequest{Market: DefaultMarket, Side: "sell", Type: "limit", TimeInForce: "gtc", PriceMicro: 2 * AmountScale, AmountMicro: AmountScale, IdempotencyKey: "amend-recovery-place"}
	place.WalletSignature = signAction(owner.private, OrderAuthorizationPayload(owner.account, place))
	order, err := s.PlaceOrder(owner.session, place)
	if err != nil {
		t.Fatal(err)
	}
	req := AmendOrderRequest{PriceMicro: 3 * AmountScale, AmountMicro: AmountScale, TimeInForce: "gtc", IdempotencyKey: "amend-recovery-change"}
	req.WalletSignature = signAction(owner.private, AmendOrderAuthorizationPayload(owner.account, order.ID, req))
	if amended, err := s.AmendOrder(owner.session, order.ID, req); err != nil || amended.PriceMicro != req.PriceMicro {
		t.Fatal("amend failed", err)
	}
	arm := DeadManRequest{Action: "arm", TimeoutSeconds: 5, NonceDomain: "deadman:amend-recovery", IdempotencyKey: "amend-recovery-arm"}
	arm.WalletSignature = signAction(owner.private, DeadManAuthorizationPayload(owner.account, arm))
	armed, err := s.ConfigureDeadMan(owner.session, arm)
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.Now = func() time.Time { return armed.ExpiresAt }
	if count, err := s.SweepDeadMan(); err != nil || count != 1 {
		t.Fatal("expiry failed", count, err)
	}
	terminal := s.state.Orders[order.ID]
	if terminal.Status != "cancelled" || terminal.ReservedMicro != 0 {
		t.Fatal("terminal settlement missing")
	}
	before := digest(s.state)
	check := func(service *Service) {
		t.Helper()
		for i := 0; i < 3; i++ {
			got, err := service.AmendOrder(owner.session, order.ID, req)
			if err != nil || digest(got) != digest(terminal) {
				t.Fatal("exact amendment replay lost terminal effect", err)
			}
		}
		changed := req
		changed.PriceMicro++
		changed.WalletSignature = signAction(owner.private, AmendOrderAuthorizationPayload(owner.account, order.ID, changed))
		if got, err := service.AmendOrder(owner.session, order.ID, changed); err != ErrConflict || got.ID != "" {
			t.Fatal("changed intent not fenced", err)
		}
		foreign := req
		foreign.WalletSignature = signAction(other.private, AmendOrderAuthorizationPayload(other.account, order.ID, foreign))
		if got, err := service.AmendOrder(other.session, order.ID, foreign); err != ErrForbidden || got.ID != "" {
			t.Fatal("foreign owner not fenced", err)
		}
		fresh := req
		fresh.IdempotencyKey = "amend-recovery-fresh"
		fresh.WalletSignature = signAction(owner.private, AmendOrderAuthorizationPayload(owner.account, order.ID, fresh))
		if got, err := service.AmendOrder(owner.session, order.ID, fresh); err != ErrForbidden || got.ID != "" {
			t.Fatal("fresh amendment bypassed expiry", err)
		}
		if digest(service.state) != before {
			t.Fatal("replay changed persisted state")
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
