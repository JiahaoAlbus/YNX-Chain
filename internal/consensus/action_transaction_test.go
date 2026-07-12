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
)

func TestSignedApplicationActionCanonicalAndDomainSeparated(t *testing.T) {
	key := deterministicPrivateKey(31)
	tx, err := NewSignedApplicationAction(key, 6423, ActionAIPermissionCreate, AIPermissionPayload{
		SessionID: "session-1", Requester: "merchant_ops", Scope: "trust_label", Purpose: "review label", ExpiryHours: 2,
	}, 1)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeSignedApplicationAction(payload)
	if err != nil || decoded.Signer != mustNativeAddress(t, key) || decoded.Action != ActionAIPermissionCreate {
		t.Fatalf("unexpected action round trip: %+v err=%v", decoded, err)
	}
	if kind, err := TransactionEnvelopeType(payload); err != nil || kind != SignedActionType {
		t.Fatalf("unexpected envelope kind %q: %v", kind, err)
	}
	if _, err := DecodeSignedTransaction(payload); err == nil {
		t.Fatal("application action decoded as native transfer")
	}
	if err := decoded.Verify(1); err == nil {
		t.Fatal("application action replayed on another chain")
	}
	if _, err := DecodeSignedApplicationAction(append(payload, '\n')); err == nil {
		t.Fatal("noncanonical action JSON accepted")
	}

	var tampered map[string]any
	if err := json.Unmarshal(payload, &tampered); err != nil {
		t.Fatal(err)
	}
	tampered["payloadHash"] = "00" + tampered["payloadHash"].(string)[2:]
	tamperedPayload, _ := json.Marshal(tampered)
	tamperedTx, err := DecodeSignedApplicationAction(tamperedPayload)
	if err == nil && tamperedTx.Verify(6423) == nil {
		t.Fatal("tampered payload hash passed verification")
	}

	var withUnknown map[string]any
	_ = json.Unmarshal(payload, &withUnknown)
	withUnknown["hidden"] = true
	unknownPayload, _ := json.Marshal(withUnknown)
	if _, err := DecodeSignedApplicationAction(unknownPayload); err == nil {
		t.Fatal("unknown action envelope field accepted")
	}
}

func TestApplicationPersistsBoundAIWorkflowAndRejectsUnauthorizedApproval(t *testing.T) {
	ctx := context.Background()
	signerKey := deterministicPrivateKey(41)
	unauthorizedKey := deterministicPrivateKey(42)
	signer := mustNativeAddress(t, signerKey)
	unauthorized := mustNativeAddress(t, unauthorizedKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(signer, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet(unauthorized, 10); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "abci-state.json")
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}

	permissionTx, _ := NewSignedApplicationAction(signerKey, 6423, ActionAIPermissionCreate, AIPermissionPayload{
		SessionID: "session-1", Requester: "merchant_ops", Scope: "trust_label", Purpose: "review scoped label", ExpiryHours: 2,
	}, 1)
	permissionBytes, _ := EncodeSignedApplicationAction(permissionTx)
	permissionID := ApplicationActionRecordID("ai-permission", ApplicationActionHash(permissionBytes))
	actionTx, _ := NewSignedApplicationAction(signerKey, 6423, ActionAIProposalCreate, AIActionProposalPayload{
		SessionID: "session-1", Requester: "merchant_ops", Scope: "trust_label", ActionType: "risk label", Description: "review a bounded risk label", ExpiryHours: 2,
	}, 2)
	actionBytes, _ := EncodeSignedApplicationAction(actionTx)
	actionID := ApplicationActionRecordID("ai-action", ApplicationActionHash(actionBytes))
	approvalTx, _ := NewSignedApplicationAction(signerKey, 6423, ActionAIProposalApprove, AIActionDecisionPayload{ActionID: actionID, Approver: "reviewer_1", PermissionID: permissionID}, 3)
	approvalBytes, _ := EncodeSignedApplicationAction(approvalTx)

	blockTime := time.Date(2026, 7, 12, 8, 30, 0, 0, time.UTC)
	height := int64(migration.Height) + 1
	reversed, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: [][]byte{approvalBytes, actionBytes, permissionBytes}})
	if err != nil || reversed.Status != abcitypes.ResponseProcessProposal_REJECT {
		t.Fatalf("dependency-reversed proposal accepted: %+v err=%v", reversed, err)
	}
	ordered, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: [][]byte{permissionBytes, actionBytes, approvalBytes}})
	if err != nil || ordered.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("ordered AI proposal rejected: %+v err=%v", ordered, err)
	}
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: [][]byte{permissionBytes, actionBytes, approvalBytes}})
	if err != nil || len(finalized.TxResults) != 3 {
		t.Fatalf("AI block failed: %+v err=%v", finalized, err)
	}
	for _, result := range finalized.TxResults {
		if result.Code != 0 || len(result.Events) != 1 || result.Events[0].Type != "ynx.application_action" {
			t.Fatalf("unexpected AI execution result: %+v", result)
		}
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}

	var permission BFTAIPermission
	queryJSON(t, app, "/ai/permissions/"+permissionID, &permission)
	if permission.Signer != signer || permission.CreatedAt != blockTime || permission.BlockHeight != height || permission.AuditHash == "" {
		t.Fatalf("unexpected permission: %+v", permission)
	}
	var action BFTAIAction
	queryJSON(t, app, "/ai/actions/"+actionID, &action)
	if action.Status != "approved" || !action.Executable || action.PermissionID != permissionID || action.ApprovedAt == nil || *action.ApprovedAt != blockTime || action.ApprovedBy != "reviewer_1" {
		t.Fatalf("unexpected approved action: %+v", action)
	}
	var audit []BFTAIAuditEvent
	queryJSON(t, app, "/ai/audit", &audit)
	if len(audit) != 3 || audit[0].CreatedAt != blockTime || audit[2].RecordID != actionID {
		t.Fatalf("unexpected append-only audit: %+v", audit)
	}
	assertConsensusAccount(t, app, signer, 97, 3)

	unauthorizedApproval, _ := NewSignedApplicationAction(unauthorizedKey, 6423, ActionAIProposalApprove, AIActionDecisionPayload{ActionID: actionID, Approver: "intruder", PermissionID: permissionID}, 1)
	unauthorizedBytes, _ := EncodeSignedApplicationAction(unauthorizedApproval)
	check, err := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: unauthorizedBytes})
	if err != nil || check.Code == 0 {
		t.Fatalf("unauthorized approval passed CheckTx: %+v err=%v", check, err)
	}
	replay, _ := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: permissionBytes})
	if replay.Code != CodeInvalidNonce {
		t.Fatalf("permission replay was not rejected: %+v", replay)
	}

	restarted, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	var restored BFTAIAction
	queryJSON(t, restarted, "/ai/actions/"+actionID, &restored)
	if !bytes.Equal(mustJSON(t, restored), mustJSON(t, action)) {
		t.Fatalf("restored AI action changed:\n%+v\n%+v", restored, action)
	}
}

func queryJSON(t *testing.T, app *Application, path string, out any) {
	t.Helper()
	response, err := app.Query(context.Background(), &abcitypes.RequestQuery{Path: path})
	if err != nil || response.Code != 0 {
		t.Fatalf("query %s failed: %+v err=%v", path, response, err)
	}
	if err := json.Unmarshal(response.Value, out); err != nil {
		t.Fatal(err)
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}
