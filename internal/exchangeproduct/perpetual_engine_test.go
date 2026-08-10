package exchangeproduct

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
)

func signedMarginTransfer(a testAccount, direction string, amount int64, key string) MarginTransferRequest {
	req := MarginTransferRequest{Direction: direction, AmountMicro: amount, IdempotencyKey: key}
	req.WalletSignature = signAction(a.private, MarginTransferAuthorizationPayload(a.account, req))
	return req
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
