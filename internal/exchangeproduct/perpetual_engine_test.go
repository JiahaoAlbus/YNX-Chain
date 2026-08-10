package exchangeproduct

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
	"time"
)

func signedMarginTransfer(a testAccount, direction string, amount int64, key string) MarginTransferRequest {
	req := MarginTransferRequest{Direction: direction, AmountMicro: amount, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, MarginTransferAuthorizationPayload(a.account, req))
	return req
}

func signedPerpetualOrder(a testAccount, side string, price, amount, leverage int64, reduceOnly bool, key string) PlacePerpetualOrderRequest {
	req := PlacePerpetualOrderRequest{Market: DefaultPerpetualMarket, Side: side, Type: "limit", TimeInForce: "gtc", PriceMicro: price, AmountMicro: amount, Leverage: leverage, ReduceOnly: reduceOnly, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, PerpetualOrderAuthorizationPayload(a.account, req))
	return req
}

func activatePerpetualOracle(t *testing.T, s *Service, now time.Time, sequence, price int64) *fakeRiskOracle {
	t.Helper()
	oracle := &fakeRiskOracle{snapshot: signedRiskSnapshot(now, sequence, price, price, 10, 10_000)}
	s.cfg.Now = func() time.Time { return now }
	s.cfg.Oracle = oracle
	s.cfg.OracleURL = "https://oracle.test.invalid"
	if snapshot, err := s.RefreshRiskOracle(); err != nil || snapshot.Status != "active" {
		t.Fatalf("activate oracle snapshot=%+v err=%v", snapshot, err)
	}
	return oracle
}

func TestMarginCollateralTransferIsConservedAuthorizedAndPersistent(t *testing.T) {
	s, _, path := newTestService(t)
	a := accountSession(t, s, alice, "margin-owner", "exchange:read", "exchange:trade")
	if _, err := s.CreditTestQuote("Bearer "+adminKey, alice, 20*AmountScale, "margin-credit-01"); err != nil {
		t.Fatal(err)
	}
	deposit := signedMarginTransfer(a, "deposit", 12*AmountScale, "margin-deposit-01")
	got, err := s.TransferMarginCollateral(a.session, deposit)
	if err != nil || got.Account.CollateralMicro != 12*AmountScale || got.FreeCollateralMicro != 12*AmountScale {
		t.Fatalf("deposit snapshot=%+v err=%v", got, err)
	}
	balance := s.Snapshot(alice).Balances[1]
	if balance.AvailableMicro != 8*AmountScale || balance.ReservedMicro != 12*AmountScale {
		t.Fatalf("margin transfer did not conserve quote balance: %+v", balance)
	}
	replay, err := s.TransferMarginCollateral(a.session, deposit)
	if err != nil || !reflect.DeepEqual(got, replay) {
		t.Fatalf("idempotent replay changed result: got=%+v replay=%+v err=%v", got, replay, err)
	}
	conflict := signedMarginTransfer(a, "deposit", AmountScale, deposit.IdempotencyKey)
	if _, err := s.TransferMarginCollateral(a.session, conflict); err != ErrConflict {
		t.Fatalf("conflicting idempotency key err=%v", err)
	}
	bad := signedMarginTransfer(a, "withdraw", AmountScale, "margin-bad-signature")
	bad.WalletSignature = "00"
	if _, err := s.TransferMarginCollateral(a.session, bad); err != ErrUnauthorized {
		t.Fatalf("bad wallet signature err=%v", err)
	}
	withdraw := signedMarginTransfer(a, "withdraw", 5*AmountScale, "margin-withdraw-01")
	got, err = s.TransferMarginCollateral(a.session, withdraw)
	if err != nil || got.Account.CollateralMicro != 7*AmountScale || got.FreeCollateralMicro != 7*AmountScale {
		t.Fatalf("withdraw snapshot=%+v err=%v", got, err)
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.cfg.StatePath != path {
		t.Fatalf("restart state path=%q", restarted.cfg.StatePath)
	}
	if after := restarted.MarginSnapshot(alice); !reflect.DeepEqual(got, after) {
		t.Fatalf("restart changed margin state: before=%+v after=%+v", got, after)
	}
}

func TestMarginTransferConcurrentReplayAndHTTPAuthorization(t *testing.T) {
	s, _, _ := newTestService(t)
	a := accountSession(t, s, alice, "margin-http", "exchange:read", "exchange:trade")
	if _, err := s.CreditTestQuote("Bearer "+adminKey, alice, 10*AmountScale, "margin-credit-02"); err != nil {
		t.Fatal(err)
	}
	req := signedMarginTransfer(a, "deposit", 3*AmountScale, "margin-concurrent-01")
	var wg sync.WaitGroup
	errs := make(chan error, 16)
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.TransferMarginCollateral(a.session, req)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent replay err=%v", err)
		}
	}
	if got := s.MarginSnapshot(alice).Account.CollateralMicro; got != 3*AmountScale {
		t.Fatalf("concurrent replay collateral=%d", got)
	}

	s.cfg.Gateway = fixtureGateway{session: a.session}
	s.cfg.GatewayClientID = "ynx-exchange-v1"
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	response, err := http.Get(server.URL + "/v1/margin/account")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous margin status=%d", response.StatusCode)
	}
	body, _ := json.Marshal(signedMarginTransfer(a, "withdraw", AmountScale, "margin-http-withdraw"))
	httpReq, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/margin/transfer", bytes.NewReader(body))
	httpReq.Header.Set("Authorization", "Bearer central-ws-token")
	httpReq.Header.Set("Content-Type", "application/json")
	response, err = http.DefaultClient.Do(httpReq)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("authorized margin status=%d", response.StatusCode)
	}
}

