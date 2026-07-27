package governance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type inProcessChainExecutionClient struct {
	app       *consensus.Application
	height    int64
	blockTime time.Time
	broadcast int
}

func (c *inProcessChainExecutionClient) GovernanceExecution(ctx context.Context, proposalID string) (consensus.BFTGovernanceExecution, bool, error) {
	response, err := c.app.Query(ctx, &abcitypes.RequestQuery{Path: "/governance/executions/" + proposalID})
	if err != nil {
		return consensus.BFTGovernanceExecution{}, false, err
	}
	if response.Code != 0 {
		return consensus.BFTGovernanceExecution{}, false, nil
	}
	var record consensus.BFTGovernanceExecution
	if err = json.Unmarshal(response.Value, &record); err != nil {
		return consensus.BFTGovernanceExecution{}, false, err
	}
	return record, true, nil
}

func (c *inProcessChainExecutionClient) BroadcastGovernanceAction(ctx context.Context, raw []byte) error {
	c.broadcast++
	proposal, err := c.app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: c.height, Time: c.blockTime, Txs: [][]byte{raw}})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		if err != nil {
			return err
		}
		return ErrForbidden
	}
	finalized, err := c.app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: c.height, Time: c.blockTime, Txs: [][]byte{raw}})
	if err != nil {
		return err
	}
	if len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != 0 {
		return ErrForbidden
	}
	_, err = c.app.Commit(ctx, &abcitypes.RequestCommit{})
	c.height++
	c.blockTime = c.blockTime.Add(time.Minute)
	return err
}

func (c *inProcessChainExecutionClient) GovernanceBlockHash(_ context.Context, height int64) (string, error) {
	if height <= 0 || height >= c.height {
		return "", ErrNotFound
	}
	return "0x" + fmt.Sprintf("%064x", height), nil
}

