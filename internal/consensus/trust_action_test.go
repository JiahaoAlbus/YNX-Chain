package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestApplicationPersistsGovernanceAppealAndTransparencyWorkflow(t *testing.T) {
	ctx := context.Background()
	key := deterministicPrivateKey(91)
	otherKey := deterministicPrivateKey(92)
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
	statePath := filepath.Join(t.TempDir(), "trust-state.json")
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	blockTime := time.Date(2026, 7, 12, 13, 0, 0, 0, time.UTC)

	illegalRaw := mustTrustAction(t, key, ActionGovernanceCreate, GovernanceRequestPayload{Requester: signer, Subject: "0xsubject", Action: "freeze native YNXT", AssetType: "native_ynxt", Scope: "one account", Description: "directly freeze user native YNXT by protocol request", Evidence: []string{"case:native"}}, 1)
	illegalID := ApplicationActionRecordID("governance-request", ApplicationActionHash(illegalRaw))
	reviewRaw := mustTrustAction(t, key, ActionGovernanceCreate, GovernanceRequestPayload{Requester: signer, Subject: "0xsubject", Action: "add risk label", AssetType: "address", Scope: "one address", Description: "review one evidence-backed advisory risk label", Evidence: []string{"case:review"}}, 2)
	reviewID := ApplicationActionRecordID("governance-request", ApplicationActionHash(reviewRaw))
	reviewDecisionRaw := mustTrustAction(t, key, ActionGovernanceReview, GovernanceDecisionPayload{RequestID: reviewID, Reviewer: signer}, 3)
	manualRaw := mustTrustAction(t, key, ActionGovernanceCreate, GovernanceRequestPayload{Requester: signer, Subject: "0xsubject", Action: "correct evidence packet", AssetType: "evidence", Scope: "single evidence packet", Description: "correct one packet after bounded review", Evidence: []string{"case:manual"}}, 4)
	manualID := ApplicationActionRecordID("governance-request", ApplicationActionHash(manualRaw))
	rejectRaw := mustTrustAction(t, key, ActionGovernanceReject, GovernanceDecisionPayload{RequestID: manualID, Reviewer: signer, Reason: "outside approved case scope"}, 5)
	appealRaw := mustTrustAction(t, key, ActionTrustAppealCreate, TrustAppealPayload{RequestID: reviewID, Subject: "0xsubject", Appellant: signer, Claimant: signer, Reason: "false positive", Evidence: []string{"owner proof"}}, 6)
	appealID := ApplicationActionRecordID("trust-appeal", ApplicationActionHash(appealRaw))
	resolveRaw := mustTrustAction(t, key, ActionTrustAppealResolve, TrustAppealDecisionPayload{AppealID: appealID, Reviewer: signer, Decision: "LABEL_REMOVED", ResolutionReason: "evidence proved false positive"}, 7)
	txs := [][]byte{illegalRaw, reviewRaw, reviewDecisionRaw, manualRaw, rejectRaw, appealRaw, resolveRaw}
	height := int64(migration.Height) + 1
	proposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: txs})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("Trust proposal failed: %+v %v", proposal, err)
	}
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: txs})
	if err != nil || len(finalized.TxResults) != len(txs) {
		t.Fatalf("Trust finalize failed: %+v %v", finalized, err)
	}
	for _, result := range finalized.TxResults {
		if result.Code != 0 || len(result.Events) != 1 || result.Events[0].Type != "ynx.trust_action" {
			t.Fatalf("unexpected Trust result: %+v", result)
		}
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}

	var illegal BFTGovernanceRequest
	queryJSON(t, app, "/governance/requests/"+illegalID, &illegal)
	if illegal.Classification != chain.RequestIllegalOrAbusive || illegal.Status != "rejected" || !illegal.NativeYNXTProtected || !containsString(illegal.RuleIDs, "native-ynxt-no-direct-freeze") {
		t.Fatalf("native YNXT request was not rejected: %+v", illegal)
	}
	var reviewed BFTGovernanceRequest
	queryJSON(t, app, "/governance/requests/"+reviewID, &reviewed)
	if reviewed.Status != "reviewed" || reviewed.Reviewer != signer || reviewed.ReviewedAt == nil {
		t.Fatalf("governance review mismatch: %+v", reviewed)
	}
	var rejected BFTGovernanceRequest
	queryJSON(t, app, "/governance/requests/"+manualID, &rejected)
	if rejected.Status != "rejected" || rejected.RejectedAt == nil || !containsString(rejected.Reasons, "outside approved case scope") {
		t.Fatalf("manual rejection mismatch: %+v", rejected)
	}
	var appeal BFTTrustAppeal
	queryJSON(t, app, "/trust/appeals/"+appealID, &appeal)
	if appeal.Status != "LABEL_REMOVED" || appeal.ReviewerSigner != signer || appeal.ResolutionReason == "" {
		t.Fatalf("appeal resolution mismatch: %+v", appeal)
	}
	correctionID := ApplicationActionRecordID("trust-correction", ApplicationActionHash(resolveRaw))
	var correction BFTTrustCorrection
	queryJSON(t, app, "/trust/corrections/"+correctionID, &correction)
	if correction.AppealID != appealID || correction.AssetEffect != "none_advisory_only" || !correction.AppealAvailable || correction.EvidenceHash == "" {
		t.Fatalf("false-positive correction mismatch: %+v", correction)
	}
	var entries []BFTTransparencyEntry
	queryJSON(t, app, "/governance/transparency", &entries)
	if len(entries) != 7 || entries[0].Type != "governance_request" || entries[len(entries)-1].Type != "appeal_resolution" {
		t.Fatalf("transparency mismatch: %+v", entries)
	}
	assertConsensusAccount(t, app, signer, 93, 7)
	accountResponse, _ := app.Query(ctx, &abcitypes.RequestQuery{Path: "/accounts/" + signer})
	var account chain.ConsensusAccount
	_ = json.Unmarshal(accountResponse.Value, &account)
	if account.ResourceUsage.TrustUsed != 7 || account.ResourceUsage.BandwidthUsed != 7 {
		t.Fatalf("Trust resources not charged: %+v", account.ResourceUsage)
	}

	repeat := mustTrustAction(t, key, ActionTrustAppealResolve, TrustAppealDecisionPayload{AppealID: appealID, Reviewer: signer, Decision: "ACCEPTED", ResolutionReason: "repeat"}, 8)
	check, _ := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: repeat})
	if check.Code == 0 {
		t.Fatal("terminal appeal accepted another resolution")
	}
	impersonated := GovernanceRequestPayload{Requester: signer, Subject: "x", Action: "notify", AssetType: "address", Scope: "one", Description: "notice", Evidence: []string{"case"}}
	impersonatedRaw := mustTrustAction(t, otherKey, ActionGovernanceCreate, impersonated, 1)
	check, _ = app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: impersonatedRaw})
	if check.Code == 0 {
		t.Fatal("requester impersonation accepted")
	}

	restarted, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	var restored BFTTrustAppeal
	queryJSON(t, restarted, "/trust/appeals/"+appealID, &restored)
	if !bytes.Equal(mustJSON(t, restored), mustJSON(t, appeal)) {
		t.Fatal("Trust state changed after restart")
	}
}

