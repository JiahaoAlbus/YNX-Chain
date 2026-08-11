package exchangeproduct

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
)

func TestQuantLabToExchangeProducesAuthoritativeFillReceiptAndRevocationBlocksReuse(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "quant-fill-maker", "exchange:read", "exchange:trade")
	buyer := accountSession(t, s, bob, "quant-fill-taker", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "abababababababab", 2*AmountScale)
	if _, err := s.CreditTestQuote(adminKey, buyer.account, 10*AmountScale, "quant-fill-credit"); err != nil {
		t.Fatal(err)
	}
	if maker, err := place(t, s, seller, "sell", AmountScale, AmountScale, "quant-fill-maker-order"); err != nil || maker.Status != "open" {
		t.Fatalf("maker=%+v err=%v", maker, err)
	}

	quantSession := buyer.session
	quantSession.Scopes = append(quantSession.Scopes, "quant:account", "quant:mandate:create", "quant:mandate:execute", "quant:mandate:revoke")
	s.cfg.Gateway = fixtureGateway{session: quantSession, clientID: "ynx-quant-v1"}
	s.cfg.GatewayClientID = "ynx-exchange-v1"
	s.cfg.GatewayBundleID = "com.ynxweb4.exchange"
	s.cfg.QuantGatewayClientID = "ynx-quant-v1"
	s.cfg.QuantGatewayBundleID = "com.ynxweb4.quant"
	venue := httptest.NewServer(NewServer(s))
	defer venue.Close()

	now := time.Now().UTC()
	adapter := quantlab.HTTPExchangeAdapter{BaseURL: venue.URL, Client: venue.Client()}
	service, err := quantlab.New(quantlab.Config{StatePath: filepath.Join(t.TempDir(), "quant.json"), Now: func() time.Time { return now }, MandateVerifier: adapter, TestnetBroker: adapter})
	if err != nil {
		t.Fatal(err)
	}
	strategy := strings.Repeat("e", 64)
	mandate := quantlab.Mandate{Account: buyer.account, StrategyHash: strategy, Market: DefaultMarket, ProductID: quantlab.ProductID, BundleID: "com.ynxweb4.quant.web", DeviceID: "quant-authoritative-fill", NonceDomain: "quant:" + strategy, Scope: "quant:testnet-execute", Nonce: 1, MaxNotional: 2 * AmountScale, MaxPosition: 2 * AmountScale, MaxDailyLoss: AmountScale, MaxSlippageBPS: 50, MaxGas: 10_000, MaxOrdersPerMinute: 10, MaxLeverageBPS: 20_000, MaxDrawdown: AmountScale, MinLiquidity: 2 * AmountScale, MaxVaR: 300_000, MaxExpectedShortfall: 400_000, MaxDepegBPS: 100, MaxConcentrationBPS: 5_000, MaxCancelRateBPS: 5_000, MaxConsecutiveAPIFailures: 3, ExpiresAt: now.Add(time.Hour), TestnetOnly: true}
	mandate.WalletSignature = signAction(buyer.private, quantlab.ExchangeMandateSigningPayload(mandate))
	registered, err := service.RegisterMandateWithSession(context.Background(), mandate, "central-ws-token")
	if err != nil {
		t.Fatal(err)
	}
	order := quantlab.TestnetOrder{Market: DefaultMarket, Side: "buy", Price: AmountScale, Amount: AmountScale, IdempotencyKey: "quant-authoritative-fill-order"}
	order.WalletSignature = signAction(buyer.private, quantlab.ExchangeOrderSigningPayload(buyer.account, order))
	risk := quantlab.TestnetRiskObservation{ReferencePrice: AmountScale, EstimatedGas: 100, Equity: 10 * AmountScale, GrossExposure: 0, PeakEquity: 10 * AmountScale, CurrentEquity: 10 * AmountScale, AvailableLiquidity: 10 * AmountScale, DepegBPS: 0, ConcentrationBPS: 1_000, OrdersObserved: 0, CancelsObserved: 0, ConsecutiveAPIFailures: 0, VaR: 100_000, ExpectedShortfall: 150_000, OracleAsOf: now, VenueHealthy: true}
	submitted, err := service.SubmitTestnetWithSession(context.Background(), registered.Digest, order.Side, order.Price, order.Amount, order.IdempotencyKey, order.WalletSignature, "central-ws-token", risk)
	if err != nil || submitted.VenueStatus != "filled" || submitted.VenueOrderID == "" || len(submitted.AuthorizationDigest) != 64 || len(submitted.BrokerProof) != 64 {
		t.Fatalf("submitted=%+v err=%v", submitted, err)
	}
	account := s.Snapshot(buyer.account)
	if len(account.Trades) != 1 || account.Orders[len(account.Orders)-1].Status != "filled" || account.Orders[len(account.Orders)-1].ID != submitted.VenueOrderID {
		t.Fatalf("authoritative Exchange state does not match Quant receipt: %+v", account)
	}
	if _, err := service.RevokeMandate(registered.Digest, "wallet-user"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SubmitTestnetWithSession(context.Background(), registered.Digest, "buy", AmountScale, 1, "quant-revoked-fill-order", order.WalletSignature, "central-ws-token", risk); err != quantlab.ErrForbidden {
		t.Fatalf("revoked mandate reached execution path: %v", err)
	}
}

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

	quantSession := owner.session
	quantSession.Scopes = append(quantSession.Scopes, "quant:account", "quant:mandate:create", "quant:mandate:execute")
	s.cfg.Gateway = fixtureGateway{session: quantSession, clientID: "ynx-quant-v1"}
	s.cfg.GatewayClientID = "ynx-exchange-v1"
	s.cfg.GatewayBundleID = "com.ynxweb4.exchange"
	s.cfg.QuantGatewayClientID = "ynx-quant-v1"
	s.cfg.QuantGatewayBundleID = "com.ynxweb4.quant"
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
		req.Header.Set("X-YNX-Product-Session-Proof", "central-ws-token")
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
	req.Header.Set("X-YNX-Product-Session-Proof", "central-ws-token")
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
