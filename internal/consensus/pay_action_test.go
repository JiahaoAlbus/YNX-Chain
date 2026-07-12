package consensus

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestApplicationPersistsBoundPayWorkflowAndIdempotency(t *testing.T) {
	ctx := context.Background()
	key := deterministicPrivateKey(81)
	otherKey := deterministicPrivateKey(82)
	signer, other := mustNativeAddress(t, key), mustNativeAddress(t, otherKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(signer, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet(other, 10); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "pay-state.json")
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	merchant := "merchant_bft_test"
	blockTime := time.Date(2026, 7, 12, 12, 0, 0, 0, time.UTC)
	intentInput := PayIntentPayload{Merchant: merchant, Amount: 100, Currency: "YNXT", CallbackURL: "https://merchant.example/callback", IdempotencyKey: "intent-key"}
	intentInput.RequestHash = PayIntentRequestHash(intentInput.Merchant, intentInput.Amount, intentInput.Currency, intentInput.CallbackURL, intentInput.IdempotencyKey)
	intentRaw := mustPayAction(t, key, ActionPayIntentCreate, intentInput, 1)
	intentID := ApplicationActionRecordID("pay-intent", ApplicationActionHash(intentRaw))
	invoiceInput := PayInvoicePayload{Merchant: merchant, IntentID: intentID, DueInHours: 12, IdempotencyKey: "invoice-key"}
	invoiceInput.RequestHash = PayInvoiceRequestHash(invoiceInput.Merchant, invoiceInput.IntentID, invoiceInput.DueInHours, invoiceInput.IdempotencyKey)
	invoiceRaw := mustPayAction(t, key, ActionPayInvoiceCreate, invoiceInput, 2)
	invoiceID := ApplicationActionRecordID("pay-invoice", ApplicationActionHash(invoiceRaw))
	refundInput := PayRefundPayload{Merchant: merchant, IntentID: intentID, Amount: 25, Reason: "bounded refund", IdempotencyKey: "refund-key"}
	refundInput.RequestHash = PayRefundRequestHash(refundInput.Merchant, refundInput.IntentID, refundInput.Amount, refundInput.Reason, refundInput.IdempotencyKey)
	refundRaw := mustPayAction(t, key, ActionPayRefundCreate, refundInput, 3)
	refundID := ApplicationActionRecordID("pay-refund", ApplicationActionHash(refundRaw))
	eventID, payloadHash, message := PayWebhookMaterial(merchant, intentID, "payment_intent.created", "webhook-key", blockTime)
	mac := hmac.New(sha256.New, []byte("local-webhook-secret"))
	_, _ = mac.Write(message)
	webhookInput := PayWebhookPayload{Merchant: merchant, IntentID: intentID, EventType: "payment_intent.created", IdempotencyKey: "webhook-key", EventID: eventID, PayloadHash: payloadHash, Signature: hex.EncodeToString(mac.Sum(nil)), SignedAt: blockTime, Algorithm: "hmac-sha256"}
	webhookInput.RequestHash = PayWebhookRequestHash(webhookInput.Merchant, webhookInput.IntentID, webhookInput.EventType, webhookInput.IdempotencyKey)
	webhookRaw := mustPayAction(t, key, ActionPayWebhookRecord, webhookInput, 4)
	if bytes.Contains(webhookRaw, []byte("local-webhook-secret")) {
		t.Fatal("webhook signing key entered signed chain payload")
	}

	height := int64(migration.Height) + 1
	txs := [][]byte{intentRaw, invoiceRaw, refundRaw, webhookRaw}
	proposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: txs})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("Pay proposal failed: %+v %v", proposal, err)
	}
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: txs})
	if err != nil || len(finalized.TxResults) != 4 {
		t.Fatalf("Pay finalize failed: %+v %v", finalized, err)
	}
	for _, result := range finalized.TxResults {
		if result.Code != 0 || len(result.Events) != 1 || result.Events[0].Type != "ynx.pay_action" {
			t.Fatalf("unexpected Pay result: %+v", result)
		}
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	var intent BFTPayIntent
	queryJSON(t, app, "/pay/intents/"+intentID, &intent)
	if intent.Merchant != merchant || intent.Amount != 100 || intent.Signer != signer {
		t.Fatalf("bad intent: %+v", intent)
	}
	var invoice BFTPayInvoice
	queryJSON(t, app, "/pay/invoices/"+invoiceID, &invoice)
	if invoice.IntentID != intentID || invoice.DueAt != blockTime.Add(12*time.Hour) {
		t.Fatalf("bad invoice: %+v", invoice)
	}
	var refund BFTPayRefund
	queryJSON(t, app, "/pay/refunds/"+refundID, &refund)
	if refund.Amount != 25 || refund.Merchant != merchant {
		t.Fatalf("bad refund: %+v", refund)
	}
	var webhook BFTPayWebhook
	queryJSON(t, app, "/pay/webhooks/"+eventID, &webhook)
	if webhook.PayloadHash != payloadHash || !webhook.ReplaySafe {
		t.Fatalf("bad webhook: %+v", webhook)
	}
	var events []BFTPayEvent
	queryJSON(t, app, "/pay/events", &events)
	if len(events) != 4 {
		t.Fatalf("expected four Pay events: %+v", events)
	}
	var idem BFTPayIdempotency
	queryJSON(t, app, "/pay/idempotency/"+PayIdempotencyID(merchant, "intent-key"), &idem)
	if idem.ObjectID != intentID || idem.RequestHash != intentInput.RequestHash {
		t.Fatalf("bad idempotency: %+v", idem)
	}
	assertConsensusAccount(t, app, signer, 96, 4)
	accountResponse, _ := app.Query(ctx, &abcitypes.RequestQuery{Path: "/accounts/" + signer})
	var account chain.ConsensusAccount
	_ = json.Unmarshal(accountResponse.Value, &account)
	if account.ResourceUsage.PayCreditsUsed != 4 || account.ResourceUsage.BandwidthUsed != 4 {
		t.Fatalf("Pay resources not charged: %+v", account.ResourceUsage)
	}

	changed := intentInput
	changed.Amount = 101
	changed.RequestHash = PayIntentRequestHash(changed.Merchant, changed.Amount, changed.Currency, changed.CallbackURL, changed.IdempotencyKey)
	changedRaw := mustPayAction(t, key, ActionPayIntentCreate, changed, 5)
	check, _ := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: changedRaw})
	if check.Code == 0 {
		t.Fatal("changed request reused committed idempotency key")
	}
	over := refundInput
	over.Amount = 76
	over.IdempotencyKey = "refund-over"
	over.RequestHash = PayRefundRequestHash(over.Merchant, over.IntentID, over.Amount, over.Reason, over.IdempotencyKey)
	overRaw := mustPayAction(t, key, ActionPayRefundCreate, over, 5)
	check, _ = app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: overRaw})
	if check.Code == 0 {
		t.Fatal("cumulative over-refund accepted")
	}
	unauthorized := refundInput
	unauthorized.IdempotencyKey = "refund-other"
	unauthorized.RequestHash = PayRefundRequestHash(unauthorized.Merchant, unauthorized.IntentID, unauthorized.Amount, unauthorized.Reason, unauthorized.IdempotencyKey)
	unauthorizedRaw := mustPayAction(t, otherKey, ActionPayRefundCreate, unauthorized, 1)
	check, _ = app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: unauthorizedRaw})
	if check.Code == 0 {
		t.Fatal("unauthorized signer refund accepted")
	}

	restarted, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	var restored BFTPayWebhook
	queryJSON(t, restarted, "/pay/webhooks/"+eventID, &restored)
	if !bytes.Equal(mustJSON(t, restored), mustJSON(t, webhook)) {
		t.Fatalf("Pay state changed after restart")
	}
}

func TestPayPayloadRejectsChangedRequestHashAndUnsupportedCurrency(t *testing.T) {
	input := PayIntentPayload{Merchant: "merchant_test", Amount: 1, Currency: "USD", IdempotencyKey: "key", RequestHash: "bad"}
	if _, err := NewSignedApplicationAction(deterministicPrivateKey(83), 6423, ActionPayIntentCreate, input, 1); err == nil {
		t.Fatal("unsupported currency and bad request hash accepted")
	}
}

func mustPayAction(t *testing.T, key *secp256k1.PrivateKey, action string, input any, nonce uint64) []byte {
	t.Helper()
	tx, err := NewSignedApplicationAction(key, 6423, action, input, nonce)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
