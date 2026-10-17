package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestFeeJournalMixedTransactionsPreserveOrderAndRestart(t *testing.T) {
	ownerKey, bundlerKey := deterministicPrivateKey(201), deterministicPrivateKey(202)
	nativeKey, ethereumKey, actionKey := deterministicPrivateKey(203), deterministicPrivateKey(204), deterministicPrivateKey(205)
	owner, bundler := mustNativeAddress(t, ownerKey), mustNativeAddress(t, bundlerKey)
	recipient := mustNativeAddress(t, deterministicPrivateKey(206))
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	for _, key := range []*secp256k1.PrivateKey{ownerKey, bundlerKey, nativeKey, ethereumKey, actionKey} {
		if _, err := devnet.Faucet(mustNativeAddress(t, key), 100000); err != nil {
			t.Fatal(err)
		}
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "state.json")
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	start := time.Unix(1802736000, 0).UTC()
	height := int64(migration.Height) + 1
	ownerSigningKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{201}, ed25519.SeedSize))
	guardian := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{202}, ed25519.SeedSize)).Public().(ed25519.PublicKey)
	create := signedAssetAction(t, ownerKey, ActionSmartAccountCreate, SmartAccountCreatePayload{
		OwnerAlgorithm: assetauth.SignatureEd25519, OwnerPublicKey: ownerSigningKey.Public().(ed25519.PublicKey), SessionKeys: []assetauth.SessionKey{},
		Recovery: assetauth.GuardianRecoveryPolicy{Guardians: map[string][]byte{"guardian": guardian}, Threshold: 1, Delay: time.Hour},
	}, 1)
	setup, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: start, Txs: [][]byte{create}})
	if err != nil || setup.TxResults[0].Code != 0 {
		t.Fatalf("smart account setup: %+v %v", setup, err)
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	wantFees := append([]BFTFeeEvent(nil), app.committed.FeeEvents...)
	if len(wantFees) != 1 {
		t.Fatal("expected one setup fee")
	}
	height++
	blockTime := start.Add(time.Minute)
	native, err := NewSignedTransfer(nativeKey, 6423, recipient, 3, 1)
	if err != nil {
		t.Fatal(err)
	}
	nativeRaw, err := EncodeSignedTransaction(native)
	if err != nil {
		t.Fatal(err)
	}
	ethereumRaw, ethereum, err := NewEthereumLegacyTransfer(ethereumKey, 6423, 0, 1, recipient, 4)
	if err != nil {
		t.Fatal(err)
	}
	action := signedAssetAction(t, actionKey, ActionAIPermissionCreate, AIPermissionPayload{SessionID: "fee-journal", Requester: "local-test", Scope: "trust_label", Purpose: "mixed fee test", ExpiryHours: 2}, 1)
	operation := assetauth.UserOperation{
		Version: 1, ChainID: assetauth.MandateChainID, Account: owner, ProductID: "wallet", NonceDomain: "wallet/main", Nonce: 0,
		Calls:      []assetauth.AccountCall{{Target: recipient, Method: "transfer", ValueYNXT: 5, Asset: "ynxt", PayloadHash: hashText("mixed fee journal")}},
		MaxFeeYNXT: 1, ValidAfter: start, ValidUntil: start.Add(time.Hour),
	}
	signBytes, err := operation.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	operation.Signature = ed25519.Sign(ownerSigningKey, signBytes)
	userOperation := signedAssetAction(t, bundlerKey, ActionUserOperationExecute, UserOperationExecutePayload{Operation: operation}, 1)
	txs := [][]byte{nativeRaw, nativeRaw, ethereumRaw, action, userOperation}
	before, _ := json.Marshal(app.committed)
	for _, payload := range txs {
		assertCheckTxMatchesIsolatedExecution(t, app, payload)
	}
	proposal, err := app.PrepareProposal(ctx, &abcitypes.RequestPrepareProposal{Height: height, Time: blockTime, MaxTxBytes: 1 << 20, Txs: txs})
	if err != nil || len(proposal.Txs) != 4 {
		t.Fatalf("mixed proposal did not omit duplicate: %+v %v", proposal, err)
	}
	processed, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: proposal.Txs})
	if err != nil || processed.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("valid mixed proposal rejected: %+v %v", processed, err)
	}
	afterProposal, _ := json.Marshal(app.committed)
	if !bytes.Equal(before, afterProposal) {
		t.Fatal("proposal evaluation mutated committed state")
	}
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: txs})
	if err != nil {
		t.Fatal(err)
	}
	for i, result := range finalized.TxResults {
		if (i == 1 && result.Code != CodeInvalidNonce) || (i != 1 && result.Code != 0) {
			t.Fatalf("unexpected mixed result %d: %+v", i, result)
		}
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	wantFees = append(wantFees,
		newCurrentFeeEvent(SignedTransactionHash(nativeRaw), SignedTransactionType, native.From, app.feeRecipient, 1, height, blockTime),
		newEthereumGasFeeEvent(ethereum.Hash, EthereumLegacyTransferType, ethereum.From, app.feeRecipient, ethereum.Fee, height, blockTime),
		newCurrentFeeEvent(ApplicationActionHash(action), ActionAIPermissionCreate, mustNativeAddress(t, actionKey), app.feeRecipient, 1, height, blockTime),
		newCurrentFeeEvent(ApplicationActionHash(userOperation), "user_operation", owner, app.feeRecipient, 1, height, blockTime),
	)
	assertFeeJournalEvents(t, app.committed.FeeEvents, wantFees)
	assertConsensusAccount(t, app, recipient, 12, 0)
	assertConsensusAccount(t, app, native.From, 99996, 1)
	assertConsensusAccount(t, app, ethereum.From, 100000-4-ethereum.Fee, 1)
	assertConsensusAccount(t, app, owner, 99993, 1)
	assertConsensusAccount(t, app, bundler, 100000, 1)
	restarted, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	expectedState, _ := json.Marshal(app.committed)
	restartedState, _ := json.Marshal(restarted.committed)
	if !bytes.Equal(expectedState, restartedState) {
		t.Fatal("mixed committed state changed across durable restart")
	}
	assertFeeJournalEvents(t, restarted.committed.FeeEvents, wantFees)
}
