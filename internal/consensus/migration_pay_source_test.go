package consensus

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

type sourcePayFixture struct {
	dir                                      string
	d                                        *chain.Devnet
	m                                        chain.ConsensusMigrationState
	intent, unbound                          chain.PayIntent
	invoice                                  chain.Invoice
	settlement                               chain.PaySettlement
	completed, pending                       chain.RefundRecord
	webhook                                  chain.WebhookSignature
	payment, reverse                         chain.Transaction
	payer, payout, payerNative, payoutNative string
}

func newSourcePayFixture(t *testing.T) sourcePayFixture {
	t.Helper()
	f := sourcePayFixture{dir: t.TempDir(), payer: "0x1111111111111111111111111111111111111111", payout: "0x2222222222222222222222222222222222222222"}
	var err error
	f.payerNative, err = accountaddress.Encode(f.payer)
	if err != nil {
		t.Fatal(err)
	}
	f.payoutNative, err = accountaddress.Encode(f.payout)
	if err != nil {
		t.Fatal(err)
	}
	f.d, err = chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), f.dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.d.Faucet(f.payer, 300); err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	// These are the actual historical public Devnet methods. In particular no
	// fixture pretends that merchant records had a caller signature or BFT fee.
	f.intent, err = f.d.CreatePayIntentForPayoutWithIdempotency("opaque merchant / original", f.payoutNative, 25, "https://example.invalid/pay", "same-key")
	if err != nil {
		t.Fatal(err)
	}
	f.invoice, err = f.d.CreateInvoiceWithIdempotency(f.intent.ID, 12, "same-key")
	if err != nil {
		t.Fatal(err)
	}
	f.payment, err = f.d.Transfer(f.payer, f.payout, 25)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.d.SettleInvoice(f.invoice.ID, f.payerNative, f.payment.Hash, "same-key"); err == nil {
		t.Fatal("fixture accepted pending payment")
	}
	f.d.ProduceBlock()
	f.settlement, err = f.d.SettleInvoice(f.invoice.ID, f.payerNative, f.payment.Hash, "same-key")
	if err != nil {
		t.Fatal(err)
	}
	f.completed, err = f.d.CreateRefundWithIdempotency(f.intent.ID, 5, "original partial refund", "same-key")
	if err != nil {
		t.Fatal(err)
	}
	f.reverse, err = f.d.Transfer(f.payout, f.payer, 5)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.d.CompleteRefund(f.completed.ID, f.reverse.Hash, "same-key"); err == nil {
		t.Fatal("fixture accepted pending reverse payment")
	}
	f.d.ProduceBlock()
	f.completed, err = f.d.CompleteRefund(f.completed.ID, f.reverse.Hash, "same-key")
	if err != nil {
		t.Fatal(err)
	}
	f.pending, err = f.d.CreateRefundWithIdempotency(f.intent.ID, 3, "reserved but not paid", "other-refund")
	if err != nil {
		t.Fatal(err)
	}
	f.webhook, err = f.d.SignWebhookWithIdempotency(f.intent.ID, "refund.completed", "synthetic-source-secret", "same-key")
	if err != nil {
		t.Fatal(err)
	}
	// A payment destination is optional in source state; an address-shaped
	// merchant is still merely an unauthenticated string. Empty legacy keys and
	// replaySafe=false must remain intact, not upgraded to BFT replay authority.
	f.unbound, err = f.d.CreatePayIntent(f.payout, 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.d.CreateInvoice(f.unbound.ID, 24); err != nil {
		t.Fatal(err)
	}
	if _, err = f.d.CreateRefund(f.unbound.ID, 2, "original pre-payment request"); err != nil {
		t.Fatal(err)
	}
	if _, err = f.d.SignWebhook(f.unbound.ID, "payment_intent.created", "synthetic-other-secret"); err != nil {
		t.Fatal(err)
	}
	f.m, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func sourcePayJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func cloneSourcePayMigration(t *testing.T, m chain.ConsensusMigrationState) chain.ConsensusMigrationState {
	t.Helper()
	var out chain.ConsensusMigrationState
	if err := json.Unmarshal(sourcePayJSON(t, m), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestMigrationPaySourcePreservesRealWorkflowAndColdRestart(t *testing.T) {
	f := newSourcePayFixture(t)
	before := sourcePayJSON(t, f.m)
	source := migrationPaySource(f.m)
	if err := validateLegacyPaySource(source, CommittedState{Version: 18}, f.m); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, sourcePayJSON(t, f.m)) {
		t.Fatal("validation changed source balances, nonces, history or Pay records")
	}
	intent, invoice := source.Intents[f.intent.ID], source.Invoices[f.invoice.ID]
	if intent.Status != "paid" || invoice.Status != "paid" || intent.RefundStatus != "partially_refunded" || invoice.RefundStatus != "partially_refunded" || intent.RefundedAmount != 5 || invoice.RefundedAmount != 5 || source.Settlements[f.settlement.ID].Status != "paid" {
		t.Fatal("source paid/refund status was rewritten into BFT semantics")
	}
	if source.Refunds[f.pending.ID].Status != "recorded" || source.Intents[f.unbound.ID].PayoutAddress != "" {
		t.Fatal("pending or unbound source object was upgraded")
	}
	if !reflect.DeepEqual(source.Refunds[f.completed.ID], f.completed) || !reflect.DeepEqual(source.Webhooks[f.webhook.EventID], f.webhook) {
		t.Fatal("original refund or webhook changed")
	}
	payload := strings.Join([]string{f.webhook.EventID, f.webhook.IntentID, f.webhook.EventType, f.webhook.SignedAt.Format(time.RFC3339Nano)}, ".")
	mac := hmac.New(sha256.New, []byte("synthetic-source-secret"))
	_, _ = mac.Write([]byte(payload))
	if hex.EncodeToString(mac.Sum(nil)) != f.webhook.Signature {
		t.Fatal("fixture did not produce a real original HMAC")
	}
	encoded := sourcePayJSON(t, source)
	if bytes.Contains(encoded, []byte("synthetic-source-secret")) || bytes.Contains(encoded, []byte(`"signer"`)) || bytes.Contains(encoded, []byte(`"requestHash"`)) {
		t.Fatal("source projection invented authority or retained secret")
	}
	var restored LegacyPaySource
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if err := validateLegacyPaySource(&restored, CommittedState{Version: 18}, f.m); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(&restored, source) {
		t.Fatal("source projection changed after JSON reload")
	}
	loaded, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), f.dir)
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := loaded.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, sourcePayJSON(t, reloaded)) {
		t.Fatal("real cold restart changed the complete original migration")
	}
	if err := validateLegacyPaySource(migrationPaySource(reloaded), CommittedState{Version: 18}, reloaded); err != nil {
		t.Fatal(err)
	}
	// Real source exact-replay operations must preserve their old objects and
	// must not consume another transfer, fee or nonce after restart.
	if got, err := loaded.CompleteRefund(f.completed.ID, f.reverse.Hash, "same-key"); err != nil || !reflect.DeepEqual(got, f.completed) {
		t.Fatalf("source refund replay: %+v %v", got, err)
	}
	if got, err := loaded.SignWebhookWithIdempotency(f.intent.ID, "refund.completed", "different-key-not-retained", "same-key"); err != nil || !reflect.DeepEqual(got, f.webhook) {
		t.Fatalf("source webhook replay changed original signature: %+v %v", got, err)
	}
	afterReplay, err := loaded.ExportConsensusMigrationState()
	if err != nil || !bytes.Equal(before, sourcePayJSON(t, afterReplay)) {
		t.Fatalf("source replay changed authoritative state: %v", err)
	}
}

