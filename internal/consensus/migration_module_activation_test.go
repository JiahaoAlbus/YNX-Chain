package consensus

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type preservedModuleFixture struct {
	pay                                        sourcePayFixture
	m                                          chain.ConsensusMigrationState
	key                                        *secp256k1.PrivateKey
	owner, permission, action, request, appeal string
}

// All records, including paid/refunded invoices and original webhook MACs,
// come from the actual source Devnet. No imported identity is fabricated.
func newPreservedModuleFixture(t *testing.T) preservedModuleFixture {
	t.Helper()
	f := preservedModuleFixture{pay: newSourcePayFixture(t), key: deterministicPrivateKey(229)}
	f.owner = mustNativeAddress(t, f.key)
	d := f.pay.d
	if _, err := d.Faucet(f.owner, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	permission, err := d.RequestAIPermission(chain.AIPermissionInput{SessionID: "source-session", Requester: f.owner, Scope: "wallet_transfer", Purpose: "original unsigned claim", ExpiryHours: 2})
	if err != nil {
		t.Fatal(err)
	}
	action, err := d.ProposeAIAction(chain.AIActionProposalInput{SessionID: "source-session", Requester: f.owner, Scope: "wallet_transfer", ActionType: "transfer", Description: "original pending request", ExpiryHours: 2})
	if err != nil {
		t.Fatal(err)
	}
	request, err := d.CreateGovernanceRequest(chain.GovernanceRequestInput{Requester: f.owner, Subject: f.owner, Action: "add risk label", AssetType: "address", Scope: "one address", Description: "original advisory request", Evidence: []string{"case:original"}})
	if err != nil {
		t.Fatal(err)
	}
	appeal, err := d.CreateTrustAppeal(chain.TrustAppealInput{RequestID: request.ID, Subject: f.owner, Appellant: "unsigned-original-person", Claimant: "unsigned-original-person", Reason: "original appeal"})
	if err != nil {
		t.Fatal(err)
	}
	f.permission, f.action, f.request, f.appeal = permission.ID, action.ID, request.ID, appeal.ID
	f.m, err = d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	return f
}

type preservedModuleNegative struct {
	name, cause string
	wire        []byte
}

func preservedModuleUnauthorizedActions(t *testing.T, f preservedModuleFixture, nonce uint64, at time.Time) []preservedModuleNegative {
	t.Helper()
	merchant, key := "independently_signed_but_unbound", "source-authority-negative"
	invoice := PayInvoicePayload{Merchant: merchant, IntentID: f.pay.intent.ID, DueInHours: 12, IdempotencyKey: key}
	invoice.RequestHash = PayInvoiceRequestHash(invoice.Merchant, invoice.IntentID, invoice.DueInHours, key)
	refund := PayRefundPayload{Merchant: merchant, IntentID: f.pay.intent.ID, Amount: 1, IdempotencyKey: key}
	refund.RequestHash = PayRefundRequestHash(refund.Merchant, refund.IntentID, refund.Amount, refund.Reason, key)
	settle := func(id, hash string) PaySettlementPayload {
		p := PaySettlementPayload{Merchant: merchant, InvoiceID: id, Payer: f.owner, TransactionHash: hash, IdempotencyKey: key}
		p.RequestHash = PaySettlementRequestHash(p.Merchant, p.InvoiceID, p.Payer, p.TransactionHash, key)
		return p
	}
	complete := func(id, hash string) PayRefundCompletionPayload {
		p := PayRefundCompletionPayload{Merchant: merchant, RefundID: id, TransactionHash: hash, IdempotencyKey: key}
		p.RequestHash = PayRefundCompletionRequestHash(p.Merchant, p.RefundID, p.TransactionHash, key)
		return p
	}
	eventID, payloadHash, material := PayWebhookMaterial(merchant, f.pay.intent.ID, "invoice.paid", key, at)
	mac := hmac.New(sha256.New, []byte("a-real-new-MAC-does-not-prove-original-custody"))
	_, _ = mac.Write(material)
	webhook := PayWebhookPayload{Merchant: merchant, IntentID: f.pay.intent.ID, EventType: "invoice.paid", IdempotencyKey: key, EventID: eventID, PayloadHash: payloadHash, Signature: hex.EncodeToString(mac.Sum(nil)), SignedAt: at, Algorithm: "hmac-sha256"}
	webhook.RequestHash = PayWebhookRequestHash(merchant, webhook.IntentID, webhook.EventType, key)
	var out []preservedModuleNegative
	add := func(name, action string, value any, cause string) {
		raw := mustTrustAction(t, f.key, action, value, nonce)
		tx, err := DecodeSignedApplicationAction(raw)
		if err != nil || tx.Verify(f.m.Network.ChainID) != nil {
			t.Fatal("negative must use a real valid account signature", err)
		}
		out = append(out, preservedModuleNegative{name, cause, raw})
	}
	add("source_invoice", ActionPayInvoiceCreate, invoice, "source Pay object is immutable")
	add("source_refund", ActionPayRefundCreate, refund, "source Pay object is immutable")
	add("source_settlement", ActionPayInvoiceSettle, settle(f.pay.invoice.ID, f.pay.payment.Hash), "source Pay object is immutable")
	add("source_refund_complete", ActionPayRefundComplete, complete(f.pay.pending.ID, f.pay.reverse.Hash), "source Pay object is immutable")
	add("source_webhook", ActionPayWebhookRecord, webhook, "source Pay object is immutable")
	add("source_payment_reuse", ActionPayInvoiceSettle, settle(strings.Repeat("a", 24), f.pay.payment.Hash), "original source settlement")
	add("source_refund_reuse", ActionPayRefundComplete, complete(strings.Repeat("b", 24), f.pay.reverse.Hash), "original source refund")
	add("source_ai_approve", ActionAIProposalApprove, AIActionDecisionPayload{ActionID: f.action, PermissionID: f.permission, Approver: f.owner}, "source AI action has no signed principal")
	add("source_ai_reject", ActionAIProposalReject, AIActionDecisionPayload{ActionID: f.action, Approver: f.owner}, "source AI action has no signed principal")
	add("source_ai_permission", ActionAIProposalApprove, AIActionDecisionPayload{ActionID: strings.Repeat("c", 24), PermissionID: f.permission, Approver: f.owner}, "unsigned source AI permission")
	add("source_review", ActionGovernanceReview, GovernanceDecisionPayload{RequestID: f.request, Reviewer: f.owner}, "requires independently authenticated reviewer authority")
	add("source_reject", ActionGovernanceReject, GovernanceDecisionPayload{RequestID: f.request, Reviewer: f.owner, Reason: "self claimed old role"}, "requires independently authenticated reviewer authority")
	add("source_resolve", ActionTrustAppealResolve, TrustAppealDecisionPayload{AppealID: f.appeal, Reviewer: f.owner, Decision: "ACCEPTED", ResolutionReason: "self claimed old role"}, "requires independently authenticated reviewer authority")
	return out
}

func assertPreservedModuleAdmissionRejects(t *testing.T, app *Application, f preservedModuleFixture, nonce uint64, at time.Time, path string) []preservedModuleNegative {
	t.Helper()
	before := mustJSON(t, app.committed)
	diskBefore, diskErr := os.ReadFile(path)
	cases := preservedModuleUnauthorizedActions(t, f, nonce, at)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			check, err := app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: tc.wire})
			if err != nil || check.Code == 0 || !strings.Contains(check.Log, tc.cause) {
				t.Fatalf("normal CheckTx bypassed the actual source authority fence: %+v %v", check, err)
			}
			proposal, err := app.ProcessProposal(context.Background(), &abci.RequestProcessProposal{Height: app.committed.Height + 1, Time: at, Txs: [][]byte{tc.wire}})
			if err != nil || proposal.Status != abci.ResponseProcessProposal_REJECT {
				t.Fatalf("proposal accepted missing source authority: %+v %v", proposal, err)
			}
			if !bytes.Equal(before, mustJSON(t, app.committed)) || app.pending != nil {
				t.Fatal("rejected authority changed account/fee/nonce/resources/source/history/pending")
			}
		})
	}
	diskAfter, afterErr := os.ReadFile(path)
	if os.IsNotExist(diskErr) != os.IsNotExist(afterErr) || (diskErr == nil) != (afterErr == nil) || !bytes.Equal(diskBefore, diskAfter) {
		t.Fatal("rejected admission changed the durable checkpoint", diskErr, afterErr)
	}
	return cases
}

