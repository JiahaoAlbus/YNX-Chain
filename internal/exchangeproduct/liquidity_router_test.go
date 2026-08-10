package exchangeproduct

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func dexQuoteServer(t *testing.T, now time.Time, version string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /dex/assets", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"source": "ynx-consensus-abci", "version": version, "failure": false, "coverage": map[string]any{"complete": true}, "assets": []map[string]any{{"id": "yusd-route", "decimals": 6}}})
	})
	mux.HandleFunc("GET /dex/pools", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"source": "ynx-consensus-abci", "version": version, "failure": false, "coverage": map[string]any{"complete": true}, "pools": []map[string]any{{"id": "ynxt-yusd-route-30", "kind": "ynx-cpmm-v1", "asset0": NativeAsset, "asset1": "yusd-route", "reserve0": 1_000, "reserve1": 2_000_000_000, "feeBps": 30, "blockHeight": 912, "updatedAt": now, "auditHash": strings.Repeat("a", 64)}}})
	})
	return httptest.NewServer(mux)
}

func TestUltraLiquidityNativeCLOBUsesCompleteExecutableDepth(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "route-seller", "exchange:read", "exchange:trade", "exchange:deposit")
	confirmDeposit(t, s, chain, seller, "cafe000000000001", 3*AmountScale)
	if _, err := place(t, s, seller, "sell", 2*AmountScale, AmountScale, "route-ask-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, seller, "sell", 3*AmountScale, 2*AmountScale, "route-ask-2"); err != nil {
		t.Fatal(err)
	}
	quote, err := s.LiquidityQuote(LiquidityQuoteRequest{Side: "buy", AmountMicro: 2 * AmountScale})
	if err != nil || quote.Status != "quoted_not_signed" || quote.Selected == nil || quote.Selected.VenueType != "native_clob" {
		t.Fatalf("quote=%+v err=%v", quote, err)
	}
	if quote.Selected.GrossQuoteMicro != 5*AmountScale || quote.Selected.Cost.TradingFeeMicro != 10_000 || quote.Selected.AllInQuoteMicro != 5*AmountScale+10_000 || quote.Selected.AveragePriceMicro != 2_500_000 {
		t.Fatalf("selected=%+v", quote.Selected)
	}
	tooLarge, err := s.LiquidityQuote(LiquidityQuoteRequest{Side: "buy", AmountMicro: 4 * AmountScale})
	if err != nil || tooLarge.Status != "unavailable" || tooLarge.Candidates[0].Status != "unavailable" || !strings.Contains(tooLarge.Candidates[0].UnavailableReason, "complete") {
		t.Fatalf("tooLarge=%+v err=%v", tooLarge, err)
	}
}

func TestUltraLiquiditySelectsRealConsensusDEXQuoteAndRejectsWrongSourceVersion(t *testing.T) {
	now := time.Date(2026, 8, 10, 4, 0, 0, 0, time.UTC)
	dex := dexQuoteServer(t, now, "abci-state-v13")
	defer dex.Close()
	s, chain, _ := newTestService(t)
	s.cfg.Now = func() time.Time { return now }
	s.cfg.DEXGatewayURL, s.cfg.DEXQuoteAssetID = dex.URL, "yusd-route"
	s.cfg.DEXQuoteAssetAttestationDigest = strings.Repeat("b", 64)
	s.cfg.DEXGasMicro, s.cfg.DEXLatencyMillis, s.cfg.DEXFinalitySeconds = 5_000, 40, 3
	seller := accountSession(t, s, alice, "route-dex-seller", "exchange:read", "exchange:trade", "exchange:deposit")
	confirmDeposit(t, s, chain, seller, "cafe000000000002", 2*AmountScale)
	if _, err := place(t, s, seller, "sell", 3*AmountScale, 2*AmountScale, "route-expensive-ask"); err != nil {
		t.Fatal(err)
	}
	quote, err := s.LiquidityQuote(LiquidityQuoteRequest{Market: DefaultMarket, Side: "buy", AmountMicro: AmountScale})
	if err != nil || quote.Selected == nil || quote.Selected.VenueType != "consensus_cpmm" || quote.Selected.SourceBlockHeight != 912 || quote.Selected.SourceVersion != "abci-state-v13" || quote.Selected.Cost.GasMicro == nil || *quote.Selected.Cost.GasMicro != 5_000 {
		t.Fatalf("quote=%+v err=%v", quote, err)
	}
	if quote.Selected.AllInQuoteMicro >= quote.Candidates[0].AllInQuoteMicro || quote.Selected.ExecutionMethod != "dex_swap_exact_output" {
		t.Fatalf("router did not choose lowest complete buy cost: %+v", quote)
	}
	if quote.Selected.Cost.PriceImpactMicro == nil || *quote.Selected.Cost.PriceImpactMicro <= 0 || *quote.Selected.Cost.PriceImpactMicro >= AmountScale {
		t.Fatalf("DEX price impact was not normalized into quote micro-units: %+v", quote.Selected.Cost)
	}

	wrong := dexQuoteServer(t, now, "abci-state-v12")
	defer wrong.Close()
	s.cfg.DEXGatewayURL = wrong.URL
	wrongQuote, err := s.LiquidityQuote(LiquidityQuoteRequest{Side: "buy", AmountMicro: AmountScale})
	if err != nil || wrongQuote.Candidates[1].Status != "unavailable" || !strings.Contains(wrongQuote.Candidates[1].UnavailableReason, "wrong source version") {
		t.Fatalf("wrong-version quote=%+v err=%v", wrongQuote, err)
	}
}