func TestMigrationPaySourceDoesNotInventMerchantAuthority(t *testing.T) {
	f := newSourcePayFixture(t)
	source := migrationPaySource(f.m)
	missing := sourcePayAuthorityRequirements(source)
	if len(missing) != len(source.Intents) {
		t.Fatal("payout or address-shaped merchant erased missing authority")
	}
	for i, requirement := range missing {
		original := source.Intents[requirement.IntentID]
		if requirement.Merchant != original.Merchant || requirement.PayoutAddress != original.PayoutAddress || !strings.Contains(requirement.Reason, "no signed principal/action") || i > 0 && missing[i-1].IntentID >= requirement.IntentID {
			t.Fatal("authority requirement lost original identity or deterministic order")
		}
	}
	original := sourcePayJSON(t, f.m)
	blockers := MigrationExecutionBlockers(f.m)
	payBlocked := false
	for _, blocker := range blockers {
		if blocker.Module == "pay" && blocker.Records > 0 {
			payBlocked = true
		}
	}
	if !payBlocked {
		t.Fatal("source preservation lost the unresolved Pay authority blocker")
	}
	if err := validateMigrationExecutionClosure(f.m); err == nil || !strings.Contains(err.Error(), "pay(") {
		t.Fatalf("source preservation silently cleared execution blocker: %v", err)
	}
	app, err := NewApplication(f.m)
	if err != nil {
		t.Fatal("normal factory refused strictly preserved source Pay records", err)
	}
	if !reflect.DeepEqual(app.committed.LegacyPaySource, source) || !accountsEqual(app.committed.Accounts, f.m.Accounts) || !bytes.Equal(original, sourcePayJSON(t, f.m)) {
		t.Fatal("normal factory changed complete original Pay records, accounts or migration")
	}
	if len(app.committed.PayIntents)+len(app.committed.PayInvoices)+len(app.committed.PaySettlements)+len(app.committed.PayRefunds)+len(app.committed.PayWebhooks)+len(app.committed.PayEvents)+len(app.committed.PayIdempotency) != 0 || len(app.committed.FeeEvents) != 0 || app.pending != nil {
		t.Fatal("source preservation invented BFT Pay authority, execution records, fees or pending state")
	}
	if !reflect.DeepEqual(MigrationExecutionBlockers(app.migration), blockers) {
		t.Fatal("normal factory changed unresolved source authority requirements")
	}
	if err := validateMigrationExecutionClosure(app.migration); err == nil || !strings.Contains(err.Error(), "pay(") {
		t.Fatalf("normal factory granted unresolved source Pay execution authority: %v", err)
	}
	cloned := cloneLegacyPaySource(source)
	changed := cloned.Refunds[f.completed.ID]
	*changed.CompletedAt = changed.CompletedAt.Add(time.Hour)
	cloned.Refunds[f.completed.ID] = changed
	delete(cloned.Events, f.webhook.EventID)
	if !source.Refunds[f.completed.ID].CompletedAt.Equal(*f.completed.CompletedAt) {
		t.Fatal("clone shared mutable completion time")
	}
	if err := validateLegacyPaySource(cloned, CommittedState{Version: 18}, f.m); err == nil {
		t.Fatal("changed source projection accepted")
	}
	if err := validateLegacyPaySource(nil, CommittedState{Version: 18}, f.m); err == nil {
		t.Fatal("source Pay erased")
	}
}

