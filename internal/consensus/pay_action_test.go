package consensus

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
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

func TestBFTPaySettlementAndRefundCompletionRequireCommittedNativeTransfers(t *testing.T) {
	ctx := context.Background()
	merchantKey, payerKey := deterministicPrivateKey(84), deterministicPrivateKey(85)
	merchantAddress, payerAddress := mustNativeAddress(t, merchantKey), mustNativeAddress(t, payerKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(merchantAddress, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet(payerAddress, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "pay-completion-state.json")
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	merchant := "merchant_bft_completion"
	at := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	intentInput := PayIntentPayload{Merchant: merchant, Amount: 50, Currency: "YNXT", IdempotencyKey: "completion-intent"}
	intentInput.RequestHash = PayIntentRequestHash(intentInput.Merchant, intentInput.Amount, intentInput.Currency, "", intentInput.IdempotencyKey)
	intentRaw := mustPayAction(t, merchantKey, ActionPayIntentCreate, intentInput, 1)
	intentID := ApplicationActionRecordID("pay-intent", ApplicationActionHash(intentRaw))
	invoiceInput := PayInvoicePayload{Merchant: merchant, IntentID: intentID, DueInHours: 24, IdempotencyKey: "completion-invoice"}
	invoiceInput.RequestHash = PayInvoiceRequestHash(invoiceInput.Merchant, invoiceInput.IntentID, invoiceInput.DueInHours, invoiceInput.IdempotencyKey)
	invoiceRaw := mustPayAction(t, merchantKey, ActionPayInvoiceCreate, invoiceInput, 2)
	invoiceID := ApplicationActionRecordID("pay-invoice", ApplicationActionHash(invoiceRaw))
	refundInput := PayRefundPayload{Merchant: merchant, IntentID: intentID, Amount: 10, Reason: "partial", IdempotencyKey: "completion-refund-record"}
	refundInput.RequestHash = PayRefundRequestHash(refundInput.Merchant, refundInput.IntentID, refundInput.Amount, refundInput.Reason, refundInput.IdempotencyKey)
	refundRaw := mustPayAction(t, merchantKey, ActionPayRefundCreate, refundInput, 3)
	refundID := ApplicationActionRecordID("pay-refund", ApplicationActionHash(refundRaw))
	height := int64(migration.Height) + 1
	commitPayBlock(t, app, height, at, intentRaw, invoiceRaw, refundRaw)

	missing := PaySettlementPayload{Merchant: merchant, InvoiceID: invoiceID, Payer: payerAddress, TransactionHash: "0x" + strings.Repeat("a", 64), IdempotencyKey: "missing-payment"}
	missing.RequestHash = PaySettlementRequestHash(missing.Merchant, missing.InvoiceID, missing.Payer, missing.TransactionHash, missing.IdempotencyKey)
	missingRaw := mustPayAction(t, merchantKey, ActionPayInvoiceSettle, missing, 4)
	if check, _ := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: missingRaw}); check.Code == 0 {
		t.Fatal("BFT Pay accepted settlement without a committed native payment")
	}

	payment, err := NewSignedTransfer(payerKey, 6423, merchantAddress, 50, 1)
	if err != nil {
		t.Fatal(err)
	}
	paymentRaw, _ := EncodeSignedTransaction(payment)
	height++
	commitPayBlock(t, app, height, at.Add(time.Minute), paymentRaw)
	paymentHash := SignedTransactionHash(paymentRaw)
	settlementInput := PaySettlementPayload{Merchant: merchant, InvoiceID: invoiceID, Payer: payerAddress, TransactionHash: paymentHash, IdempotencyKey: "completion-settlement"}
	settlementInput.RequestHash = PaySettlementRequestHash(settlementInput.Merchant, settlementInput.InvoiceID, settlementInput.Payer, settlementInput.TransactionHash, settlementInput.IdempotencyKey)
	settlementRaw := mustPayAction(t, merchantKey, ActionPayInvoiceSettle, settlementInput, 4)
	settlementID := ApplicationActionRecordID("pay-settlement", ApplicationActionHash(settlementRaw))
	height++
	commitPayBlock(t, app, height, at.Add(2*time.Minute), settlementRaw)
	var settlement BFTPaySettlement
	queryJSON(t, app, "/pay/settlements/"+settlementID, &settlement)
	if settlement.InvoiceID != invoiceID || settlement.Payer != payerAddress || settlement.PayoutAddress != merchantAddress || settlement.TransactionHash != paymentHash || settlement.Status != "paid" {
		t.Fatalf("committed settlement authority is incomplete: %+v", settlement)
	}

	wrongRefund, err := NewSignedTransfer(merchantKey, 6423, payerAddress, 9, 5)
	if err != nil {
		t.Fatal(err)
	}
	wrongRefundRaw, _ := EncodeSignedTransaction(wrongRefund)
	height++
	commitPayBlock(t, app, height, at.Add(3*time.Minute), wrongRefundRaw)
	wrongCompletion := PayRefundCompletionPayload{Merchant: merchant, RefundID: refundID, TransactionHash: SignedTransactionHash(wrongRefundRaw), IdempotencyKey: "wrong-refund-completion"}
	wrongCompletion.RequestHash = PayRefundCompletionRequestHash(wrongCompletion.Merchant, wrongCompletion.RefundID, wrongCompletion.TransactionHash, wrongCompletion.IdempotencyKey)
	wrongCompletionRaw := mustPayAction(t, merchantKey, ActionPayRefundComplete, wrongCompletion, 6)
	if check, _ := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: wrongCompletionRaw}); check.Code == 0 {
		t.Fatal("BFT Pay accepted a committed refund transfer with the wrong amount")
	}

	refundTransfer, err := NewSignedTransfer(merchantKey, 6423, payerAddress, 10, 6)
	if err != nil {
		t.Fatal(err)
	}
	refundTransferRaw, _ := EncodeSignedTransaction(refundTransfer)
	height++
	commitPayBlock(t, app, height, at.Add(4*time.Minute), refundTransferRaw)
	completionInput := PayRefundCompletionPayload{Merchant: merchant, RefundID: refundID, TransactionHash: SignedTransactionHash(refundTransferRaw), IdempotencyKey: "refund-completion"}
	completionInput.RequestHash = PayRefundCompletionRequestHash(completionInput.Merchant, completionInput.RefundID, completionInput.TransactionHash, completionInput.IdempotencyKey)
	completionRaw := mustPayAction(t, merchantKey, ActionPayRefundComplete, completionInput, 7)
	height++
	commitPayBlock(t, app, height, at.Add(5*time.Minute), completionRaw)
	var completed BFTPayRefund
	queryJSON(t, app, "/pay/refunds/"+refundID, &completed)
	if completed.Status != "completed" || completed.InvoiceID != invoiceID || completed.SettlementID != settlementID || completed.Payer != payerAddress || completed.TransactionHash != completionInput.TransactionHash || completed.CompletedAt == nil || completed.TxHash != ApplicationActionHash(refundRaw) || completed.CompletionTxHash != ApplicationActionHash(completionRaw) {
		t.Fatalf("committed refund completion authority is incomplete: %+v", completed)
	}
	if check, _ := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: completionRaw}); check.Code == 0 {
		t.Fatal("committed refund completion replay was accepted as a new action")
	}

	restarted, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	var restored BFTPayRefund
	queryJSON(t, restarted, "/pay/refunds/"+refundID, &restored)
	if !bytes.Equal(mustJSON(t, completed), mustJSON(t, restored)) {
		t.Fatal("BFT Pay completion authority changed after restart")
	}
}

func commitPayBlock(t *testing.T, app *Application, height int64, blockTime time.Time, txs ...[]byte) {
	t.Helper()
	ctx := context.Background()
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: txs})
	if err != nil || len(finalized.TxResults) != len(txs) {
		t.Fatalf("finalize Pay block: response=%+v err=%v", finalized, err)
	}
	for _, result := range finalized.TxResults {
		if result.Code != 0 {
			t.Fatalf("Pay block transaction failed: %+v", result)
		}
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatalf("commit Pay block: %v", err)
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
