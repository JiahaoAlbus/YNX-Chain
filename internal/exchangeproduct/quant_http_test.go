package exchangeproduct

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPQuantKillRequiresKillSignatureAndPersistsReconciliation(t *testing.T) {
	s, chain, _ := newTestService(t)
	owner := accountSession(t, s, alice, "quant-http-owner", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, owner, "cdcdcdcdcdcdcdcd", 10*AmountScale)
	mandate := signedQuantMandate(t, s, owner, "submit", "kill", "reconcile")
	mandate.CapitalMicro = 20 * AmountScale
	mandate.NonceDomain = "quant:http:session-1"
	mandate.WalletSignature = signAction(owner.private, QuantMandatePayload(mandate))

	orderRequest := PlaceOrderRequest{Market: DefaultMarket, Side: "sell", Type: "limit", PriceMicro: 2 * AmountScale, AmountMicro: AmountScale, IdempotencyKey: "quant-http-order-1"}
	orderRequest.WalletSignature = signAction(owner.private, OrderAuthorizationPayload(owner.account, orderRequest))
	if order, err := NewQuantExecutionAdapter(s).Submit(owner.session, mandate, orderRequest); err != nil || order.Status != "open" {
		t.Fatalf("open order=%+v err=%v", order, err)
	}

	s.cfg.Gateway = fixtureGateway{session: owner.session}
	s.cfg.GatewayClientID = "ynx-exchange-v1"
	server := httptest.NewServer(NewServer(s))
	defer server.Close()

	key := "quant-http-kill-1"
	postKill := func(signature string) *http.Response {
		t.Helper()
		body, err := json.Marshal(map[string]any{
			"mandate":         mandate,
			"idempotencyKey":  key,
			"walletSignature": signature,
		})
		if err != nil {
			t.Fatal(err)
		}
		req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/quant-adapter/kill", strings.NewReader(string(body)))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer central-ws-token")
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	legacySignature := signAction(owner.private, MassCancelAuthorizationPayload(owner.account, DefaultMarket, key))
	resp := postKill(legacySignature)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("legacy mass-cancel signature status=%d", resp.StatusCode)
	}
	resp.Body.Close()

	killSignature := signAction(owner.private, QuantKillAuthorizationPayload(owner.account, DefaultMarket, mandate.NonceDomain, key))
	resp = postKill(killSignature)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("kill status=%d", resp.StatusCode)
	}
	var result CancelResult
	if json.NewDecoder(resp.Body).Decode(&result) != nil || result.Count != 1 || result.Orders[0].Status != "cancelled" {
		t.Fatalf("kill result=%+v", result)
	}
	resp.Body.Close()

	reconcileBody, err := json.Marshal(map[string]any{"mandate": mandate})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/quant-adapter/reconcile", strings.NewReader(string(reconcileBody)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer central-ws-token")
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var reconciliation QuantReconciliation
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&reconciliation) != nil || reconciliation.StrategyStatus != "killed" || reconciliation.ExposureMicro != 0 || reconciliation.NonceDomain != mandate.NonceDomain || len(reconciliation.OpenOrderIDs) != 0 {
		t.Fatalf("reconciliation status=%d value=%+v", resp.StatusCode, reconciliation)
	}
}