func TestMigrationPaySourceAllowsOriginalMultipleInvoicesAndScopedKeys(t *testing.T) {
	f := newSourcePayFixture(t)
	// Native accepts a second paid invoice for the same intent AFTER the prior
	// refund. BFT's one-settlement-per-intent rule must not rewrite that history.
	invoice, err := f.d.CreateInvoiceWithIdempotency(f.intent.ID, 12, "second-invoice")
	if err != nil {
		t.Fatal(err)
	}
	payment, err := f.d.Transfer(f.payer, f.payout, 25)
	if err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	if _, err := f.d.SettleInvoice(invoice.ID, f.payerNative, payment.Hash, "same-key"); err != nil {
		t.Fatal(err)
	}
	m, err := f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if err := validateLegacyPaySource(migrationPaySource(m), CommittedState{Version: 18}, m); err != nil {
		t.Fatal(err)
	}
	if _, err := f.d.CompleteRefund(f.pending.ID, payment.Hash, "must-not-reuse-payment"); err == nil {
		t.Fatal("actual source admitted ambiguous refund authority")
	}
}

func TestMigrationPaySourceRejectsFinancialHistoryTamper(t *testing.T) {
	f := newSourcePayFixture(t)
	for name, edit := range map[string]func(*LegacyPaySource, *chain.ConsensusMigrationState){
		"payment-fee": func(_ *LegacyPaySource, m *chain.ConsensusMigrationState) {
			for i := range m.Runtime.Blocks {
				for j := range m.Runtime.Blocks[i].Transactions {
					tx := &m.Runtime.Blocks[i].Transactions[j]
					if tx.Hash == f.payment.Hash {
						tx.Fee = 0
					}
				}
			}
		},
		"payment-direction": func(_ *LegacyPaySource, m *chain.ConsensusMigrationState) {
			for i := range m.Runtime.Blocks {
				for j := range m.Runtime.Blocks[i].Transactions {
					tx := &m.Runtime.Blocks[i].Transactions[j]
					if tx.Hash == f.payment.Hash {
						tx.To = f.payer
					}
				}
			}
		},
		"payment-position": func(_ *LegacyPaySource, m *chain.ConsensusMigrationState) {
			for i := range m.Runtime.Blocks {
				for j := range m.Runtime.Blocks[i].Transactions {
					tx := &m.Runtime.Blocks[i].Transactions[j]
					if tx.Hash == f.payment.Hash {
						tx.BlockNum++
					}
				}
			}
		},
		"missing-payment": func(_ *LegacyPaySource, m *chain.ConsensusMigrationState) {
			for i := range m.Runtime.Blocks {
				for j, tx := range m.Runtime.Blocks[i].Transactions {
					if tx.Hash == f.payment.Hash {
						m.Runtime.Blocks[i].Transactions = append(m.Runtime.Blocks[i].Transactions[:j], m.Runtime.Blocks[i].Transactions[j+1:]...)
						break
					}
				}
			}
		},
		"settlement-amount-rehashed": func(s *LegacyPaySource, _ *chain.ConsensusMigrationState) {
			v := s.Settlements[f.settlement.ID]
			v.Amount++
			v.AuditHash = sourcePaySettlementAudit(v)
			s.Settlements[v.ID] = v
		},
		"settlement-audit": func(s *LegacyPaySource, _ *chain.ConsensusMigrationState) {
			v := s.Settlements[f.settlement.ID]
			v.AuditHash = strings.Repeat("0", 64)
			s.Settlements[v.ID] = v
		},
		"refund-claim-payment": func(s *LegacyPaySource, _ *chain.ConsensusMigrationState) {
			v := s.Refunds[f.completed.ID]
			v.TransactionHash = f.payment.Hash
			v.BlockNumber = f.settlement.BlockNumber
			v.AuditHash = sourcePayRefundAudit(v)
			s.Refunds[v.ID] = v
		},
		"refund-unpaid-completion-fields": func(s *LegacyPaySource, _ *chain.ConsensusMigrationState) {
			v := s.Refunds[f.pending.ID]
			v.Payer = f.payerNative
			s.Refunds[v.ID] = v
		},
		"refund-reservation-overflow": func(s *LegacyPaySource, _ *chain.ConsensusMigrationState) {
			v := s.Refunds[f.pending.ID]
			v.Amount = int64(^uint64(0) >> 1)
			s.Refunds[v.ID] = v
		},
		"refund-double-claim": func(s *LegacyPaySource, _ *chain.ConsensusMigrationState) {
			v := s.Refunds[f.completed.ID]
			v.ID = strings.Repeat("e", 24)
			v.IdempotencyKey = "distinct-request"
			v.AuditHash = sourcePayRefundAudit(v)
			s.Refunds[v.ID] = v
		},
		"refund-projection": func(s *LegacyPaySource, _ *chain.ConsensusMigrationState) {
			v := s.Intents[f.intent.ID]
			v.RefundedAmount = 0
			s.Intents[v.ID] = v
		},
		"bft-status-substitution": func(s *LegacyPaySource, _ *chain.ConsensusMigrationState) {
			v := s.Invoices[f.invoice.ID]
			v.Status = "partially_refunded"
			s.Invoices[v.ID] = v
		},
	} {
		t.Run(name, func(t *testing.T) {
			m := cloneSourcePayMigration(t, f.m)
			source := migrationPaySource(m)
			edit(source, &m)
			// Exercise the semantic closure directly, not merely the immutable
			// source-anchor comparison or the migration's outer JSON hash.
			if err := validateSourcePayRecords(source, m); err == nil {
				t.Fatal("financial source inconsistency accepted")
			}
		})
	}
}