func TestUltraLiquiditySellChoosesHighestAllInProceedsAndFractionalDEXFailsClosed(t *testing.T) {
	now := time.Date(2026, 8, 10, 5, 0, 0, 0, time.UTC)
	dex := dexQuoteServer(t, now, "abci-state-v13")
	defer dex.Close()
	s, _, _ := newTestService(t)
	s.cfg.Now = func() time.Time { return now }
	s.cfg.DEXGatewayURL, s.cfg.DEXQuoteAssetID = dex.URL, "yusd-route"
	s.cfg.DEXQuoteAssetAttestationDigest = strings.Repeat("b", 64)
	buyer := accountSession(t, s, bob, "route-buyer", "exchange:read", "exchange:trade")
	if _, err := s.CreditTestQuote(adminKey, bob, 10*AmountScale, "route-bid-credit"); err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, s, buyer, "buy", 3*AmountScale, AmountScale, "route-bid"); err != nil {
		t.Fatal(err)
	}
	quote, err := s.LiquidityQuote(LiquidityQuoteRequest{Side: "sell", AmountMicro: AmountScale})
	if err != nil || quote.Selected == nil || quote.Selected.VenueType != "native_clob" || quote.Selected.AllInQuoteMicro <= quote.Candidates[1].AllInQuoteMicro {
		t.Fatalf("sell quote=%+v err=%v", quote, err)
	}
	fractional, err := s.LiquidityQuote(LiquidityQuoteRequest{Side: "sell", AmountMicro: AmountScale / 2})
	if err != nil || fractional.Candidates[1].Status != "unavailable" || !strings.Contains(fractional.Candidates[1].UnavailableReason, "whole YNXT") {
		t.Fatalf("fractional=%+v err=%v", fractional, err)
	}
}

func TestUltraLiquidityHTTPRejectsInvalidAmountAndReturnsStructuredUnavailable(t *testing.T) {
	s, _, _ := newTestService(t)
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	resp, err := http.Get(server.URL + "/v1/liquidity/quote?side=buy&amountMicro=nope")
	if err != nil || resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid err=%v status=%v", err, resp.StatusCode)
	}
	resp.Body.Close()
	resp, err = http.Get(server.URL + "/v1/liquidity/quote?side=buy&amountMicro=1000000")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("quote err=%v status=%v", err, resp.StatusCode)
	}
	var quote LiquidityRouteQuote
	if err := json.NewDecoder(resp.Body).Decode(&quote); err != nil || quote.Status != "unavailable" || len(quote.Candidates) != 2 {
		t.Fatalf("quote=%+v err=%v", quote, err)
	}
	resp.Body.Close()
}

