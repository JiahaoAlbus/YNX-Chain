package exchangeproduct

import "testing"

func TestQuantAdapterEnforcesAggregateCapitalAcrossRestart(t *testing.T) {
	s, chain, _ := newTestService(t)
	owner := accountSession(t, s, alice, "quant-capital-owner", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, owner, "abababababababab", 20*AmountScale)
	mandate := signedQuantMandate(t, s, owner, "submit", "cancel", "reconcile")
	mandate.CapitalMicro = 20 * AmountScale
	mandate.NonceDomain = "quant:capital:session-1"
	mandate.WalletSignature = signAction(owner.private, QuantMandatePayload(mandate))
	adapter := NewQuantExecutionAdapter(s)

	firstRequest := PlaceOrderRequest{Market: DefaultMarket, Side: "sell", Type: "limit", PriceMicro: 2 * AmountScale, AmountMicro: 6 * AmountScale, IdempotencyKey: "quant-capital-first"}
	firstRequest.WalletSignature = signAction(owner.private, OrderAuthorizationPayload(owner.account, firstRequest))
	first, err := adapter.Submit(owner.session, mandate, firstRequest)
	if err != nil || first.QuantNonceDomain != mandate.NonceDomain {
		t.Fatalf("first aggregate order=%+v err=%v", first, err)
	}

	secondRequest := PlaceOrderRequest{Market: DefaultMarket, Side: "sell", Type: "limit", PriceMicro: 2 * AmountScale, AmountMicro: 4 * AmountScale, IdempotencyKey: "quant-capital-second"}
	secondRequest.WalletSignature = signAction(owner.private, OrderAuthorizationPayload(owner.account, secondRequest))
	if second, err := adapter.Submit(owner.session, mandate, secondRequest); err != nil || second.Status != "open" {
		t.Fatalf("second aggregate order=%+v err=%v", second, err)
	}

	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatalf("restart aggregate state: %v", err)
	}
	restartedAdapter := NewQuantExecutionAdapter(restarted)
	reconciliation, err := restartedAdapter.Reconcile(owner.session, mandate)
	if err != nil || reconciliation.StrategyStatus != "active" || reconciliation.ExposureMicro != mandate.CapitalMicro || len(reconciliation.OpenOrderIDs) != 2 || reconciliation.CapitalMicro != mandate.CapitalMicro {
		t.Fatalf("aggregate reconciliation=%+v err=%v", reconciliation, err)
	}
	thirdRequest := PlaceOrderRequest{Market: DefaultMarket, Side: "sell", Type: "limit", PriceMicro: 2 * AmountScale, AmountMicro: AmountScale, IdempotencyKey: "quant-capital-third"}
	thirdRequest.WalletSignature = signAction(owner.private, OrderAuthorizationPayload(owner.account, thirdRequest))
	if _, err := NewQuantExecutionAdapter(restarted).Submit(owner.session, mandate, thirdRequest); err != ErrForbidden {
		t.Fatalf("aggregate capital limit was not persisted: %v", err)
	}

	cancelKey := "quant-capital-cancel-first"
	cancelSignature := signAction(owner.private, OrderCancelAuthorizationPayload(owner.account, first.ID, cancelKey))
	if cancelled, err := NewQuantExecutionAdapter(restarted).Cancel(owner.session, mandate, first.ID, cancelKey, cancelSignature); err != nil || cancelled.Status != "cancelled" {
		t.Fatalf("cancel released aggregate exposure: order=%+v err=%v", cancelled, err)
	}
	thirdRequest.IdempotencyKey = "quant-capital-third-retry"
	thirdRequest.WalletSignature = signAction(owner.private, OrderAuthorizationPayload(owner.account, thirdRequest))
	if third, err := NewQuantExecutionAdapter(restarted).Submit(owner.session, mandate, thirdRequest); err != nil || third.Status != "open" {
		t.Fatalf("released capital could not be reused: order=%+v err=%v", third, err)
	}
	assertLedgerBalances(t, restarted.Snapshot(alice))
}