func TestMigrationPaySourceRejectsWebhookEventAndIdempotencyTamper(t *testing.T) {
	f := newSourcePayFixture(t)
	for name, edit := range map[string]func(*LegacyPaySource){
		"webhook-payload": func(s *LegacyPaySource) {
			v := s.Webhooks[f.webhook.EventID]
			v.PayloadHash = strings.Repeat("0", 64)
			s.Webhooks[v.EventID] = v
		},
		"webhook-identity": func(s *LegacyPaySource) {
			v := s.Webhooks[f.webhook.EventID]
			delete(s.Webhooks, v.EventID)
			v.EventID = strings.Repeat("d", 24)
			s.Webhooks[v.EventID] = v
		},
		"webhook-replay-claim": func(s *LegacyPaySource) {
			v := s.Webhooks[f.webhook.EventID]
			v.ReplaySafe = false
			s.Webhooks[v.EventID] = v
		},
		"event-erasure": func(s *LegacyPaySource) {
			for id := range s.Events {
				delete(s.Events, id)
				break
			}
		},
		"event-self-rehash": func(s *LegacyPaySource) {
			for id, v := range s.Events {
				v.Merchant = "different merchant"
				v.AuditHash = sourcePayEventAudit(v)
				s.Events[id] = v
				break
			}
		},
		"intent-idempotency-collision": func(s *LegacyPaySource) {
			v := s.Intents[f.intent.ID]
			v.ID = strings.Repeat("f", 24)
			s.Intents[v.ID] = v
		},
		"refund-idempotency-collision": func(s *LegacyPaySource) {
			v := s.Refunds[f.pending.ID]
			v.ID = strings.Repeat("c", 24)
			v.Amount = 1
			s.Refunds[v.ID] = v
		},
	} {
		t.Run(name, func(t *testing.T) {
			source := migrationPaySource(f.m)
			edit(source)
			if err := validateSourcePayRecords(source, f.m); err == nil {
				t.Fatal("source webhook/event/idempotency inconsistency accepted")
			}
		})
	}
	// A MAC value is opaque without its secret. The trusted original bytes are
	// preserved rather than asserting a nonexistent cryptographic revalidation.
	source := migrationPaySource(f.m)
	v := source.Webhooks[f.webhook.EventID]
	v.Signature = strings.Repeat("a", 64)
	source.Webhooks[v.EventID] = v
	if err := validateLegacyPaySource(source, CommittedState{Version: 18}, f.m); err == nil {
		t.Fatal("original webhook MAC bytes replaced")
	}
}