func TestCanonicalChainExecutionAdapterReservesCommitsReconcilesAndConfirms(t *testing.T) {
	now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	manifest := strings.Repeat("a", 64)
	passTestCanary(t, service, proposal, manifest)

	intent, reserved, err := service.PrepareChainExecution(proposal.ID, manifest, proposal.ExecuteAfter)
	if err != nil || reserved.Status != StatusExecutionReady {
		t.Fatalf("execution reservation failed: %+v err=%v", reserved, err)
	}
	if intent.ProposalID != proposal.ID || intent.ActionHash != proposal.ActionHash || intent.ManifestHash != manifest ||
		!validHash(intent.GovernanceAuditHash) || !validHash(intent.TimelockAuditHash) || !validHash(intent.CanaryAuditHash) || !validHash(intent.EvidenceHash) {
		t.Fatalf("invalid canonical execution intent: %+v", intent)
	}

	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x71}, 32))
	signer, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err = devnet.Faucet(signer, 100); err != nil {
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
	client := &inProcessChainExecutionClient{app: app, height: int64(migration.Height) + 1, blockTime: proposal.ExecuteAfter}
	owner, err := NewCanonicalChainExecutionAdapter(migration.Network.ChainID, signer, client)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := consensus.NewSignedApplicationAction(key, migration.Network.ChainID, consensus.ActionGovernanceExecutionBegin, intent, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := consensus.EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	auth := &testAuth{principal: Principal{
		Account: "execution-operator", Product: "governance", DeviceID: "device-1", SessionID: "session-1",
		Roles: map[string]bool{"executor": true, "verifier": true}, Scopes: map[Scope]bool{ScopeBridge: true},
	}}
	statePath := filepath.Join(t.TempDir(), "governance-state.json")
	runtimeNow := proposal.ExecuteAfter
	server, err := NewServerWithExecutionOwner(service, auth, owner, statePath, func() time.Time { return runtimeNow })
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"manifestHash": manifest, "signedAction": json.RawMessage(raw)})
	request := httptest.NewRequest(http.MethodPost, "/governance/proposals/"+proposal.ID+"/execute", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || client.broadcast != 1 {
		t.Fatalf("canonical submission failed: status=%d body=%s broadcasts=%d", recorder.Code, recorder.Body.String(), client.broadcast)
	}
	record, found, err := client.GovernanceExecution(context.Background(), proposal.ID)
	if err != nil || !found || record.Status != "submitted" {
		t.Fatalf("canonical record missing after submission: %+v found=%v err=%v", record, found, err)
	}
	submitted, err := service.Get(proposal.ID)
	if err != nil || submitted.Status != StatusExecutionSubmitted {
		t.Fatalf("canonical confirmation failed: %+v err=%v", submitted, err)
	}
	restored, err := Load(statePath)
	if err != nil {
		t.Fatal(err)
	}
	restoredProposal, _ := restored.Get(proposal.ID)
	if restoredProposal.Status != StatusExecutionSubmitted {
		t.Fatalf("canonical confirmation was not persisted: %+v", restoredProposal)
	}
	timelocks := service.ListTimelocks(proposal.ExecuteAfter)
	if len(timelocks) != 1 || timelocks[0].Status != TimelockSubmitted ||
		!strings.Contains(strings.Join(timelocks[0].Transitions[len(timelocks[0].Transitions)-1].Evidence, " "), record.BeginTxHash) {
		t.Fatalf("Chain Core receipt not bound into timelock audit: %+v", timelocks)
	}

	retryTx, err := consensus.NewSignedApplicationAction(key, migration.Network.ChainID, consensus.ActionGovernanceExecutionBegin, intent, 2)
	if err != nil {
		t.Fatal(err)
	}
	retryRaw, _ := consensus.EncodeSignedApplicationAction(retryTx)
	reconciled, err := owner.Submit(context.Background(), intent, retryRaw)
	if err != nil || reconciled.BeginTxHash != record.BeginTxHash || client.broadcast != 1 {
		t.Fatalf("committed submission was not reconciled without rebroadcast: %+v broadcasts=%d err=%v", reconciled, client.broadcast, err)
	}

	runtimeNow = proposal.ExecuteAfter.Add(time.Minute)
	stateRoot, evidenceHash := strings.Repeat("8", 64), strings.Repeat("9", 64)
	prepareBody, _ := json.Marshal(map[string]string{"outcome": "verified", "stateRoot": stateRoot, "evidenceHash": evidenceHash})
	prepareRequest := httptest.NewRequest(http.MethodPost, "/governance/proposals/"+proposal.ID+"/verify/prepare", bytes.NewReader(prepareBody))
	prepareRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(prepareRecorder, prepareRequest)
	if prepareRecorder.Code != http.StatusOK {
		t.Fatalf("verification prepare failed: status=%d body=%s", prepareRecorder.Code, prepareRecorder.Body.String())
	}
	var prepared struct {
		Data struct {
			Intent consensus.GovernanceExecutionVerifyPayload `json:"intent"`
		} `json:"data"`
	}
	if err = json.Unmarshal(prepareRecorder.Body.Bytes(), &prepared); err != nil || prepared.Data.Intent.BeginTxHash != record.BeginTxHash {
		t.Fatalf("invalid signable verification intent: %+v err=%v", prepared, err)
	}
	verifyTx, err := consensus.NewSignedApplicationAction(key, migration.Network.ChainID, consensus.ActionGovernanceExecutionVerify, prepared.Data.Intent, 2)
	if err != nil {
		t.Fatal(err)
	}
	verifyRaw, _ := consensus.EncodeSignedApplicationAction(verifyTx)
	verifyBody, _ := json.Marshal(map[string]any{"outcome": "verified", "stateRoot": stateRoot, "evidenceHash": evidenceHash, "signedAction": json.RawMessage(verifyRaw)})
	verifyRequest := httptest.NewRequest(http.MethodPost, "/governance/proposals/"+proposal.ID+"/verify", bytes.NewReader(verifyBody))
	verifyRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(verifyRecorder, verifyRequest)
	if verifyRecorder.Code != http.StatusOK || client.broadcast != 2 {
		t.Fatalf("canonical verification failed: status=%d body=%s broadcasts=%d", verifyRecorder.Code, verifyRecorder.Body.String(), client.broadcast)
	}
	verified, err := service.Get(proposal.ID)
	if err != nil || verified.Status != StatusVerified || verified.ExecutionReceipt == nil ||
		verified.ExecutionReceipt.TxHash != consensus.ApplicationActionHash(verifyRaw) ||
		verified.ExecutionReceipt.StateRoot != stateRoot || verified.ExecutionReceipt.BlockHash == "" {
		t.Fatalf("canonical receipt was not confirmed: %+v err=%v", verified, err)
	}
	restored, err = Load(statePath)
	if err != nil {
		t.Fatal(err)
	}
	restoredProposal, _ = restored.Get(proposal.ID)
	if restoredProposal.Status != StatusVerified || restoredProposal.ExecutionReceipt == nil {
		t.Fatalf("verified execution was not persisted: %+v", restoredProposal)
	}
	retryVerifyTx, _ := consensus.NewSignedApplicationAction(key, migration.Network.ChainID, consensus.ActionGovernanceExecutionVerify, prepared.Data.Intent, 3)
	retryVerifyRaw, _ := consensus.EncodeSignedApplicationAction(retryVerifyTx)
	reconciledVerification, _, err := owner.Verify(context.Background(), prepared.Data.Intent, retryVerifyRaw)
	if err != nil || reconciledVerification.Status != "verified" || client.broadcast != 2 {
		t.Fatalf("verification reconciliation rebroadcast or failed: %+v broadcasts=%d err=%v", reconciledVerification, client.broadcast, err)
	}
}

