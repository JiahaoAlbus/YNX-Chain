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
	if _, err := product.CreateRefundWithIdempotency(intent.ID, 5, "integration", "refund-integration"); err != nil {
		t.Fatal(err)
	}
	reloadedProduct, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), productDir)
	if err != nil {
		t.Fatal(err)
	}
	sourceEvents := reloadedProduct.PayEvents(intent.ID)
	upstreamKey := "pay-authority-upstream-key-00000001"
	paySourceCommit, paySourceRelease := strings.Repeat("c", 40), "pay-integration-test"
	if len(sourceEvents) != 4 {
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
	if err != nil || report.SourceEvents != 4 || report.MappedSourceEvents != 2 || report.UnmappedSourceEvents != 2 || report.CanonicalEvents != 3 || report.Committed != 3 {
		t.Fatalf("Pay integration cycle failed: %+v %v", report, err)
	}
	events := store.Events()
	if len(events) != 3 || len(store.PendingOutbox(time.Now().UTC().Add(time.Minute), 10)) != 3 {
		t.Fatalf("Pay producer did not commit canonical event plus Outbox: %+v", events)
	}
	wantTypes := []string{"pay.invoice.created", "pay.invoice.authorized", "pay.receipt.issued"}
	for index, event := range events {
		if event.EventType != wantTypes[index] || event.AggregateID != invoice.ID || event.Sequence != uint64(index+1) || event.Product != "pay" || event.Source.Status != "authoritative" {
			t.Fatalf("canonical Pay mapping is wrong at %d: %+v", index, event)
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
	if err != nil || report.AlreadyCommitted != 3 || report.Committed != 0 || len(store.Events()) != 3 {
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

type recordingSender struct {
	calls int
}

func (s *recordingSender) Send(_ context.Context, event datafabric.EventEnvelope) (sdk.ProducerReceipt, error) {
	s.calls++
	return sdk.ProducerReceipt{EventID: event.EventID, AuditID: event.AuditID, Status: "committed-to-outbox"}, nil
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
