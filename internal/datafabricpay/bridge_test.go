package datafabricpay

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	chainapi "github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricapi"
	sdk "github.com/JiahaoAlbus/YNX-Chain/sdk/datafabric"
)

var payIntegrationKey = []byte("pay-integration-signing-key-000001")

type unusedAuthorizer struct{}

func (unusedAuthorizer) Authorize(context.Context, datafabricapi.Credential, string) (datafabricapi.Principal, error) {
	return datafabricapi.Principal{}, errors.New("Wallet authorization is not used by product producer ingress")
}

func TestPayAuthorityBridgeCommitsCanonicalEventsAndIdempotentConsumerEffects(t *testing.T) {
	payer := "0x1111111111111111111111111111111111111111"
	merchant := "0x2222222222222222222222222222222222222222"
	payerNative, _ := accountaddress.Encode(payer)
	merchantNative, _ := accountaddress.Encode(merchant)
	productDir := filepath.Join(t.TempDir(), "pay-authority")
	product, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), productDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := product.Faucet(payer, 100); err != nil {
		t.Fatal(err)
	}
	product.ProduceBlock()
	intent, err := product.CreatePayIntentForPayoutWithIdempotency("merchant.integration.0001", merchantNative, 25, "", "intent-integration")
	if err != nil {
		t.Fatal(err)
	}
	invoice, err := product.CreateInvoiceWithIdempotency(intent.ID, 12, "invoice-integration")
	if err != nil {
		t.Fatal(err)
	}
	transfer, err := product.Transfer(payer, merchant, 25)
	if err != nil {
		t.Fatal(err)
	}
	product.ProduceBlock()
	if _, err := product.SettleInvoice(invoice.ID, payerNative, transfer.Hash, "settlement-integration"); err != nil {
		t.Fatal(err)
	}
	refund, err := product.CreateRefundWithIdempotency(intent.ID, 5, "integration", "refund-integration")
	if err != nil {
		t.Fatal(err)
	}
	refundTransfer, err := product.Transfer(merchant, payer, 5)
	if err != nil {
		t.Fatal(err)
	}
	product.ProduceBlock()
	if _, err := product.CompleteRefund(refund.ID, refundTransfer.Hash, "refund-completion-integration"); err != nil {
		t.Fatal(err)
	}
	reloadedProduct, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), productDir)
	if err != nil {
		t.Fatal(err)
	}
	sourceEvents := reloadedProduct.PayEvents(intent.ID)
	upstreamKey := "pay-authority-upstream-key-00000001"
	paySourceCommit, paySourceRelease := strings.Repeat("c", 40), "pay-integration-test"
	if len(sourceEvents) != 5 {
		t.Fatalf("persistent Pay authority did not retain its source event history: %+v", sourceEvents)
	}
	reloadedProduct.SetNodeIdentityConfig(chain.NodeIdentityConfig{Build: chain.BuildInfo{Commit: paySourceCommit, Release: paySourceRelease, BuildTime: "2026-07-26T09:00:00Z"}})
	source := httptest.NewServer(chainapi.NewServerWithConfig(reloadedProduct, chainapi.ServerConfig{PayGatewayUpstreamKey: upstreamKey}))
	defer source.Close()

	store, err := datafabric.OpenStore(filepath.Join(t.TempDir(), "fabric.json"))
	if err != nil {
		t.Fatal(err)
	}
	keyID := "key.pay.integration.0001"
	server, err := datafabricapi.New(datafabricapi.Config{
		Store: store, Authorizer: unusedAuthorizer{},
		EventKeys: map[string][]byte{keyID: payIntegrationKey}, EventKeyProducts: map[string]string{keyID: "pay"},
		PrivacyKey:   []byte("privacy-integration-key-000000001"),
		SourceCommit: strings.Repeat("b", 40), SourceRelease: "data-fabric-integration-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	destination := httptest.NewServer(server.Handler())
	defer destination.Close()
	producer, err := sdk.NewProducerClient(destination.URL, keyID, payIntegrationKey)
	if err != nil {
		t.Fatal(err)
	}
	bridge, err := New(Config{
		SourceURL: source.URL, UpstreamKey: upstreamKey, KeyID: keyID, SigningKey: payIntegrationKey,
		SourceCommit: paySourceCommit, SourceRelease: paySourceRelease, ChainID: 6423, Producer: producer,
	})
	if err != nil {
		t.Fatal(err)
	}
	report, err := bridge.SyncOnce(context.Background())
	if err != nil || report.SourceEvents != 5 || report.MappedSourceEvents != 3 || report.UnmappedSourceEvents != 2 || report.CanonicalEvents != 4 || report.Committed != 4 {
		t.Fatalf("Pay integration cycle failed: %+v %v", report, err)
	}
	events := store.Events()
	if len(events) != 4 || len(store.PendingOutbox(time.Now().UTC().Add(time.Minute), 10)) != 4 {
		t.Fatalf("Pay producer did not commit canonical event plus Outbox: %+v", events)
	}
	wantTypes := []string{"pay.invoice.created", "pay.invoice.authorized", "pay.receipt.issued", "pay.refund.completed"}
	for index, event := range events {
		if event.EventType != wantTypes[index] || event.AggregateID != invoice.ID || event.Sequence != uint64(index+1) || event.Product != "pay" || event.Source.Status != "authoritative" {
			t.Fatalf("canonical Pay mapping is wrong at %d: %+v", index, event)
		}
		if event.EventType == "pay.refund.completed" {
			var payload map[string]any
			if err := json.Unmarshal(event.Payload, &payload); err != nil {
				t.Fatal(err)
			}
			if payload["status"] != "completed" || payload["settlementId"] == "" || payload["transactionHash"] != refundTransfer.Hash || payload["sourceAuditHash"] == "" {
				t.Fatalf("refund completion lost chain authority: %+v", payload)
			}
		}
		applied, err := store.ApplyProjection("pay-integration-consumer", event.EventID, func(received datafabric.EventEnvelope, _ map[string]string) (string, error) {
			return "effect." + received.Integrity.Digest, nil
		})
		if err != nil || !applied {
			t.Fatalf("consumer Inbox effect was not committed for %s: %v", event.EventID, err)
		}
		applied, err = store.ApplyProjection("pay-integration-consumer", event.EventID, func(datafabric.EventEnvelope, map[string]string) (string, error) {
			return "", errors.New("duplicate delivery reapplied consumer effect")
		})
		if err != nil || applied {
			t.Fatalf("consumer duplicate was reapplied for %s: applied=%t err=%v", event.EventID, applied, err)
		}
	}
	report, err = bridge.SyncOnce(context.Background())
	if err != nil || report.AlreadyCommitted != 4 || report.Committed != 0 || len(store.Events()) != 4 {
		t.Fatalf("Pay producer redelivery was not idempotent: %+v %v", report, err)
	}
	if err := store.AuditIntegrity(map[string][]byte{keyID: payIntegrationKey}); err != nil {
		t.Fatalf("integrated producer/consumer integrity audit failed: %v", err)
	}
}

func TestPayAuthorityBridgeRejectsTamperedBatchBeforeDelivery(t *testing.T) {
	at := time.Date(2026, 7, 26, 9, 0, 0, 0, time.UTC)
	events := []chain.PayEvent{
		newSourceEvent("invoice.issued", "intent.integration.0002", "invoice.integration.0002", at),
		newSourceEvent("refund.recorded", "intent.integration.0002", "refund.integration.0002", at.Add(time.Second)),
	}
	events[1].AuditHash = strings.Repeat("0", 64)
	paySourceCommit, paySourceRelease := strings.Repeat("d", 40), "pay-integration-test"
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_ = json.NewEncoder(w).Encode(map[string]any{"chainId": 6423, "nativeCurrencySymbol": "YNXT", "build": map[string]string{"commit": paySourceCommit, "release": paySourceRelease}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"events": events})
	}))
	defer source.Close()
	sender := &recordingSender{}
	bridge, err := New(Config{
		SourceURL: source.URL, UpstreamKey: "pay-authority-upstream-key-00000002",
		KeyID: "key.pay.integration.0002", SigningKey: payIntegrationKey,
		SourceCommit: paySourceCommit, SourceRelease: paySourceRelease, ChainID: 6423, Producer: sender,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bridge.SyncOnce(context.Background()); err == nil || sender.calls != 0 {
		t.Fatalf("tampered source batch reached Data Fabric: calls=%d err=%v", sender.calls, err)
	}
}

func TestBFTPayBridgeMapsCommittedSettlementRefundAndReplay(t *testing.T) {
	at := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	signer := "0x3333333333333333333333333333333333333333"
	payer := "0x4444444444444444444444444444444444444444"
	intentID := strings.Repeat("1", 24)
	invoiceID := strings.Repeat("2", 24)
	settlementID := strings.Repeat("3", 24)
	refundID := strings.Repeat("4", 24)
	events := []consensus.BFTPayEvent{
		newBFTSourceEvent("invoice.issued", intentID, invoiceID, strings.Repeat("a", 64), at, signer, payer),
		newBFTSourceEvent("invoice.paid", intentID, settlementID, strings.Repeat("b", 64), at.Add(time.Second), signer, payer),
		newBFTSourceEvent("refund.completed", intentID, refundID, strings.Repeat("c", 64), at.Add(2*time.Second), signer, payer),
	}
	events[1].InvoiceID, events[1].SettlementID = invoiceID, settlementID
	events[1].PayoutAddress, events[1].Payer = signer, payer
	events[1].TransactionHash = "0x" + strings.Repeat("d", 64)
	events[1].AuditHash = consensus.BFTPayEventAuditHash(events[1])
	events[2].InvoiceID, events[2].SettlementID = invoiceID, settlementID
	events[2].PayoutAddress, events[2].Payer = payer, signer
	events[2].TransactionHash = "0x" + strings.Repeat("e", 64)
	events[2].AuditHash = consensus.BFTPayEventAuditHash(events[2])

	sourceCommit, sourceRelease := strings.Repeat("f", 40), "bft-pay-integration-test"
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-YNX-Pay-Gateway-Upstream-Key") != "" {
			t.Error("BFT source received the legacy upstream secret")
		}
		switch r.URL.Path {
		case "/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"chainId": 6423, "nativeCurrencySymbol": "YNXT", "build": map[string]string{"commit": sourceCommit, "release": sourceRelease}})
		case "/pay/events":
			_ = json.NewEncoder(w).Encode(map[string]any{"events": events})
		default:
			http.NotFound(w, r)
		}
	}))
	defer source.Close()

	sender := &recordingSender{}
	bridge, err := New(Config{
		SourceURL: source.URL, SourceMode: SourceModeBFT,
		KeyID: "key.pay.bft.integration", SigningKey: payIntegrationKey,
		SourceCommit: sourceCommit, SourceRelease: sourceRelease, ChainID: 6423, Producer: sender,
	})
	if err != nil {
		t.Fatal(err)
	}
	report, err := bridge.SyncOnce(context.Background())
	if err != nil || report.SourceEvents != 3 || report.MappedSourceEvents != 3 || report.CanonicalEvents != 4 || report.Committed != 4 {
		t.Fatalf("BFT Pay integration failed: %+v %v", report, err)
	}
	wantTypes := []string{"pay.invoice.created", "pay.invoice.authorized", "pay.receipt.issued", "pay.refund.completed"}
	for index, envelope := range sender.events {
		if envelope.EventType != wantTypes[index] || envelope.AggregateID != invoiceID || envelope.Sequence != uint64(index+1) {
			t.Fatalf("BFT Pay mapping is wrong at %d: %+v", index, envelope)
		}
		var payload map[string]any
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		sourceIndex := 0
		if index > 0 {
			sourceIndex = 1
		}
		if index == 3 {
			sourceIndex = 2
		}
		if payload["sourceAuditHash"] != events[sourceIndex].AuditHash {
			t.Fatalf("BFT source audit proof was not preserved: %+v", payload)
		}
	}
	report, err = bridge.SyncOnce(context.Background())
	if err != nil || report.AlreadyCommitted != 4 || report.Committed != 0 || len(sender.events) != 8 {
		t.Fatalf("BFT Pay replay was not deterministically redelivered: %+v %v", report, err)
	}
}