func TestMigrationPreservationFactoryKeepsSourceAndIndependentExecution(t *testing.T) {
	f := newPreservedModuleFixture(t)
	original := mustJSON(t, f.m)
	blockers := MigrationExecutionBlockers(f.m)
	modules := make(map[string]bool)
	for _, b := range blockers {
		modules[b.Module] = true
		if !strings.Contains(b.Reason, "source preservation validation passed;") {
			t.Fatal("fixture must have only real retained-source authority gaps", b)
		}
	}
	if !modules["pay"] || !modules["ai"] || !modules["trust_governance"] || validateMigrationExecutionClosure(f.m) == nil {
		t.Fatal("fixture lost the three unresolved authority blockers")
	}
	path := filepath.Join(t.TempDir(), "committed.json")
	app, err := NewPersistentApplication(f.m, path)
	if err != nil {
		t.Fatalf("MIGRATION_PRESERVATION_FACTORY_BLOCKED: %v", err)
	}
	if err := app.committed.Validate(f.m); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(app.committed.LegacyPaySource, migrationPaySource(f.m)) || !reflect.DeepEqual(app.committed.LegacyAISource, migrationAISource(f.m)) || !reflect.DeepEqual(app.committed.LegacyTrustSource.Records, originalTrustRecords(f.m)) || !accountsEqual(app.committed.Accounts, f.m.Accounts) {
		t.Fatal("normal factory erased, normalized or re-authorized original source")
	}
	ctx := context.Background()
	if _, err := app.InitChain(ctx, &abci.RequestInitChain{ChainId: "ynx_6423-1", InitialHeight: int64(f.m.Height) + 1, AppStateBytes: original}); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Add(time.Minute)
	negative := assertPreservedModuleAdmissionRejects(t, app, f, 1, at, path)
	to := mustNativeAddress(t, deterministicPrivateKey(230))
	transfer, err := NewSignedTransfer(f.key, f.m.Network.ChainID, to, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	transferRaw, err := EncodeSignedTransaction(transfer)
	if err != nil {
		t.Fatal(err)
	}
	intent := PayIntentPayload{Merchant: "independent_fresh_merchant", Amount: 3, Currency: "YNXT", IdempotencyKey: "new-signed-intent"}
	intent.RequestHash = PayIntentRequestHash(intent.Merchant, intent.Amount, intent.Currency, intent.CallbackURL, intent.IdempotencyKey)
	pay := mustTrustAction(t, f.key, ActionPayIntentCreate, intent, 2)
	permission := mustTrustAction(t, f.key, ActionAIPermissionCreate, AIPermissionPayload{SessionID: "independent", Requester: f.owner, Scope: "wallet_transfer", Purpose: "new signed permission", ExpiryHours: 2}, 3)
	proposal := mustTrustAction(t, f.key, ActionAIProposalCreate, AIActionProposalPayload{SessionID: "independent", Requester: f.owner, Scope: "wallet_transfer", ActionType: "transfer", Description: "new signed action", ExpiryHours: 2}, 4)
	approval := mustTrustAction(t, f.key, ActionAIProposalApprove, AIActionDecisionPayload{ActionID: ApplicationActionRecordID("ai-action", ApplicationActionHash(proposal)), PermissionID: ApplicationActionRecordID("ai-permission", ApplicationActionHash(permission)), Approver: f.owner}, 5)
	appeal := mustTrustAction(t, f.key, ActionTrustAppealCreate, TrustAppealPayload{RequestID: f.request, Subject: f.owner, Appellant: f.owner, Claimant: f.owner, Reason: "new signer-bound claim only"}, 6)
	evidence := mustTrustAction(t, f.key, ActionTrustEvidenceCreate, TrustEvidencePayload{Requester: f.owner, Subject: f.owner}, 7)
	valid := [][]byte{transferRaw, pay, permission, proposal, approval, appeal, evidence}
	proposalResult, err := app.ProcessProposal(ctx, &abci.RequestProcessProposal{Height: app.committed.Height + 1, Time: at, Txs: valid})
	if err != nil || proposalResult.Status != abci.ResponseProcessProposal_ACCEPT {
		t.Fatalf("unrelated authentic Chain actions were disabled: %+v %v", proposalResult, err)
	}
	all := make([][]byte, 0, len(negative)+len(valid))
	for _, tc := range negative {
		all = append(all, tc.wire)
	}
	all = append(all, valid...)
	prepared, err := app.PrepareProposal(ctx, &abci.RequestPrepareProposal{Height: app.committed.Height + 1, Time: at, Txs: all})
	if err != nil || !reflect.DeepEqual(prepared.Txs, valid) {
		t.Fatal("proposal preparation retained unbound source operations or dropped independent actions", err)
	}
	peer, err := NewApplication(f.m)
	if err != nil {
		t.Fatal(err)
	}
	peerResult, err := peer.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: peer.committed.Height + 1, Time: at, Txs: all})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := peer.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	result, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: app.committed.Height + 1, Time: at, Txs: all})
	if err != nil || len(result.TxResults) != len(all) {
		t.Fatal("actual mixed FinalizeBlock failed", err)
	}
	for i, r := range result.TxResults {
		if i < len(negative) {
			if r.Code == 0 || !strings.Contains(r.Log, negative[i].cause) {
				t.Fatal("FinalizeBlock granted missing legacy authority", negative[i].name, r)
			}
		} else if r.Code != 0 {
			t.Fatal("independent signed action failed", i, r)
		}
	}
	if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(result.AppHash, peerResult.AppHash) || !bytes.Equal(mustJSON(t, app.committed), mustJSON(t, peer.committed)) {
		t.Fatal("independent application instances disagreed on preserved state or action authorization")
	}
	assertConsensusAccount(t, app, f.owner, 86, 7)
	assertConsensusAccount(t, app, to, 7, 0)
	if len(app.committed.PayIntents) != 1 || len(app.committed.AIPermissions) != 1 || len(app.committed.AIActions) != 1 || app.committed.AIActions[0].Status != "approved" || len(app.committed.LegacyTrustSource.Updates) != 1 || len(app.committed.TrustEvidence) != 1 || len(app.committed.FeeEvents) != 7 {
		t.Fatal("normal execution lost independent records or charged failed authority attempts")
	}
	if !bytes.Equal(original, mustJSON(t, f.m)) || !reflect.DeepEqual(app.committed.LegacyPaySource, migrationPaySource(f.m)) || !reflect.DeepEqual(app.committed.LegacyAISource, migrationAISource(f.m)) || !reflect.DeepEqual(app.committed.LegacyTrustSource.Records, originalTrustRecords(f.m)) || !bytes.Equal(app.committed.LegacyTrustSource.Updates[0].Transaction, appeal) {
		t.Fatal("execution changed original records or the new signed claimant wire")
	}
	var gotBlockers []MigrationModuleBlocker
	queryJSON(t, app, "/migration/compatibility", &gotBlockers)
	if !reflect.DeepEqual(blockers, gotBlockers) {
		t.Fatal("successful unrelated execution cleared unresolved source authorities")
	}
	var oldPay sourcePayIntentView
	queryJSON(t, app, "/pay/intents/"+f.pay.intent.ID, &oldPay)
	if oldPay.Writable || oldPay.Authorization != "historical_claim_only" || !reflect.DeepEqual(oldPay.PayIntent, f.m.Runtime.PayIntents[f.pay.intent.ID]) {
		t.Fatal("original paid/refund query changed or granted new merchant authority")
	}
	var oldAI sourceAIActionView
	queryJSON(t, app, "/ai/actions/"+f.action, &oldAI)
	if oldAI.Writable || !reflect.DeepEqual(oldAI.AIActionProposal, f.m.Runtime.AIActions[f.action]) {
		t.Fatal("original AI query became signed authority")
	}
	var newClaim sourceTrustAppealView
	queryJSON(t, app, "/trust/appeals/"+ApplicationActionRecordID("trust-appeal", ApplicationActionHash(appeal)), &newClaim)
	if newClaim.Authority != "signed_claimant_only" || newClaim.ReviewerAuthorityAvailable || newClaim.Continuation == nil || !bytes.Equal(newClaim.Continuation.Transaction, appeal) {
		t.Fatal("normal claimant continuation gained reviewer authority or lost original bytes")
	}
	cold, err := NewPersistentApplication(f.m, path)
	if err != nil || !bytes.Equal(mustJSON(t, app.committed), mustJSON(t, cold.committed)) {
		t.Fatal("normal cold restart lost the complete preserved/executed state", err)
	}
	assertPreservedModuleAdmissionRejects(t, cold, f, 8, at.Add(time.Minute), path)
	if !reflect.DeepEqual(MigrationExecutionBlockers(cold.migration), blockers) {
		t.Fatal("cold recovery silently activated an unresolved source module")
	}
}