func TestCanonicalChainExecutionAdapterRejectsSignerPayloadAndMissingOwner(t *testing.T) {
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	manifest := strings.Repeat("b", 64)
	passTestCanary(t, service, proposal, manifest)
	intent, _, err := service.PrepareChainExecution(proposal.ID, manifest, proposal.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}

	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x72}, 32))
	otherKey := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x73}, 32))
	signer, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	client := &inProcessChainExecutionClient{}
	owner, _ := NewCanonicalChainExecutionAdapter(6423, signer, client)
	wrongSigner, _ := consensus.NewSignedApplicationAction(otherKey, 6423, consensus.ActionGovernanceExecutionBegin, intent, 1)
	wrongSignerRaw, _ := consensus.EncodeSignedApplicationAction(wrongSigner)
	if _, err = owner.Submit(context.Background(), intent, wrongSignerRaw); err == nil {
		t.Fatal("unapproved execution signer was accepted")
	}
	changed := intent
	changed.ManifestHash = strings.Repeat("c", 64)
	wrongPayload, _ := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionGovernanceExecutionBegin, changed, 1)
	wrongPayloadRaw, _ := consensus.EncodeSignedApplicationAction(wrongPayload)
	if _, err = owner.Submit(context.Background(), intent, wrongPayloadRaw); err == nil {
		t.Fatal("changed manifest payload was accepted")
	}

	unintegrated := testService(t)
	unintegratedProposal := proposalAtTimelock(t, unintegrated, now)
	passTestCanary(t, unintegrated, unintegratedProposal, manifest)
	auth := &testAuth{principal: Principal{
		Account: "execution-operator", Product: "governance", DeviceID: "device-1", SessionID: "session-1",
		Roles: map[string]bool{"executor": true}, Scopes: map[Scope]bool{ScopeBridge: true},
	}}
	server, err := NewServer(unintegrated, auth, filepath.Join(t.TempDir(), "state.json"), func() time.Time { return unintegratedProposal.ExecuteAfter })
	if err != nil {
		t.Fatal(err)
	}
	prepareBody, _ := json.Marshal(map[string]string{"manifestHash": manifest})
	prepareRequest := httptest.NewRequest(http.MethodPost, "/governance/proposals/"+unintegratedProposal.ID+"/execute/prepare", bytes.NewReader(prepareBody))
	prepareRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(prepareRecorder, prepareRequest)
	if prepareRecorder.Code != http.StatusOK {
		t.Fatalf("execution prepare endpoint failed: status=%d body=%s", prepareRecorder.Code, prepareRecorder.Body.String())
	}
	var prepared struct {
		Data struct {
			Intent consensus.GovernanceExecutionBeginPayload `json:"intent"`
		} `json:"data"`
	}
	if err = json.Unmarshal(prepareRecorder.Body.Bytes(), &prepared); err != nil || prepared.Data.Intent.ProposalID != unintegratedProposal.ID {
		t.Fatalf("prepare endpoint did not expose signable intent: %+v err=%v", prepared, err)
	}
	body, _ := json.Marshal(map[string]any{"manifestHash": manifest, "signedAction": json.RawMessage(`{}`)})
	request := httptest.NewRequest(http.MethodPost, "/governance/proposals/"+unintegratedProposal.ID+"/execute", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing Chain Core owner did not fail closed: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	stored, _ := unintegrated.Get(unintegratedProposal.ID)
	if stored.Status != StatusExecutionReady {
		t.Fatalf("missing Chain Core owner advanced beyond the persisted reservation: %+v", stored)
	}
}

