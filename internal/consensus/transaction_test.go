package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestSignedTransactionCanonicalAddressAndSignature(t *testing.T) {
	senderKey := deterministicPrivateKey(1)
	recipientKey := deterministicPrivateKey(2)
	recipient, err := NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	tx, err := NewSignedTransfer(senderKey, 6423, recipient, 125, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !IsNativeAddress(tx.From) || tx.From == recipient {
		t.Fatalf("unexpected native account derivation: from=%s to=%s", tx.From, recipient)
	}
	if tx.From != "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf" {
		t.Fatalf("native address derivation is not EVM compatible: %s", tx.From)
	}
	payload, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeSignedTransaction(payload)
	if err != nil || decoded != tx {
		t.Fatalf("canonical signed transaction round trip failed: decoded=%+v err=%v", decoded, err)
	}
	if err := decoded.Verify(6423); err != nil {
		t.Fatal(err)
	}

	tampered := tx
	tampered.Amount++
	tamperedPayload, err := json.Marshal(tampered)
	if err != nil {
		t.Fatal(err)
	}
	tampered, err = DecodeSignedTransaction(tamperedPayload)
	if err != nil {
		t.Fatal(err)
	}
	if err := tampered.Verify(6423); err == nil {
		t.Fatal("tampered signed transaction passed verification")
	}
	if _, err := DecodeSignedTransaction(append(payload, '\n')); err == nil {
		t.Fatal("non-canonical transaction JSON was accepted")
	}
	if err := decoded.Verify(1); err == nil {
		t.Fatal("signed transaction was replayable on another chain ID")
	}
}

func TestApplicationExecutesSignedTransferAndRestoresCommittedState(t *testing.T) {
	senderKey := deterministicPrivateKey(11)
	recipientKey := deterministicPrivateKey(12)
	sender := mustNativeAddress(t, senderKey)
	recipient := mustNativeAddress(t, recipientKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 1000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "state", "ynx-abci-state.json")
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := NewSignedTransfer(senderKey, migration.Network.ChainID, recipient, 125, 1)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	freshInfo, err := app.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil || freshInfo.LastBlockHeight != 0 || len(freshInfo.LastBlockAppHash) != 0 {
		t.Fatalf("fresh persistent ABCI app did not request InitChain: response=%+v err=%v", freshInfo, err)
	}
	initResponse, err := app.InitChain(ctx, &abcitypes.RequestInitChain{ChainId: "ynx_6423-1", InitialHeight: int64(migration.Height) + 1})
	if err != nil || !bytes.Equal(initResponse.AppHash, mustHash(t, migration.StateHash)) {
		t.Fatalf("persistent ABCI InitChain failed: response=%+v err=%v", initResponse, err)
	}
	check, err := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: payload})
	if err != nil || check.Code != abcitypes.CodeTypeOK || len(check.Data) == 0 {
		t.Fatalf("valid signed transfer failed CheckTx: response=%+v err=%v", check, err)
	}
	duplicateProposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: int64(migration.Height) + 1, Txs: [][]byte{payload, payload}})
	if err != nil || duplicateProposal.Status != abcitypes.ResponseProcessProposal_REJECT {
		t.Fatalf("duplicate nonce proposal was not rejected: response=%+v err=%v", duplicateProposal, err)
	}
	prepared, err := app.PrepareProposal(ctx, &abcitypes.RequestPrepareProposal{Height: int64(migration.Height) + 1, MaxTxBytes: 1 << 20, Txs: [][]byte{payload, payload}})
	if err != nil || len(prepared.Txs) != 1 {
		t.Fatalf("proposal preparation did not retain exactly one valid nonce: response=%+v err=%v", prepared, err)
	}
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: int64(migration.Height) + 1, Txs: prepared.Txs})
	if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != abcitypes.CodeTypeOK {
		t.Fatalf("signed transfer finalization failed: response=%+v err=%v", finalized, err)
	}
	if bytes.Equal(finalized.AppHash, mustHash(t, migration.StateHash)) {
		t.Fatal("signed transfer did not change the application hash")
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	assertConsensusAccount(t, app, sender, 874, 1)
	assertConsensusAccount(t, app, recipient, 125, 0)
	if info, err := os.Stat(statePath); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("durable state is missing or not mode 0600: info=%v err=%v", info, err)
	}

	restarted, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	info, err := restarted.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil || info.LastBlockHeight != int64(migration.Height)+1 || !bytes.Equal(info.LastBlockAppHash, finalized.AppHash) {
		t.Fatalf("restarted ABCI state mismatch: response=%+v err=%v", info, err)
	}
	assertConsensusAccount(t, restarted, sender, 874, 1)
	assertConsensusAccount(t, restarted, recipient, 125, 0)
	replay, err := restarted.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: payload})
	if err != nil || replay.Code != CodeInvalidNonce {
		t.Fatalf("committed nonce replay was not rejected: response=%+v err=%v", replay, err)
	}
	emptyHeight := int64(migration.Height) + 2
	emptyBlock, err := restarted.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: emptyHeight})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(emptyBlock.AppHash, finalized.AppHash) {
		t.Fatal("empty block changed committed application state hash")
	}
	if _, err := restarted.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	restartedAgain, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	info, err = restartedAgain.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil || info.LastBlockHeight != emptyHeight || !bytes.Equal(info.LastBlockAppHash, finalized.AppHash) {
		t.Fatalf("empty block height was not durably restored: response=%+v err=%v", info, err)
	}

	tamperedPath := filepath.Join(t.TempDir(), "tampered-state.json")
	storedPayload, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var tamperedState CommittedState
	if err := json.Unmarshal(storedPayload, &tamperedState); err != nil {
		t.Fatal(err)
	}
	tamperedState.Accounts[0].Balance++
	tamperedPayload, err := json.Marshal(tamperedState)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tamperedPath, tamperedPayload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPersistentApplication(migration, tamperedPath); err == nil {
		t.Fatal("tampered durable application state was accepted")
	}
}