func TestMigrationPreservationRejectsCorruptSourceAndColdRewrite(t *testing.T) {
	f := newPreservedModuleFixture(t)
	for _, module := range []string{"pay", "ai", "trust"} {
		t.Run(module, func(t *testing.T) {
			bad := cloneSourcePayMigration(t, f.m)
			switch module {
			case "pay":
				v := bad.Runtime.PayIntents[f.pay.intent.ID]
				v.Amount++
				bad.Runtime.PayIntents[v.ID] = v
			case "ai":
				v := bad.Runtime.AIPerms[f.permission]
				v.AuditHash = strings.Repeat("0", 64)
				bad.Runtime.AIPerms[v.ID] = v
			case "trust":
				v := bad.Runtime.Governance[f.request]
				v.RequiresAppeal = false
				bad.Runtime.Governance[v.ID] = v
			}
			if validateMigrationPreservationClosure(bad) == nil {
				t.Fatal("preservation admission swallowed malformed original source")
			}
			if _, err := NewApplication(bad); err == nil {
				t.Fatal("normal factory accepted malformed original source")
			}
		})
	}
	app, err := NewApplication(f.m)
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := sealCommittedState(f.m, int64(f.m.Height)+1, app.committedExecutionStateView())
	if err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*CommittedState){
		"pay_omitted":   func(s *CommittedState) { s.LegacyPaySource = nil },
		"ai_omitted":    func(s *CommittedState) { s.LegacyAISource = nil },
		"trust_omitted": func(s *CommittedState) { s.LegacyTrustSource = nil },
		"pay_rewritten": func(s *CommittedState) {
			v := s.LegacyPaySource.Intents[f.pay.intent.ID]
			v.Merchant = f.owner
			s.LegacyPaySource.Intents[v.ID] = v
		},
		"ai_rewritten": func(s *CommittedState) {
			v := s.LegacyAISource.Actions[f.action]
			v.Executable = true
			s.LegacyAISource.Actions[v.ID] = v
		},
		"trust_rewritten": func(s *CommittedState) {
			v := s.LegacyTrustSource.Records.Governance[f.request]
			v.Requester = "another-original-requester"
			s.LegacyTrustSource.Records.Governance[v.ID] = v
		},
	} {
		t.Run(name, func(t *testing.T) {
			var bad CommittedState
			if err := json.Unmarshal(mustJSON(t, sealed), &bad); err != nil {
				t.Fatal(err)
			}
			mutate(&bad)
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "tampered.json")
			before := mustJSON(t, bad)
			if err := os.WriteFile(path, before, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := NewPersistentApplication(f.m, path); err == nil {
				t.Fatal("rehashing a cold checkpoint bypassed original source validation")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("rejected cold checkpoint was overwritten or normalized", err)
			}
		})
	}
	if validateMigrationPreservationClosure(legacyMigrationForTest(t, f.m)) == nil {
		t.Fatal("account-only legacy migration was promoted to source preservation")
	}
}