func TestTrustPayloadRejectsOverlongEvidenceAndAppealWithoutTarget(t *testing.T) {
	key := deterministicPrivateKey(93)
	signer := mustNativeAddress(t, key)
	long := string(bytes.Repeat([]byte("x"), 257))
	if _, err := NewSignedApplicationAction(key, 6423, ActionGovernanceCreate, GovernanceRequestPayload{Requester: signer, Subject: "x", Action: "review", Evidence: []string{long}}, 1); err == nil {
		t.Fatal("overlong evidence accepted")
	}
	if _, err := NewSignedApplicationAction(key, 6423, ActionTrustAppealCreate, TrustAppealPayload{Subject: "x", Appellant: signer, Claimant: signer, Reason: "appeal"}, 1); err == nil {
		t.Fatal("BFT appeal accepted without a request or label target")
	}
	if _, err := NewSignedApplicationAction(key, 6423, ActionTrustLabelCreate, TrustLabelPayload{Issuer: signer, Subject: "not-a-transaction", SubjectType: "transaction", Label: "risk", Source: "case", EvidenceHash: strings.Repeat("a", 64), AppealAvailable: true}, 1); err == nil {
		t.Fatal("transaction Trust label accepted a non-transaction subject")
	}
	if _, err := NewSignedApplicationAction(key, 6423, ActionTrustLabelCreate, TrustLabelPayload{Issuer: signer, Subject: signer, Label: "risk", Source: "case", EvidenceHash: strings.Repeat("a", 64), AppealAvailable: true, LegalStatusUnderYNXChainLaw: "criminal"}, 1); err == nil {
		t.Fatal("Trust label accepted a criminal conclusion")
	}
}