func TestCanonicalChainFailureAndRollbackProduceIndependentGovernanceReceipts(t *testing.T) {
	now := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	manifest := strings.Repeat("a", 64)
	passTestCanary(t, service, proposal, manifest)
	beginIntent, _, err := service.PrepareChainExecution(proposal.ID, manifest, proposal.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x74}, 32))
	signer, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_, _ = devnet.Faucet(signer, 100)
	devnet.ProduceBlock()
	migration, _ := devnet.ExportConsensusMigrationState()
	app, _ := consensus.NewApplication(migration)
	client := &inProcessChainExecutionClient{app: app, height: int64(migration.Height) + 1, blockTime: proposal.ExecuteAfter}
	owner, _ := NewCanonicalChainExecutionAdapter(migration.Network.ChainID, signer, client)
	beginTx, _ := consensus.NewSignedApplicationAction(key, migration.Network.ChainID, consensus.ActionGovernanceExecutionBegin, beginIntent, 1)
	beginRaw, _ := consensus.EncodeSignedApplicationAction(beginTx)
	beginRecord, err := owner.Submit(context.Background(), beginIntent, beginRaw)
	if err != nil {
		t.Fatal(err)
	}
	proposal, err = service.confirmChainExecution(proposal.ID, beginIntent, beginRecord, proposal.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}

	failureIntent, err := service.PrepareChainVerification(proposal.ID, "failed", strings.Repeat("b", 64), strings.Repeat("c", 64))
	if err != nil {
		t.Fatal(err)
	}
	failureTx, _ := consensus.NewSignedApplicationAction(key, migration.Network.ChainID, consensus.ActionGovernanceExecutionVerify, failureIntent, 2)
	failureRaw, _ := consensus.EncodeSignedApplicationAction(failureTx)
	failedRecord, failureBlock, err := owner.Verify(context.Background(), failureIntent, failureRaw)
	if err != nil {
		t.Fatal(err)
	}
	proposal, err = service.confirmChainVerification(proposal.ID, failureIntent, failedRecord, failureBlock, proposal.ExecuteAfter.Add(time.Minute))
	if err != nil || proposal.Status != StatusExecutionFailed || proposal.ExecutionReceipt == nil ||
		proposal.ExecutionReceipt.Outcome != "failed" || proposal.ExecutionReceipt.TxHash != failedRecord.FailureTxHash {
		t.Fatalf("canonical failure receipt missing: %+v err=%v", proposal, err)
	}

	rollbackIntent, err := service.PrepareChainVerification(proposal.ID, "rolled_back", strings.Repeat("d", 64), strings.Repeat("e", 64))
	if err != nil || rollbackIntent.RollbackManifest != expectedRollbackManifestHash(&proposal) ||
		rollbackIntent.RollbackManifest == proposal.ExecutionHash {
		t.Fatalf("rollback intent is not bound to the approved plan: %+v err=%v", rollbackIntent, err)
	}
	tampered := rollbackIntent
	tampered.RollbackManifest = strings.Repeat("f", 64)
	tamperedTx, _ := consensus.NewSignedApplicationAction(key, migration.Network.ChainID, consensus.ActionGovernanceExecutionVerify, tampered, 3)
	tamperedRaw, _ := consensus.EncodeSignedApplicationAction(tamperedTx)
	if _, _, err = owner.Verify(context.Background(), rollbackIntent, tamperedRaw); err == nil {
		t.Fatal("changed rollback manifest was accepted")
	}
	rollbackTx, _ := consensus.NewSignedApplicationAction(key, migration.Network.ChainID, consensus.ActionGovernanceExecutionVerify, rollbackIntent, 3)
	rollbackRaw, _ := consensus.EncodeSignedApplicationAction(rollbackTx)
	rolledBackRecord, rollbackBlock, err := owner.Verify(context.Background(), rollbackIntent, rollbackRaw)
	if err != nil {
		t.Fatal(err)
	}
	proposal, err = service.confirmChainVerification(proposal.ID, rollbackIntent, rolledBackRecord, rollbackBlock, proposal.ExecuteAfter.Add(2*time.Minute))
	if err != nil || proposal.Status != StatusRolledBack || proposal.RollbackReceipt == nil ||
		proposal.RollbackReceipt.Outcome != "verified_rollback" ||
		proposal.RollbackReceipt.ManifestHash != rollbackIntent.RollbackManifest ||
		proposal.ExecutionReceipt.TxHash != rolledBackRecord.FailureTxHash ||
		proposal.RollbackReceipt.TxHash != rolledBackRecord.VerifyTxHash {
		t.Fatalf("independent failure/rollback receipts missing: %+v err=%v", proposal, err)
	}
}