func TestApplicationDoesNotAdvanceWhenDurableCommitFails(t *testing.T) {
	senderKey := deterministicPrivateKey(21)
	recipient := mustNativeAddress(t, deterministicPrivateKey(22))
	sender := mustNativeAddress(t, senderKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	blockedParent := filepath.Join(t.TempDir(), "state-parent")
	statePath := filepath.Join(blockedParent, "state.json")
	if err := os.MkdirAll(blockedParent, 0o700); err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(blockedParent); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(blockedParent, []byte("block parent creation"), 0o600); err != nil {
		t.Fatal(err)
	}
	tx, err := NewSignedTransfer(senderKey, 6423, recipient, 10, 1)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	height := int64(migration.Height) + 1
	if _, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height, Txs: [][]byte{payload}}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err == nil {
		t.Fatal("ABCI commit advanced despite a durable-state write failure")
	}
	info, err := app.Info(context.Background(), &abcitypes.RequestInfo{})
	if err != nil || info.LastBlockHeight != 0 || len(info.LastBlockAppHash) != 0 {
		t.Fatalf("failed durable commit advanced in-memory state: response=%+v err=%v", info, err)
	}
}

func deterministicPrivateKey(marker byte) *secp256k1.PrivateKey {
	seed := make([]byte, 32)
	seed[31] = marker
	return secp256k1.PrivKeyFromBytes(seed)
}

func mustNativeAddress(t *testing.T, key *secp256k1.PrivateKey) string {
	t.Helper()
	address, err := NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	return address
}

func assertConsensusAccount(t *testing.T, app *Application, address string, balance int64, nonce uint64) {
	t.Helper()
	response, err := app.Query(context.Background(), &abcitypes.RequestQuery{Path: "/accounts/" + address})
	if err != nil || response.Code != abcitypes.CodeTypeOK {
		t.Fatalf("query account %s failed: response=%+v err=%v", address, response, err)
	}
	var account chain.ConsensusAccount
	if err := json.Unmarshal(response.Value, &account); err != nil {
		t.Fatal(err)
	}
	if account.Balance != balance || account.Nonce != nonce {
		t.Fatalf("unexpected account %s: %+v", address, account)
	}
}
