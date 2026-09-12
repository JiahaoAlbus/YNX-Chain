package consensus

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestBFTContinuesBalancesAndRetainsVerifiedNativeOriginAfterRestart(t *testing.T) {
	key := deterministicPrivateKey(235)
	sender := mustNativeAddress(t, key)
	recipient := mustNativeAddress(t, deterministicPrivateKey(236))
	native := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := native.Faucet(sender, 100); err != nil {
		t.Fatal(err)
	}
	intent, err := native.CreatePayIntentWithIdempotency("original-merchant", 7, "", "origin-existing-intent")
	if err != nil {
		t.Fatal(err)
	}
	native.ProduceBlock()
	dir := filepath.Join(t.TempDir(), "origin")
	migration, err := native.SaveConsensusMigrationBundle(dir)
	if err != nil {
		t.Fatal(err)
	}
	_, origin, err := chain.LoadConsensusMigrationBundle(dir)
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "state.json")
	if _, err := NewPersistentApplication(migration, statePath); err == nil {
		t.Fatal("full migration started without native archive")
	}
	app, err := NewPersistentApplicationWithNativeOrigin(migration, statePath, origin)
	if err != nil {
		t.Fatal(err)
	}
	rawtx, err := NewSignedTransfer(key, 6423, recipient, 10, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodeSignedTransaction(rawtx)
	if err != nil {
		t.Fatal(err)
	}
	result, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: int64(migration.Height) + 1, Time: time.Unix(1789215000, 0).UTC(), Txs: [][]byte{raw}})
	if err != nil || result.TxResults[0].Code != 0 {
		t.Fatalf("continued transfer failed: %v %+v", err, result)
	}
	if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	restoredOrigin, err := chain.LoadNativeMigrationArchive(filepath.Join(dir, "native-origin.json"), migration)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := NewPersistentApplicationWithNativeOrigin(migration, statePath, restoredOrigin)
	if err != nil {
		t.Fatal(err)
	}
	index, ok := accountIndex(restarted.committed.Accounts, sender)
	if !ok || restarted.committed.Accounts[index].Balance != 89 || restarted.committed.Accounts[index].Nonce != 1 {
		t.Fatal("continued balance/nonce lost on restart")
	}
	response, err := restarted.Query(context.Background(), &abcitypes.RequestQuery{Path: "/native-origin/payIntents/" + intent.ID})
	if err != nil || response.Code != 0 {
		t.Fatalf("old native record not readable: %v %+v", err, response)
	}
	var record chain.NativeOriginRecord
	if err := json.Unmarshal(response.Value, &record); err != nil {
		t.Fatal(err)
	}
	expected, _ := json.Marshal(intent)
	if string(record.Record) != string(expected) || record.SourceArchiveRoot != migration.SourceArchiveRoot {
		t.Fatal("old record was modified or lost source binding")
	}
	if len(restarted.committed.PayIntents) != 0 {
		t.Fatal("unsigned native record was fabricated into a signed BFT intent")
	}
}