func TestPerpetualPriceTimeMatchPositionsPnLFeesAndRestart(t *testing.T) {
	s, _, _ := newTestService(t)
	now := time.Date(2026, 8, 10, 5, 0, 0, 0, time.UTC)
	oracle := activatePerpetualOracle(t, s, now, 1, 2*AmountScale)
	long := accountSession(t, s, alice, "perp-long", "exchange:read", "exchange:trade")
	short := accountSession(t, s, bob, "perp-short", "exchange:read", "exchange:trade")
	for index, owner := range []testAccount{long, short} {
		if _, err := s.CreditTestQuote("Bearer "+adminKey, owner.account, 100*AmountScale, "perp-credit-0"+string(rune('1'+index))); err != nil {
			t.Fatal(err)
		}
		transfer := signedMarginTransfer(owner, "deposit", 50*AmountScale, "perp-margin-0"+string(rune('1'+index)))
		if _, err := s.TransferMarginCollateral(owner.session, transfer); err != nil {
			t.Fatal(err)
		}
	}
	buyOpen, err := s.PlacePerpetualOrder(long.session, signedPerpetualOrder(long, "buy", 2*AmountScale, 5*AmountScale, 5, false, "perp-open-long"))
	if err != nil || buyOpen.Status != "open" {
		t.Fatalf("long open=%+v err=%v", buyOpen, err)
	}
	sellOpen, err := s.PlacePerpetualOrder(short.session, signedPerpetualOrder(short, "sell", 2*AmountScale, 5*AmountScale, 5, false, "perp-open-short"))
	if err != nil || sellOpen.Status != "filled" {
		t.Fatalf("short open=%+v err=%v", sellOpen, err)
	}
	longPosition := s.MarginSnapshot(alice).Positions[0]
	shortPosition := s.MarginSnapshot(bob).Positions[0]
	if longPosition.SizeMicro != 5*AmountScale || shortPosition.SizeMicro != -5*AmountScale || longPosition.EntryPriceMicro != 2*AmountScale || shortPosition.EntryPriceMicro != 2*AmountScale {
		t.Fatalf("opening positions long=%+v short=%+v", longPosition, shortPosition)
	}

	now = now.Add(time.Second)
	oracle.snapshot = signedRiskSnapshot(now, 2, 3*AmountScale, 3*AmountScale, 10, 10_000)
	if _, err := s.RefreshRiskOracle(); err != nil {
		t.Fatal(err)
	}
	funding, err := s.SettlePerpetualFunding()
	if err != nil || len(funding) != 2 {
		t.Fatalf("funding=%+v err=%v", funding, err)
	}
	if funding[0].PaymentMicro+funding[1].PaymentMicro != 0 {
		t.Fatalf("funding is not zero-sum: %+v", funding)
	}
	if _, err := s.SettlePerpetualFunding(); err != ErrConflict {
		t.Fatalf("duplicate funding settlement err=%v", err)
	}
	buyClose, err := s.PlacePerpetualOrder(short.session, signedPerpetualOrder(short, "buy", 3*AmountScale, 5*AmountScale, 5, true, "perp-close-short"))
	if err != nil || buyClose.Status != "open" {
		t.Fatalf("short close order=%+v err=%v", buyClose, err)
	}
	sellClose, err := s.PlacePerpetualOrder(long.session, signedPerpetualOrder(long, "sell", 3*AmountScale, 5*AmountScale, 5, true, "perp-close-long"))
	if err != nil || sellClose.Status != "filled" {
		t.Fatalf("long close order=%+v err=%v", sellClose, err)
	}
	longSnapshot, shortSnapshot := s.MarginSnapshot(alice), s.MarginSnapshot(bob)
	if longSnapshot.Positions[0].Status != "closed" || shortSnapshot.Positions[0].Status != "closed" || longSnapshot.Account.RealizedPnLMicro != 5*AmountScale || shortSnapshot.Account.RealizedPnLMicro != -5*AmountScale {
		t.Fatalf("closed PnL long=%+v short=%+v", longSnapshot, shortSnapshot)
	}
	if len(longSnapshot.Trades) != 2 || len(shortSnapshot.Trades) != 2 || len(longSnapshot.Funding) != 1 || len(shortSnapshot.Funding) != 1 || longSnapshot.Account.FundingPaidMicro <= 0 || shortSnapshot.Account.FundingPaidMicro >= 0 || s.RiskSnapshot().Market.OpenInterestMicro != 0 || s.RiskSnapshot().InsuranceFund.BalanceMicro <= 0 {
		t.Fatalf("trade/risk close state long=%+v short=%+v risk=%+v", longSnapshot, shortSnapshot, s.RiskSnapshot())
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	restartedLong, restartedShort := restarted.MarginSnapshot(alice), restarted.MarginSnapshot(bob)
	if !reflect.DeepEqual(longSnapshot, restartedLong) || !reflect.DeepEqual(shortSnapshot, restartedShort) {
		t.Fatalf("perpetual account state changed across restart\nlong before=%+v\nlong after=%+v\nshort before=%+v\nshort after=%+v", longSnapshot, restartedLong, shortSnapshot, restartedShort)
	}
}

func TestPerpetualRejectsStaleOraclePriceBandSelfTradeAndBadAuthorization(t *testing.T) {
	s, _, _ := newTestService(t)
	now := time.Date(2026, 8, 10, 6, 0, 0, 0, time.UTC)
	activatePerpetualOracle(t, s, now, 1, 2*AmountScale)
	a := accountSession(t, s, alice, "perp-policy", "exchange:read", "exchange:trade")
	if _, err := s.CreditTestQuote("Bearer "+adminKey, alice, 30*AmountScale, "perp-policy-credit"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.TransferMarginCollateral(a.session, signedMarginTransfer(a, "deposit", 20*AmountScale, "perp-policy-margin")); err != nil {
		t.Fatal(err)
	}
	bad := signedPerpetualOrder(a, "buy", 2*AmountScale, AmountScale, 2, false, "perp-bad-signature")
	bad.WalletSignature = "00"
	if _, err := s.PlacePerpetualOrder(a.session, bad); err != ErrUnauthorized {
		t.Fatalf("bad authorization err=%v", err)
	}
	outside := signedPerpetualOrder(a, "buy", 3*AmountScale, AmountScale, 2, false, "perp-price-band")
	if _, err := s.PlacePerpetualOrder(a.session, outside); err != ErrForbidden {
		t.Fatalf("price band err=%v", err)
	}
	if _, err := s.PlacePerpetualOrder(a.session, signedPerpetualOrder(a, "buy", 2*AmountScale, AmountScale, 2, false, "perp-self-buy")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PlacePerpetualOrder(a.session, signedPerpetualOrder(a, "sell", 2*AmountScale, AmountScale, 2, false, "perp-self-sell")); err != ErrForbidden {
		t.Fatalf("self trade err=%v", err)
	}
	s.cfg.Now = func() time.Time { return now.Add(time.Minute) }
	if _, err := s.PlacePerpetualOrder(a.session, signedPerpetualOrder(a, "buy", 2*AmountScale, AmountScale, 2, false, "perp-stale-oracle")); err != ErrUnavailable {
		t.Fatalf("stale oracle err=%v", err)
	}
}