func TestApplicationPersistsLabelEvidenceAndTrackingWorkflow(t *testing.T) {
	ctx := context.Background()
	key := deterministicPrivateKey(95)
	signer := mustNativeAddress(t, key)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(signer, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "complete-trust-state.json")
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	blockTime := time.Date(2026, 7, 12, 16, 0, 0, 0, time.UTC)

	labelRaw := mustTrustAction(t, key, ActionTrustLabelCreate, TrustLabelPayload{Issuer: signer, Subject: signer, SubjectType: "address", Address: signer, Label: "reviewed-risk", RiskWeightBps: 2500, ConfidenceBps: 8000, Source: "case:label", EvidenceHash: strings.Repeat("a", 64), ExpiryHours: 24, ReviewRequired: true, AppealAvailable: true}, 1)
	labelID := ApplicationActionRecordID("trust-label", ApplicationActionHash(labelRaw))
	appealRaw := mustTrustAction(t, key, ActionTrustAppealCreate, TrustAppealPayload{LabelID: labelID, Subject: signer, Appellant: signer, Claimant: signer, Reason: "label is a false positive", Evidence: []string{"owner-proof-hash"}}, 2)
	appealID := ApplicationActionRecordID("trust-appeal", ApplicationActionHash(appealRaw))
	resolveRaw := mustTrustAction(t, key, ActionTrustAppealResolve, TrustAppealDecisionPayload{AppealID: appealID, Reviewer: signer, Decision: "LABEL_REMOVED", ResolutionReason: "independent review cleared the evidence"}, 3)
	evidenceRaw := mustTrustAction(t, key, ActionTrustEvidenceCreate, TrustEvidencePayload{Requester: signer, Subject: signer}, 4)
	evidenceID := ApplicationActionRecordID("trust-evidence", ApplicationActionHash(evidenceRaw))
	trackingRaw := mustTrustAction(t, key, ActionTrustTrackingCreate, TrustTrackingPayload{Requester: signer, Subject: signer, Purpose: "single transfer screening", QueryType: "trace", Scope: "one transfer", Description: "minimum necessary review", Evidence: []string{"case:tracking"}, MinimumNecessary: true, ConfidenceBps: 7600, ExpiryHours: 24}, 5)
	trackingID := ApplicationActionRecordID("tracking-review", ApplicationActionHash(trackingRaw))
	overbroadRaw := mustTrustAction(t, key, ActionTrustTrackingCreate, TrustTrackingPayload{Requester: signer, Subject: signer, Purpose: "mass tracking all wallets", QueryType: "bulk profile", Scope: "entire chain", Evidence: []string{"case:bulk"}, MinimumNecessary: false, ConfidenceBps: 7000}, 6)
	overbroadID := ApplicationActionRecordID("tracking-review", ApplicationActionHash(overbroadRaw))
	txs := [][]byte{labelRaw, appealRaw, resolveRaw, evidenceRaw, trackingRaw, overbroadRaw}
	height := int64(migration.Height) + 1
	proposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: txs})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("complete Trust proposal failed: %+v %v", proposal, err)
	}
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: txs})
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range finalized.TxResults {
		if result.Code != 0 {
			t.Fatalf("Trust action failed: %+v", result)
		}
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}

	var label BFTTrustLabel
	queryJSON(t, app, "/trust/labels/"+labelID, &label)
	if label.RiskWeightBps != 0 || label.LabelType != "appeal_correction" || label.DisputeStatus != "resolved_after_appeal" || label.AssetEffect != "none_advisory_only" || !label.AppealAvailable {
		t.Fatalf("label correction mismatch: %+v", label)
	}
	var evidence BFTTrustEvidence
	queryJSON(t, app, "/trust/evidence/"+evidenceID, &evidence)
	if evidence.JSONHash == "" || len(evidence.Labels) != 1 || evidence.RiskSummary.AssetEffect != "none_advisory_only" || evidence.RiskSummary.CorrectionLabelCount != 1 {
		t.Fatalf("evidence mismatch: %+v", evidence)
	}
	var tracking, overbroad BFTTrackingReview
	queryJSON(t, app, "/trust/tracking-reviews/"+trackingID, &tracking)
	queryJSON(t, app, "/trust/tracking-reviews/"+overbroadID, &overbroad)
	if tracking.Status != "logged" || tracking.Classification != chain.RequestValidUnderYNXChainLaw || tracking.AppealPath != "/trust/appeals" {
		t.Fatalf("tracking mismatch: %+v", tracking)
	}
	if overbroad.Status != "rejected" || overbroad.Classification != chain.RequestOverbroad {
		t.Fatalf("overbroad tracking accepted: %+v", overbroad)
	}
	var trace chain.TrustTrace
	queryJSON(t, app, "/trust/trace/"+signer, &trace)
	if trace.Address != signer || len(trace.Lots) == 0 || !containsString(trace.Labels, "advisory-risk-labels-present") {
		t.Fatalf("trace mismatch: %+v", trace)
	}
	assertConsensusAccount(t, app, signer, 94, 6)
	trackingAppeal := mustTrustAction(t, key, ActionTrustAppealCreate, TrustAppealPayload{RequestID: trackingID, Subject: signer, Appellant: signer, Claimant: signer, Reason: "tracking scope dispute", Evidence: []string{"appeal-evidence-hash"}}, 7)
	check, _ := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: trackingAppeal})
	if check.Code != 0 {
		t.Fatalf("tracking review appeal was not accepted: %+v", check)
	}
	unknownEvidence := mustTrustAction(t, key, ActionTrustEvidenceCreate, TrustEvidencePayload{Requester: signer, Subject: "unknown-subject"}, 7)
	check, _ = app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: unknownEvidence})
	if check.Code == 0 {
		t.Fatal("empty Trust evidence packet accepted for unknown subject")
	}
	restarted, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	var restored BFTTrustEvidence
	queryJSON(t, restarted, "/trust/evidence/"+evidenceID, &restored)
	if !bytes.Equal(mustJSON(t, evidence), mustJSON(t, restored)) {
		t.Fatal("complete Trust state changed after restart")
	}
}

