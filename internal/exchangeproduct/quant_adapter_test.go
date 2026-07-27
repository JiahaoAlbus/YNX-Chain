package exchangeproduct

import (
	"testing"
	"time"
)

func signedQuantMandate(t *testing.T, s *Service, account testAccount, methods ...string) QuantMandate {
	t.Helper()
	m := QuantMandate{Subaccount: account.account, Market: DefaultMarket, Methods: methods, CapitalMicro: 100 * AmountScale, Leverage: 1, ExpiresAt: s.cfg.Now().Add(time.Hour), NonceDomain: "quant:strategy-a:session-1"}
	m.WalletSignature = signAction(account.private, QuantMandatePayload(m))
	return m
}

func TestQuantAdapterUsesAuthoritativeExchangeStateAndKill(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "quant-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "quant-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "efefefefefefefef", 10*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, bob, 50*AmountScale, "quant-adapter-credit"); err != nil {
		t.Fatal(err)
	}
	adapter := NewQuantExecutionAdapter(s)
	sellerMandate := signedQuantMandate(t, s, seller, "read", "submit", "amend", "tp_sl", "twap", "iceberg", "scale", "cancel", "mass_cancel", "kill", "reconcile")
	buyerMandate := signedQuantMandate(t, s, buyer, "read", "submit", "cancel", "mass_cancel", "kill", "reconcile")

	req := PlaceOrderRequest{Market: DefaultMarket, Side: "sell", Type: "limit", PriceMicro: 2 * AmountScale, AmountMicro: 4 * AmountScale, IdempotencyKey: "quant-adapter-sell1"}
	req.WalletSignature = signAction(seller.private, OrderAuthorizationPayload(seller.account, req))
	open, err := adapter.Submit(seller.session, sellerMandate, req)
	if err != nil || open.Status != "open" {
		t.Fatalf("adapter submit=%+v err=%v", open, err)
	}
	amend := AmendOrderRequest{PriceMicro: 2 * AmountScale, AmountMicro: 5 * AmountScale, TimeInForce: "gtc", IdempotencyKey: "quant-adapter-amend1"}
	amend.WalletSignature = signAction(seller.private, AmendOrderAuthorizationPayload(seller.account, open.ID, amend))
	open, err = adapter.Amend(seller.session, sellerMandate, open.ID, amend)
	if err != nil || open.AmountMicro != 5*AmountScale || open.ReservedMicro != 5*AmountScale {
		t.Fatalf("adapter amend=%+v err=%v", open, err)
	}
	conditionalReq := ConditionalOrderRequest{Market: DefaultMarket, Side: "sell", Kind: "take_profit", TriggerPriceMicro: 5 * AmountScale, LimitPriceMicro: 5 * AmountScale, AmountMicro: AmountScale, IdempotencyKey: "quant-kill-condition"}
	conditionalReq.WalletSignature = signAction(seller.private, ConditionalOrderAuthorizationPayload(seller.account, conditionalReq))
	conditional, err := adapter.SubmitConditional(seller.session, sellerMandate, conditionalReq)
	if err != nil || conditional.Status != "pending_trigger" {
		t.Fatalf("conditional=%+v err=%v", conditional, err)
	}
	ocoReq := OCORequest{Market: DefaultMarket, Side: "sell", StopTriggerPriceMicro: 2 * AmountScale, StopLimitPriceMicro: 2 * AmountScale, TakeProfitTriggerMicro: 6 * AmountScale, TakeProfitLimitMicro: 6 * AmountScale, AmountMicro: AmountScale, IdempotencyKey: "quant-kill-oco"}
	ocoReq.WalletSignature = signAction(seller.private, OCOAuthorizationPayload(seller.account, ocoReq))
	group, err := adapter.SubmitOCO(seller.session, sellerMandate, ocoReq)
	if err != nil || group.Status != "pending_trigger" {
		t.Fatalf("OCO=%+v err=%v", group, err)
	}
	twapReq := TWAPRequest{Market: DefaultMarket, Side: "sell", LimitPriceMicro: 4 * AmountScale, TotalAmountMicro: AmountScale, Slices: 2, IntervalSeconds: 60, IdempotencyKey: "quant-kill-twap"}
	twapReq.WalletSignature = signAction(seller.private, TWAPAuthorizationPayload(seller.account, twapReq))
	twap, err := adapter.SubmitTWAP(seller.session, sellerMandate, twapReq)
	if err != nil || twap.Status != "scheduled" {
		t.Fatalf("TWAP=%+v err=%v", twap, err)
	}
	icebergReq := IcebergRequest{Market: DefaultMarket, Side: "sell", PriceMicro: 3 * AmountScale, TotalAmountMicro: AmountScale, DisplayAmountMicro: AmountScale / 2, PostOnly: true, IdempotencyKey: "quant-kill-iceberg"}
	icebergReq.WalletSignature = signAction(seller.private, IcebergAuthorizationPayload(seller.account, icebergReq))
	iceberg, err := adapter.SubmitIceberg(seller.session, sellerMandate, icebergReq)
	if err != nil || iceberg.Status != "open" || iceberg.VisibleUntilMicro != AmountScale/2 {
		t.Fatalf("iceberg=%+v err=%v", iceberg, err)
	}
	scaleReq := ScaleRequest{Market: DefaultMarket, Side: "sell", StartPriceMicro: 7 * AmountScale, EndPriceMicro: 8 * AmountScale, TotalAmountMicro: AmountScale / 2, Levels: 2, PostOnly: true, IdempotencyKey: "quant-kill-scale"}
	scaleReq.WalletSignature = signAction(seller.private, ScaleAuthorizationPayload(seller.account, scaleReq))
	scale, err := adapter.SubmitScale(seller.session, sellerMandate, scaleReq)
	if err != nil || scale.Status != "open" || len(scale.ChildOrderIDs) != 2 {
		t.Fatalf("scale=%+v err=%v", scale, err)
	}
	book, source, err := adapter.OrderBook(buyer.session, buyerMandate)
	if err != nil || len(book.Asks) != 4 || book.Asks[1].Type != "iceberg" || book.Asks[1].AmountMicro != AmountScale/2 || book.Asks[2].Type != "scale_child" || source.Status != "available" || source.Version != QuantAdapterVersion {
		t.Fatalf("book=%+v source=%+v err=%v", book, source, err)
	}
	state, err := adapter.Account(seller.session, sellerMandate)
	if err != nil || len(state.Orders) != 4 || len(state.Positions) != 0 || state.Source.Source != ProductID {
		t.Fatalf("state=%+v err=%v", state, err)
	}
	reconciliation, err := adapter.Reconcile(seller.session, sellerMandate)
	if err != nil || len(reconciliation.OpenOrderIDs) != 4 || reconciliation.SnapshotHash == "" || reconciliation.Sequence < 1 || reconciliation.StrategyStatus != "active" || reconciliation.NonceDomain != sellerMandate.NonceDomain || reconciliation.CapitalMicro != sellerMandate.CapitalMicro || reconciliation.ExposureMicro <= 0 {
		t.Fatalf("reconciliation=%+v err=%v", reconciliation, err)
	}
	key := "quant-adapter-kill1"
	massCancelSignature := signAction(seller.private, MassCancelAuthorizationPayload(seller.account, DefaultMarket, key))
	if _, err := adapter.Kill(seller.session, sellerMandate, key, massCancelSignature); err != ErrUnauthorized {
		t.Fatalf("mass-cancel signature was accepted as a persistent kill: %v", err)
	}
	sig := signAction(seller.private, QuantKillAuthorizationPayload(seller.account, DefaultMarket, sellerMandate.NonceDomain, key))
	killed, err := adapter.Kill(seller.session, sellerMandate, key, sig)
	if err != nil || killed.Count != 6 || len(killed.Orders) != 4 || len(killed.ScaleOrders) != 1 || len(killed.ConditionalOrders) != 1 || len(killed.OCOGroups) != 1 || len(killed.TWAPOrders) != 1 || killed.ConditionalOrders[0].Status != "cancelled" || killed.ConditionalOrders[0].ReservedMicro != 0 || killed.OCOGroups[0].Status != "cancelled" || killed.OCOGroups[0].ReservedMicro != 0 || killed.TWAPOrders[0].Status != "cancelled" || killed.TWAPOrders[0].ReservedMicro != 0 || killed.ScaleOrders[0].Status != "cancelled" || killed.ScaleOrders[0].ReservedMicro != 0 {
		t.Fatalf("kill=%+v err=%v", killed, err)
	}
	for _, order := range killed.Orders {
		if order.Status != "cancelled" || order.ReservedMicro != 0 {
			t.Fatalf("kill left child/open order=%+v", order)
		}
	}
	blocked := PlaceOrderRequest{Market: DefaultMarket, Side: "sell", Type: "limit", PriceMicro: 2 * AmountScale, AmountMicro: AmountScale, IdempotencyKey: "quant-killed-submit1"}
	blocked.WalletSignature = signAction(seller.private, OrderAuthorizationPayload(seller.account, blocked))
	if _, err := adapter.Submit(seller.session, sellerMandate, blocked); err != ErrForbidden {
		t.Fatalf("killed mandate submitted again: %v", err)
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatalf("restart after kill: %v", err)
	}
	blocked.IdempotencyKey = "quant-killed-submit2"
	blocked.WalletSignature = signAction(seller.private, OrderAuthorizationPayload(seller.account, blocked))
	restartedAdapter := NewQuantExecutionAdapter(restarted)
	if _, err := restartedAdapter.Submit(seller.session, sellerMandate, blocked); err != ErrForbidden {
		t.Fatalf("killed mandate submitted after restart: %v", err)
	}
	killedReconciliation, err := restartedAdapter.Reconcile(seller.session, sellerMandate)
	if err != nil || killedReconciliation.StrategyStatus != "killed" || killedReconciliation.ExposureMicro != 0 || len(killedReconciliation.OpenOrderIDs) != 0 || killedReconciliation.NonceDomain != sellerMandate.NonceDomain {
		t.Fatalf("killed reconciliation=%+v err=%v", killedReconciliation, err)
	}
	rotated := sellerMandate
	rotated.NonceDomain = "quant:strategy-a:session-2"
	rotated.WalletSignature = signAction(seller.private, QuantMandatePayload(rotated))
	blocked.IdempotencyKey = "quant-rotated-submit1"
	blocked.WalletSignature = signAction(seller.private, OrderAuthorizationPayload(seller.account, blocked))
	if order, err := NewQuantExecutionAdapter(restarted).Submit(seller.session, rotated, blocked); err != nil || order.Status != "open" {
		t.Fatalf("new nonce domain could not re-authorize strategy: order=%+v err=%v", order, err)
	}
	assertLedgerBalances(t, restarted.Snapshot(alice))
}