func TestUltraLiquidityConfigurationRequiresQuoteAssetSettlementAttestation(t *testing.T) {
	_, err := New(Config{StatePath: t.TempDir() + "/state.json", APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback", DEXGatewayURL: "https://dex.invalid", DEXQuoteAssetID: "yusd-route"})
	if err == nil {
		t.Fatal("DEX quote asset without a settlement-equivalence attestation was accepted")
	}
	_, err = New(Config{StatePath: t.TempDir() + "/state.json", APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback", DEXGatewayURL: "https://dex.invalid", DEXQuoteAssetID: "yusd-route", DEXQuoteAssetAttestationDigest: strings.Repeat("b", 64)})
	if err != nil {
		t.Fatalf("complete DEX router configuration rejected: %v", err)
	}
}

func TestUltraLiquidityWalletSignedNativeFOKExecutionIsAtomicAndReplaySafe(t *testing.T) {
	s, chain, _ := newTestService(t)
	seller := accountSession(t, s, alice, "route-execute-seller", "exchange:read", "exchange:trade", "exchange:deposit")
	buyer := accountSession(t, s, bob, "route-execute-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, seller, "cafe000000000004", 2*AmountScale)
	if _, err := place(t, s, seller, "sell", 2*AmountScale, 2*AmountScale, "route-execute-ask"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreditTestQuote(adminKey, bob, 10*AmountScale, "route-execute-credit"); err != nil {
		t.Fatal(err)
	}
	native := PlaceOrderRequest{Market: DefaultMarket, Side: "buy", Type: "limit", TimeInForce: "fok", PriceMicro: 2 * AmountScale, AmountMicro: 2 * AmountScale, IdempotencyKey: "route-execute-native"}
	native.WalletSignature = signAction(buyer.private, OrderAuthorizationPayload(buyer.account, native))
	req := LiquidityExecutionRequest{Quote: LiquidityQuoteRequest{Market: DefaultMarket, Side: "buy", AmountMicro: 2 * AmountScale}, SelectedVenueType: "native_clob", MaxSpendMicro: 5 * AmountScale, ExpiresAt: s.cfg.Now().UTC().Add(time.Minute), NativeOrder: native, IdempotencyKey: native.IdempotencyKey}
	req.WalletSignature = signAction(buyer.private, LiquidityExecutionAuthorizationPayload(buyer.account, req))
	result, err := s.ExecuteLiquidityRoute(buyer.session, req)
	if err != nil || result.Status != "filled" || result.NativeOrder == nil || result.NativeOrder.FilledMicro != 2*AmountScale {
		t.Fatalf("execution=%+v err=%v", result, err)
	}
	replay, err := s.ExecuteLiquidityRoute(buyer.session, req)
	if err != nil || replay.NativeOrder == nil || replay.NativeOrder.ID != result.NativeOrder.ID || len(s.Snapshot(bob).Trades) != 1 {
		t.Fatalf("replay=%+v err=%v", replay, err)
	}
}

func TestUltraLiquidityExecutionRejectsRouteMutationAndUnavailableDEXAdapter(t *testing.T) {
	now := time.Date(2026, 8, 10, 8, 0, 0, 0, time.UTC)
	dex := dexQuoteServer(t, now, "abci-state-v13")
	defer dex.Close()
	s, _, _ := newTestService(t)
	s.cfg.Now = func() time.Time { return now }
	s.cfg.DEXGatewayURL, s.cfg.DEXQuoteAssetID, s.cfg.DEXQuoteAssetAttestationDigest = dex.URL, "yusd-route", strings.Repeat("b", 64)
	buyer := accountSession(t, s, bob, "route-execute-dex", "exchange:read", "exchange:trade")
	req := LiquidityExecutionRequest{Quote: LiquidityQuoteRequest{Market: DefaultMarket, Side: "buy", AmountMicro: AmountScale}, SelectedVenueType: "consensus_cpmm", MaxSpendMicro: 3 * AmountScale, ExpiresAt: now.Add(time.Minute), IdempotencyKey: "route-execute-dex"}
	req.WalletSignature = signAction(buyer.private, LiquidityExecutionAuthorizationPayload(buyer.account, req))
	if _, err := s.ExecuteLiquidityRoute(buyer.session, req); err == nil || !strings.Contains(err.Error(), "adapter") {
		t.Fatalf("DEX execution without adapter err=%v", err)
	}
	mutated := req
	mutated.MaxSpendMicro++
	if _, err := s.ExecuteLiquidityRoute(buyer.session, mutated); err != ErrUnauthorized {
		t.Fatalf("mutated signed route err=%v", err)
	}
}