func TestTrustResourceFieldPreservesExistingActionEncoding(t *testing.T) {
	key := deterministicPrivateKey(94)
	ai := mustTrustAction(t, key, ActionAIPermissionCreate, AIPermissionPayload{SessionID: "session", Requester: "requester", Scope: "read", Purpose: "compatibility", ExpiryHours: 1}, 1)
	pay := PayIntentPayload{Merchant: "merchant_compat", Amount: 1, Currency: "YNXT", IdempotencyKey: "compat-key"}
	pay.RequestHash = PayIntentRequestHash(pay.Merchant, pay.Amount, pay.Currency, pay.CallbackURL, pay.IdempotencyKey)
	payRaw := mustTrustAction(t, key, ActionPayIntentCreate, pay, 1)
	signer := mustNativeAddress(t, key)
	trustRaw := mustTrustAction(t, key, ActionGovernanceCreate, GovernanceRequestPayload{Requester: signer, Subject: "subject", Action: "review", AssetType: "address", Scope: "one", Description: "compatibility", Evidence: []string{"case"}}, 1)
	if bytes.Contains(ai, []byte(`"trustUnits"`)) || bytes.Contains(payRaw, []byte(`"trustUnits"`)) {
		t.Fatal("zero Trust resource field changed existing AI or Pay canonical encoding")
	}
	if !bytes.Contains(trustRaw, []byte(`"trustUnits":1`)) {
		t.Fatal("Trust action did not sign its explicit Trust resource charge")
	}
}

func mustTrustAction(t *testing.T, key *secp256k1.PrivateKey, action string, input any, nonce uint64) []byte {
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
func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
