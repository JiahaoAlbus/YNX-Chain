package bftgateway

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayCommitsAndQueriesSignedPayWorkflow(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 91))
	signer, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(signer, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := consensus.NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	fixture := newABCICometFixture(t, app, int64(migration.Height))
	upstream := httptest.NewServer(fixture)
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()
	merchant := "merchant_gateway_bft"
	intent := consensus.PayIntentPayload{Merchant: merchant, Amount: 50, Currency: "YNXT", IdempotencyKey: "intent-key"}
	intent.RequestHash = consensus.PayIntentRequestHash(intent.Merchant, intent.Amount, intent.Currency, intent.CallbackURL, intent.IdempotencyKey)
	intentRaw := signedPay(t, key, consensus.ActionPayIntentCreate, intent, 1)
	var intentRecord consensus.BFTPayIntent
	postSignedAction(t, server.URL+"/pay/intents", intentRaw, http.StatusCreated, &intentRecord)
	invoice := consensus.PayInvoicePayload{Merchant: merchant, IntentID: intentRecord.ID, DueInHours: 24, IdempotencyKey: "invoice-key"}
	invoice.RequestHash = consensus.PayInvoiceRequestHash(invoice.Merchant, invoice.IntentID, invoice.DueInHours, invoice.IdempotencyKey)
	invoiceRaw := signedPay(t, key, consensus.ActionPayInvoiceCreate, invoice, 2)
	var invoiceRecord consensus.BFTPayInvoice
	postSignedAction(t, server.URL+"/pay/invoices", invoiceRaw, http.StatusCreated, &invoiceRecord)
	refund := consensus.PayRefundPayload{Merchant: merchant, IntentID: intentRecord.ID, Amount: 10, Reason: "bounded", IdempotencyKey: "refund-key"}
	refund.RequestHash = consensus.PayRefundRequestHash(refund.Merchant, refund.IntentID, refund.Amount, refund.Reason, refund.IdempotencyKey)
	refundRaw := signedPay(t, key, consensus.ActionPayRefundCreate, refund, 3)
	var refundRecord consensus.BFTPayRefund
	postSignedAction(t, server.URL+"/pay/refunds", refundRaw, http.StatusCreated, &refundRecord)
	signedAt := time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC).Add(time.Duration(fixture.height+4) * time.Second)
	eventID, payloadHash, message := consensus.PayWebhookMaterial(merchant, intentRecord.ID, "payment_intent.created", "webhook-key", signedAt)
	mac := hmac.New(sha256.New, []byte("gateway-webhook-key"))
	_, _ = mac.Write(message)
	webhook := consensus.PayWebhookPayload{Merchant: merchant, IntentID: intentRecord.ID, EventType: "payment_intent.created", IdempotencyKey: "webhook-key", EventID: eventID, PayloadHash: payloadHash, Signature: hex.EncodeToString(mac.Sum(nil)), SignedAt: signedAt, Algorithm: "hmac-sha256"}
	webhook.RequestHash = consensus.PayWebhookRequestHash(webhook.Merchant, webhook.IntentID, webhook.EventType, webhook.IdempotencyKey)
	webhookRaw := signedPay(t, key, consensus.ActionPayWebhookRecord, webhook, 4)
	var webhookRecord consensus.BFTPayWebhook
	postSignedAction(t, server.URL+"/pay/webhook-signatures", webhookRaw, http.StatusCreated, &webhookRecord)
	if invoiceRecord.IntentID != intentRecord.ID || refundRecord.Amount != 10 || webhookRecord.Signature != webhook.Signature {
		t.Fatalf("unexpected Pay records: %+v %+v %+v", invoiceRecord, refundRecord, webhookRecord)
	}
	var events struct {
		Events []consensus.BFTPayEvent `json:"events"`
	}
	getJSON(t, server.URL+"/pay/events?intentId="+intentRecord.ID, &events)
	if len(events.Events) != 4 {
		t.Fatalf("unexpected Pay events: %+v", events)
	}
	var idem consensus.BFTPayIdempotency
	getJSON(t, server.URL+"/pay/idempotency?"+url.Values{"merchant": {merchant}, "key": {"intent-key"}}.Encode(), &idem)
	if idem.ObjectID != intentRecord.ID || idem.RequestHash != intent.RequestHash {
		t.Fatalf("unexpected idempotency: %+v", idem)
	}
	var lookup consensus.BFTPayWebhook
	getJSON(t, server.URL+"/pay/webhook-signatures/"+eventID, &lookup)
	if lookup.EventID != eventID {
		t.Fatalf("unexpected webhook lookup: %+v", lookup)
	}
}

func signedPay(t *testing.T, key *secp256k1.PrivateKey, action string, payload any, nonce uint64) []byte {
	t.Helper()
	tx, err := consensus.NewSignedApplicationAction(key, 6423, action, payload, nonce)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := consensus.EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