func TestBFTPayBridgeRejectsTamperedAuditBeforeDelivery(t *testing.T) {
	at := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	signer := "0x5555555555555555555555555555555555555555"
	event := newBFTSourceEvent("invoice.issued", strings.Repeat("5", 24), strings.Repeat("6", 24), strings.Repeat("7", 64), at, signer, signer)
	event.Amount++
	sourceCommit := strings.Repeat("8", 40)
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_ = json.NewEncoder(w).Encode(map[string]any{"chainId": 6423, "nativeCurrencySymbol": "YNXT", "build": map[string]string{"commit": sourceCommit, "release": "bft-pay-tamper-test"}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"events": []consensus.BFTPayEvent{event}})
	}))
	defer source.Close()
	sender := &recordingSender{}
	bridge, err := New(Config{
		SourceURL: source.URL, SourceMode: SourceModeBFT,
		KeyID: "key.pay.bft.tamper", SigningKey: payIntegrationKey,
		SourceCommit: sourceCommit, SourceRelease: "bft-pay-tamper-test", ChainID: 6423, Producer: sender,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bridge.SyncOnce(context.Background()); err == nil || sender.calls != 0 {
		t.Fatalf("tampered BFT event reached Data Fabric: calls=%d err=%v", sender.calls, err)
	}
	if _, err := New(Config{
		SourceURL: source.URL, SourceMode: SourceModeBFT, UpstreamKey: strings.Repeat("x", 32),
		KeyID: "key.pay.bft.tamper", SigningKey: payIntegrationKey,
		SourceCommit: sourceCommit, SourceRelease: "bft-pay-tamper-test", ChainID: 6423, Producer: sender,
	}); err == nil {
		t.Fatal("BFT mode accepted a legacy upstream secret")
	}
}

type recordingSender struct {
	calls  int
	events []datafabric.EventEnvelope
	seen   map[string]struct{}
}

func (s *recordingSender) Send(_ context.Context, event datafabric.EventEnvelope) (sdk.ProducerReceipt, error) {
	s.calls++
	s.events = append(s.events, event)
	if s.seen == nil {
		s.seen = make(map[string]struct{})
	}
	status := "committed-to-outbox"
	if _, exists := s.seen[event.EventID]; exists {
		status = "already-committed"
	}
	s.seen[event.EventID] = struct{}{}
	return sdk.ProducerReceipt{EventID: event.EventID, AuditID: event.AuditID, Status: status}, nil
}

func newBFTSourceEvent(eventType, intentID, objectID, txHashBody string, at time.Time, signer, payer string) consensus.BFTPayEvent {
	txHash := "0x" + txHashBody
	event := consensus.BFTPayEvent{
		ID: consensus.ApplicationActionRecordID("pay-event", txHash), Type: eventType,
		IntentID: intentID, ObjectID: objectID, Signer: signer, Merchant: "merchant.bft.integration",
		Amount: 25, Currency: "YNXT", IdempotencyKey: "idempotency.bft.integration",
		BlockHeight: 7, TxHash: txHash, CreatedAt: at.UTC(),
	}
	event.AuditHash = consensus.BFTPayEventAuditHash(event)
	return event
}

func newSourceEvent(eventType, intentID, objectID string, at time.Time) chain.PayEvent {
	event := chain.PayEvent{
		Type: eventType, IntentID: intentID, ObjectID: objectID,
		Merchant: "merchant.integration.0001", Amount: 1250, Currency: "USD",
		IdempotencyKey: "idempotency.integration.0001", CreatedAt: at.UTC(),
	}
	if eventType == "payment_intent.created" || eventType == "webhook.signed" {
		event.Amount = 0
	}
	event.ID = paySourceEventID(event)
	event.AuditHash = paySourceAuditHash(event)
	return event
}