func TestMigrationPaySourceRejectsBFTAuthorityAndTransferReassignment(t *testing.T) {
	f := newSourcePayFixture(t)
	source := migrationPaySource(f.m)
	states := []CommittedState{
		{PayIntents: []BFTPayIntent{{ID: f.intent.ID, Signer: f.payout}}},
		{PayInvoices: []BFTPayInvoice{{ID: strings.Repeat("a", 24), IntentID: f.intent.ID, Signer: f.payer}}},
		{PaySettlements: []BFTPaySettlement{{ID: strings.Repeat("a", 24), TransactionHash: f.payment.Hash}}},
		{PayRefunds: []BFTPayRefund{{ID: strings.Repeat("b", 24), TransactionHash: f.reverse.Hash}}},
		{PayWebhooks: []BFTPayWebhook{{EventID: f.webhook.EventID, Signer: f.payout}}},
		{PayIdempotency: []BFTPayIdempotency{{ObjectID: f.intent.ID, Signer: f.payout}}},
		{PayIdempotency: []BFTPayIdempotency{{ID: f.intent.ID, Signer: f.payout}}},
		{PayInvoices: []BFTPayInvoice{{ID: strings.Repeat("b", 24), TransactionHash: f.payment.Hash}}},
		{PayEvents: []BFTPayEvent{{ID: strings.Repeat("c", 24), TransactionHash: f.reverse.Hash}}},
	}
	for i, state := range states {
		state.Version = 18
		if err := validateLegacyPaySource(source, state, f.m); err == nil {
			t.Fatalf("BFT source authority/transfer reassignment accepted at %d", i)
		}
	}
}

