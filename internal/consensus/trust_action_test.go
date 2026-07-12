package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
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

func TestTrustPayloadRejectsOverlongEvidenceAndLabelOnlyAppeal(t *testing.T) {
	key := deterministicPrivateKey(93)
	signer := mustNativeAddress(t, key)
	long := string(bytes.Repeat([]byte("x"), 257))
	if _, err := NewSignedApplicationAction(key, 6423, ActionGovernanceCreate, GovernanceRequestPayload{Requester: signer, Subject: "x", Action: "review", Evidence: []string{long}}, 1); err == nil {
		t.Fatal("overlong evidence accepted")
	}
	if _, err := NewSignedApplicationAction(key, 6423, ActionTrustAppealCreate, TrustAppealPayload{LabelID: "1234567890abcdef12345678", Subject: "x", Appellant: signer, Claimant: signer, Reason: "appeal"}, 1); err == nil {
		t.Fatal("label-only BFT appeal accepted without label state")
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
