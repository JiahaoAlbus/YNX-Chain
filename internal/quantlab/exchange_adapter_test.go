package quantlab

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestHTTPExchangeAdapterUsesExactMandateAndIndependentOrderSignature(t *testing.T) {
	now := time.Date(2026, 8, 10, 4, 5, 6, 0, time.UTC)
	strategy := strings.Repeat("a", 64)
	mandate := validMandate(now, strategy)
	mandate.Account = "ynx1quantaccount"
	mandate.MaxPosition = 2_000_000
	mandate.ExpiresAt = now.Add(time.Hour)
	mandate.WalletSignature = "mandate-wallet-signature"
	order := TestnetOrder{Market: mandate.Market, Side: "buy", Price: 1_000_000, Amount: 1_000_000, IdempotencyKey: "quant-order-001", WalletSignature: "order-wallet-signature"}

	wantMandate := "ynx-quant-execution-adapter-v1\nynx1quantaccount\nYNXT-YUSD_TEST\nkill,read,reconcile,submit\n2000000\n1\n2026-08-10T05:05:06Z\nquant:" + strategy
	if got := string(ExchangeMandateSigningPayload(mandate)); got != wantMandate {
		t.Fatalf("mandate payload changed\n got: %q\nwant: %q", got, wantMandate)
	}
	wantOrder := "ynx-exchange-order-v1\nynx1quantaccount\nYNXT-YUSD_TEST\nbuy\nlimit\n1000000\n1000000\nquant-order-001"
	if got := string(ExchangeOrderSigningPayload(mandate.Account, order)); got != wantOrder {
		t.Fatalf("order payload changed\n got: %q\nwant: %q", got, wantOrder)
	}

	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer short-lived-user-session" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("request authorization boundary missing: %v", r.Header)
		}
		var envelope struct {
			Mandate exchangeQuantMandate `json:"mandate"`
			Order   exchangeOrderRequest `json:"order"`
		}
		if err := json.NewDecoder(r.Body).Decode(&envelope); err != nil {
			t.Fatal(err)
		}
		if string(ExchangeMandateSigningPayload(mandate)) != string(exchangeMandatePayload(envelope.Mandate)) {
			t.Fatalf("wire mandate differs: %+v", envelope.Mandate)
		}
		switch r.URL.Path {
		case "/v1/quant-adapter/account":
			_ = json.NewEncoder(w).Encode(exchangeAccountState{Source: exchangeSource{Source: "ynx-exchange", Version: ExchangeQuantAdapterVersion, Status: "available"}})
		case "/v1/quant-adapter/orders":
			if envelope.Order.WalletSignature != "order-wallet-signature" || envelope.Order.Type != "limit" || envelope.Order.TimeInForce != "gtc" {
				t.Fatalf("independent order authorization lost: %+v", envelope.Order)
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(exchangeOrderResponse{ID: "exchange-order-001", Account: mandate.Account, Market: mandate.Market, Side: order.Side, PriceMicro: order.Price, AmountMicro: order.Amount, Status: "open", QuantNonceDomain: mandate.NonceDomain, WalletAuthorized: true, AuthorizationDigest: strings.Repeat("b", 64)})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	adapter := HTTPExchangeAdapter{BaseURL: server.URL, Client: server.Client()}
	if err := adapter.VerifyMandate(context.Background(), mandate, "short-lived-user-session"); err != nil {
		t.Fatal(err)
	}
	proof, err := adapter.SubmitTestnet(context.Background(), mandate, order, "short-lived-user-session")
	if err != nil || len(proof) != 64 || calls.Load() != 2 {
		t.Fatalf("proof=%q calls=%d err=%v", proof, calls.Load(), err)
	}
}

func exchangeMandatePayload(m exchangeQuantMandate) []byte {
	mandate := Mandate{Account: m.Subaccount, Market: m.Market, MaxPosition: m.CapitalMicro, ExpiresAt: m.ExpiresAt, NonceDomain: m.NonceDomain, WalletSignature: m.WalletSignature}
	return ExchangeMandateSigningPayload(mandate)
}

type concurrentBroker struct {
	calls   atomic.Int64
	entered chan string
	release chan struct{}
}

func (b *concurrentBroker) SubmitTestnet(ctx context.Context, _ Mandate, order TestnetOrder, session string) (string, error) {
	b.calls.Add(1)
	b.entered <- session + ":" + order.IdempotencyKey
	select {
	case <-b.release:
		return "broker-proof-" + order.IdempotencyKey, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func TestTestnetBrokerCallsRunConcurrentlyAndSessionsNeverPersist(t *testing.T) {
	now := time.Date(2026, 8, 10, 6, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "state.json")
	broker := &concurrentBroker{entered: make(chan string, 2), release: make(chan struct{})}
	service, err := New(Config{StatePath: statePath, Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: broker})
	if err != nil {
		t.Fatal(err)
	}
	first := validMandate(now, strings.Repeat("a", 64))
	first.Nonce = 1
	first, err = service.RegisterMandateWithSession(context.Background(), first, "mandate-session-one")
	if err != nil {
		t.Fatal(err)
	}
	second := validMandate(now, strings.Repeat("b", 64))
	second.Nonce = 2
	second, err = service.RegisterMandateWithSession(context.Background(), second, "mandate-session-two")
	if err != nil {
		t.Fatal(err)
	}

	type result struct{ err error }
	results := make(chan result, 2)
	go func() {
		_, err := service.SubmitTestnetWithSession(context.Background(), first.Digest, "buy", 1_000_000, 1, "concurrent-order-one", "signature-one", "order-session-one", validRisk(now))
		results <- result{err: err}
	}()
	select {
	case <-broker.entered:
	case <-time.After(time.Second):
		t.Fatal("first request did not enter broker")
	}
	go func() {
		_, err := service.SubmitTestnetWithSession(context.Background(), second.Digest, "buy", 1_000_000, 1, "concurrent-order-two", "signature-two", "order-session-two", validRisk(now))
		results <- result{err: err}
	}()
	select {
	case <-broker.entered:
		// Both remote calls entered before either was released: no global lock
		// is held across the venue round trip.
	case <-time.After(time.Second):
		t.Fatal("second user was serialized behind the first remote request")
	}
	close(broker.release)
	for range 2 {
		if result := <-results; result.err != nil {
			t.Fatal(result.err)
		}
	}
	state, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"mandate-session-one", "mandate-session-two", "order-session-one", "order-session-two"} {
		if strings.Contains(string(state), secret) {
			t.Fatalf("request-scoped session persisted: %s", secret)
		}
	}
	for _, order := range service.Snapshot()["testnetOrders"].(map[string]TestnetOrder) {
		if order.WalletSignature != "" {
			t.Fatal("public snapshot exposed a Wallet order signature")
		}
	}
}

type blockingBroker struct {
	calls   atomic.Int64
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (b *blockingBroker) SubmitTestnet(context.Context, Mandate, TestnetOrder, string) (string, error) {
	b.calls.Add(1)
	b.once.Do(func() { close(b.entered) })
	<-b.release
	return "terminal-proof", nil
}

func TestUnknownOutcomeReservationPreventsDuplicateVenueSubmission(t *testing.T) {
	now := time.Date(2026, 8, 10, 7, 0, 0, 0, time.UTC)
	broker := &blockingBroker{entered: make(chan struct{}), release: make(chan struct{})}
	service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: broker})
	mandate, err := service.RegisterMandate(validMandate(now, strings.Repeat("c", 64)))
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() {
		_, err := service.SubmitTestnetWithSession(context.Background(), mandate.Digest, "buy", 1_000_000, 1, "idempotent-order-1", "signature", "session", validRisk(now))
		finished <- err
	}()
	<-broker.entered
	if _, err := service.SubmitTestnetWithSession(context.Background(), mandate.Digest, "buy", 1_000_000, 1, "idempotent-order-1", "signature", "session", validRisk(now)); err != ErrUnavailable {
		t.Fatalf("duplicate pending submission err=%v", err)
	}
	if broker.calls.Load() != 1 {
		t.Fatalf("duplicate reached venue: calls=%d", broker.calls.Load())
	}
	close(broker.release)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}