func TestMigrationPaySourceRequiresVersion18(t *testing.T) {
	f := newSourcePayFixture(t)
	source := migrationPaySource(f.m)
	for _, version := range []int{15, 16, 17} {
		if err := validateLegacyPaySource(source, CommittedState{Version: version}, f.m); err == nil || !strings.Contains(err.Error(), "version 18") {
			t.Fatalf("pre18 accepted source Pay: %d %v", version, err)
		}
	}
	for _, version := range []int{18, 19, 20} {
		if err := validateLegacyPaySource(source, CommittedState{Version: version}, f.m); err != nil {
			t.Fatalf("supported source version %d: %v", version, err)
		}
	}
}

func TestMigrationPaySourceQueryPreservesOriginalFieldsAndMergedBFTEvents(t *testing.T) {
	f := newSourcePayFixture(t)
	source := migrationPaySource(f.m)
	// Produce a separate, actually signed BFT record through the normal executor.
	// This tests query merging, not an unproved full-App source activation.
	key := deterministicPrivateKey(87)
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet(mustNativeAddress(t, key), 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewApplication(m)
	if err != nil {
		t.Fatal(err)
	}
	p := PayIntentPayload{Merchant: "independent_merchant", Amount: 7, Currency: "YNXT", IdempotencyKey: "new-intent"}
	p.RequestHash = PayIntentRequestHash(p.Merchant, p.Amount, p.Currency, p.CallbackURL, p.IdempotencyKey)
	raw := mustPayAction(t, key, ActionPayIntentCreate, p, 1)
	commitPayBlock(t, app, int64(m.Height)+1, time.Now().UTC(), raw)
	app.mu.RLock()
	state := app.committed
	app.mu.RUnlock()
	if err := validateLegacyPaySource(source, state, f.m); err != nil {
		t.Fatal(err)
	}
	before := sourcePayJSON(t, source)
	queries := map[string]any{
		"/pay/intents/" + f.intent.ID:         source.Intents[f.intent.ID],
		"/pay/intents/" + f.unbound.ID:        source.Intents[f.unbound.ID],
		"/pay/invoices/" + f.invoice.ID:       source.Invoices[f.invoice.ID],
		"/pay/settlements/" + f.settlement.ID: source.Settlements[f.settlement.ID],
		"/pay/refunds/" + f.completed.ID:      source.Refunds[f.completed.ID],
		"/pay/refunds/" + f.pending.ID:        source.Refunds[f.pending.ID],
		"/pay/webhooks/" + f.webhook.EventID:  source.Webhooks[f.webhook.EventID],
	}
	for id, event := range source.Events {
		queries["/pay/events/"+id] = event
	}
	for path, original := range queries {
		response := &abcitypes.ResponseQuery{Height: state.Height}
		if !queryLegacyPaySource(response, path, source, state) || response.Code != 0 || response.Height != state.Height {
			t.Fatalf("source query missing: %s", path)
		}
		var got, want map[string]json.RawMessage
		if err := json.Unmarshal(response.Value, &got); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(sourcePayJSON(t, original), &want); err != nil {
			t.Fatal(err)
		}
		for field, value := range want {
			if !bytes.Equal(got[field], value) {
				t.Fatalf("query rewrote original %s at %s", field, path)
			}
		}
		if string(got["source"]) != `"source_import"` || string(got["sourceAnchor"]) != `"`+f.m.StateHash+`"` || string(got["writable"]) != "false" || string(got["authorization"]) != `"historical_claim_only"` {
			t.Fatalf("source query implies new authority: %s", path)
		}
		if bytes.Contains(response.Value, []byte("synthetic-source-secret")) || got["signer"] != nil || got["requestHash"] != nil {
			t.Fatal("query invented authority or exposed nonexistent secret")
		}
	}
	response := &abcitypes.ResponseQuery{Height: state.Height}
	if !queryLegacyPaySource(response, "/pay/events", source, state) {
		t.Fatal("merged event query missing")
	}
	var events []map[string]json.RawMessage
	if err := json.Unmarshal(response.Value, &events); err != nil {
		t.Fatal(err)
	}
	if len(events) != len(source.Events)+len(state.PayEvents) {
		t.Fatal("merged query dropped source or BFT events")
	}
	previous, sourceCount, bftCount := "", 0, 0
	for _, event := range events {
		id := string(event["id"])
		if id <= previous {
			t.Fatal("merged events are not uniquely ordered")
		}
		previous = id
		if event["source"] != nil {
			sourceCount++
		} else {
			bftCount++
			if event["signer"] == nil || event["txHash"] == nil {
				t.Fatal("BFT event lost actual authority")
			}
		}
	}
	if sourceCount != len(source.Events) || bftCount != len(state.PayEvents) {
		t.Fatal("query relabeled source or BFT provenance")
	}
	for _, path := range []string{"/pay/intents/" + state.PayIntents[0].ID, "/pay/intents/ " + f.intent.ID, "/pay/intents/" + f.intent.ID + "/extra", "/pay/idempotency/" + f.intent.ID} {
		if queryLegacyPaySource(&abcitypes.ResponseQuery{}, path, source, state) {
			t.Fatalf("source intercepted unrelated/noncanonical query: %s", path)
		}
	}
	if !bytes.Equal(before, sourcePayJSON(t, source)) {
		t.Fatal("query mutated source records")
	}
}

func TestMigrationPaySourceSignedWriteFenceBeforeFee(t *testing.T) {
	f := newSourcePayFixture(t)
	source := migrationPaySource(f.m)
	if err := validateLegacyPaySource(source, CommittedState{Version: 18}, f.m); err != nil {
		t.Fatal(err)
	}
	key := deterministicPrivateKey(88)
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet(mustNativeAddress(t, key), 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewApplication(m)
	if err != nil {
		t.Fatal(err)
	}
	merchant, idempotencyKey := "independent_merchant", "signed-negative"
	invoice := func(id string) PayInvoicePayload {
		p := PayInvoicePayload{Merchant: merchant, IntentID: id, DueInHours: 12, IdempotencyKey: idempotencyKey}
		p.RequestHash = PayInvoiceRequestHash(p.Merchant, p.IntentID, p.DueInHours, p.IdempotencyKey)
		return p
	}
	refund := PayRefundPayload{Merchant: merchant, IntentID: f.intent.ID, Amount: 1, IdempotencyKey: idempotencyKey}
	refund.RequestHash = PayRefundRequestHash(refund.Merchant, refund.IntentID, refund.Amount, refund.Reason, refund.IdempotencyKey)
	settle := func(id, hash string) PaySettlementPayload {
		p := PaySettlementPayload{Merchant: merchant, InvoiceID: id, Payer: mustNativeAddress(t, key), TransactionHash: hash, IdempotencyKey: idempotencyKey}
		p.RequestHash = PaySettlementRequestHash(p.Merchant, p.InvoiceID, p.Payer, p.TransactionHash, p.IdempotencyKey)
		return p
	}
	complete := func(id, hash string) PayRefundCompletionPayload {
		p := PayRefundCompletionPayload{Merchant: merchant, RefundID: id, TransactionHash: hash, IdempotencyKey: idempotencyKey}
		p.RequestHash = PayRefundCompletionRequestHash(p.Merchant, p.RefundID, p.TransactionHash, p.IdempotencyKey)
		return p
	}
	at := time.Now().UTC()
	eventID, payloadHash, message := PayWebhookMaterial(merchant, f.intent.ID, "invoice.paid", idempotencyKey, at)
	mac := hmac.New(sha256.New, []byte("new-owner-cannot-bind-old-merchant"))
	_, _ = mac.Write(message)
	webhook := PayWebhookPayload{Merchant: merchant, IntentID: f.intent.ID, EventType: "invoice.paid", IdempotencyKey: idempotencyKey, EventID: eventID, PayloadHash: payloadHash, Signature: hex.EncodeToString(mac.Sum(nil)), SignedAt: at, Algorithm: "hmac-sha256"}
	webhook.RequestHash = PayWebhookRequestHash(webhook.Merchant, webhook.IntentID, webhook.EventType, webhook.IdempotencyKey)
	cases := []struct {
		name, action string
		input        any
	}{
		{"invoice-old-intent", ActionPayInvoiceCreate, invoice(f.intent.ID)},
		{"address-shaped-merchant", ActionPayInvoiceCreate, invoice(f.unbound.ID)},
		{"refund-old-intent", ActionPayRefundCreate, refund},
		{"settle-old-invoice", ActionPayInvoiceSettle, settle(f.invoice.ID, "0x"+strings.Repeat("a", 64))},
		{"complete-old-refund", ActionPayRefundComplete, complete(f.pending.ID, "0x"+strings.Repeat("a", 64))},
		{"webhook-old-intent", ActionPayWebhookRecord, webhook},
		{"payment-reuse", ActionPayInvoiceSettle, settle(strings.Repeat("a", 24), f.payment.Hash)},
		{"refund-reuse", ActionPayRefundComplete, complete(strings.Repeat("b", 24), f.reverse.Hash)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			want := "source Pay object is immutable"
			if tc.name == "payment-reuse" {
				want = "original source settlement"
			}
			if tc.name == "refund-reuse" {
				want = "original source refund"
			}
			raw := mustPayAction(t, key, tc.action, tc.input, 1)
			tx, err := DecodeSignedApplicationAction(raw)
			if err != nil {
				t.Fatal(err)
			}
			if err := tx.Verify(m.Network.ChainID); err != nil {
				t.Fatalf("negative must have real valid signer: %v", err)
			}
			if err := rejectLegacyPayActionWrite(source, tx, ApplicationActionHash(raw)); err == nil || !strings.Contains(err.Error(), want) {
				t.Fatalf("source fence missing or wrong first cause: %v", err)
			}
			// Exercise the actual verified dispatch before chargeApplicationAction.
			// Only its read-only source view is supplied; this is a boundary test,
			// not a fabricated migrated Application or a cleared execution blocker.
			app.mu.RLock()
			state := cloneExecutionStateValue(app.committedExecutionStateView())
			app.mu.RUnlock()
			state.legacyPaySource = source
			before := cloneExecutionStateValue(state)
			if _, _, err := app.applyApplicationAction(state, raw, int64(m.Height)+1, at); err == nil || !strings.Contains(err.Error(), want) {
				t.Fatalf("normal dispatcher did not refuse source write before fee with original first cause: %v", err)
			}
			if !reflect.DeepEqual(before, state) {
				t.Fatal("refused source write changed fee/nonce/resources/lots/history")
			}
		})
	}
	intent := PayIntentPayload{Merchant: merchant, Amount: 3, Currency: "YNXT", IdempotencyKey: "unrelated-new-intent"}
	intent.RequestHash = PayIntentRequestHash(intent.Merchant, intent.Amount, intent.Currency, intent.CallbackURL, intent.IdempotencyKey)
	raw := mustPayAction(t, key, ActionPayIntentCreate, intent, 1)
	tx, err := DecodeSignedApplicationAction(raw)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Verify(m.Network.ChainID); err != nil {
		t.Fatal(err)
	}
	if err := rejectLegacyPayActionWrite(source, tx, ApplicationActionHash(raw)); err != nil {
		t.Fatalf("new independently signed object blocked: %v", err)
	}
	// These collisions are deliberately corrupted negative views, never an
	// accepted source fixture. They cover every derived ID namespace before fee.
	for _, id := range []string{ApplicationActionRecordID("pay-intent", ApplicationActionHash(raw)), ApplicationActionRecordID("pay-event", ApplicationActionHash(raw)), PayIdempotencyID(intent.Merchant, intent.IdempotencyKey)} {
		collision := cloneLegacyPaySource(source)
		collision.Events[id] = chain.PayEvent{ID: id}
		if err := rejectLegacyPayActionWrite(collision, tx, ApplicationActionHash(raw)); err == nil {
			t.Fatal("derived ID overwrote a source object")
		}
	}
	// Actual normal execution still accepts and charges this unrelated action.
	commitPayBlock(t, app, int64(m.Height)+1, at, raw)
	if len(app.committed.PayIntents) != 1 || len(app.committed.PayEvents) != 1 {
		t.Fatal("unrelated BFT workflow failed")
	}
}