func TestQuantAdapterMandateAndForbiddenCapabilityBoundary(t *testing.T) {
	s, _, _ := newTestService(t)
	a := accountSession(t, s, alice, "quant-boundary", "exchange:read", "exchange:trade")
	adapter := NewQuantExecutionAdapter(s)
	mandate := signedQuantMandate(t, s, a, "read", "submit")
	mandate.CapitalMicro = 20 * AmountScale
	mandate.WalletSignature = signAction(a.private, QuantMandatePayload(mandate))
	req := PlaceOrderRequest{Market: DefaultMarket, Side: "buy", Type: "limit", PriceMicro: 2 * AmountScale, AmountMicro: 11 * AmountScale, IdempotencyKey: "quant-over-capital"}
	req.WalletSignature = signAction(a.private, OrderAuthorizationPayload(a.account, req))
	if _, err := adapter.Submit(a.session, mandate, req); err != ErrForbidden {
		t.Fatalf("over-capital submit err=%v", err)
	}
	wrong := mandate
	wrong.Subaccount = bob
	wrong.WalletSignature = signAction(a.private, QuantMandatePayload(wrong))
	if _, err := adapter.Account(a.session, wrong); err != ErrForbidden {
		t.Fatalf("wrong subaccount err=%v", err)
	}
	expired := mandate
	expired.ExpiresAt = s.cfg.Now().Add(-time.Second)
	expired.WalletSignature = signAction(a.private, QuantMandatePayload(expired))
	if _, err := adapter.Account(a.session, expired); err != ErrForbidden {
		t.Fatalf("expired mandate err=%v", err)
	}
	widened := mandate
	widened.Methods = append(widened.Methods, "withdraw")
	widened.WalletSignature = signAction(a.private, QuantMandatePayload(widened))
	if _, err := adapter.Account(a.session, widened); err != ErrForbidden {
		t.Fatalf("scope widening err=%v", err)
	}
	for _, capability := range QuantCapabilities() {
		switch capability.Name {
		case "withdraw", "owner_change", "withdrawal_address", "unapproved_transfer", "risk_override", "api_key_export":
			if capability.Allowed {
				t.Fatalf("forbidden capability enabled: %+v", capability)
			}
		}
	}
}