func TestMigrationPreservationClassifiesOnlyValidatedAuthorityGaps(t *testing.T) {
	f := newPreservedModuleFixture(t)
	classified := collectMigrationExecutionBlockers(f.m)
	public := MigrationExecutionBlockers(f.m)
	if len(classified) != 3 || len(public) != len(classified) {
		t.Fatal("fixture must retain exactly its three source authority gaps")
	}
	for i, original := range classified {
		if original.classification != migrationValidatedSourceAuthorityGap || original.blocker != public[i] {
			t.Fatal("actual validated source was misclassified or public blocker changed")
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(mustJSON(t, public[i]), &fields); err != nil || len(fields) != 3 || fields["module"] == nil || fields["records"] == nil || fields["reason"] == nil {
			t.Fatal("internal classification changed the public three-field JSON", err)
		}
		for _, variant := range []string{"same_module_new_failure", "identical_authority_reason", "unknown_class"} {
			t.Run(original.blocker.Module+"/"+variant, func(t *testing.T) {
				// An ordinary future failure may reuse the exact module and even
				// the current authority text. Neither is an admission capability.
				candidate := classifiedMigrationBlocker{blocker: original.blocker}
				if variant == "same_module_new_failure" {
					candidate.blocker.Reason = "missing execution material"
				}
				if variant == "unknown_class" {
					candidate.classification = migrationBlockerClass(255)
				}
				values := append(append([]classifiedMigrationBlocker(nil), classified...), candidate)
				if err := validatePreservationBlockerClasses(values); err == nil || !strings.Contains(err.Error(), candidate.blocker.Module+"(") {
					t.Fatal("ordinary or unknown failure was waived by module/reason text", err)
				}
			})
		}
	}
	if err := validatePreservationBlockerClasses(classified); err != nil || validateMigrationExecutionClosure(f.m) == nil {
		t.Fatal("preservation classification changed strict executor compatibility", err)
	}
	for _, module := range []string{"pay", "ai", "trust_governance"} {
		t.Run(module+"/invalid_original", func(t *testing.T) {
			bad := cloneSourcePayMigration(t, f.m)
			switch module {
			case "pay":
				v := bad.Runtime.PayIntents[f.pay.intent.ID]
				v.Amount++
				bad.Runtime.PayIntents[v.ID] = v
			case "ai":
				v := bad.Runtime.AIPerms[f.permission]
				v.AuditHash = strings.Repeat("0", 64)
				bad.Runtime.AIPerms[v.ID] = v
			case "trust_governance":
				v := bad.Runtime.Governance[f.request]
				v.RequiresAppeal = false
				bad.Runtime.Governance[v.ID] = v
			}
			found := false
			for _, value := range collectMigrationExecutionBlockers(bad) {
				if value.blocker.Module != module {
					continue
				}
				found = true
				if value.classification != migrationBlockingFailure || validatePreservationBlockerClasses([]classifiedMigrationBlocker{value}) == nil {
					t.Fatal("failed real source validation was classified as an authority-only gap")
				}
			}
			if !found || validateMigrationPreservationClosure(bad) == nil {
				t.Fatal("source corruption disappeared from actual admission")
			}
		})
	}
}
