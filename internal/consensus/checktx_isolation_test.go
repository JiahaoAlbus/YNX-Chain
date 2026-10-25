package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func assertCheckTxMatchesIsolatedExecution(t *testing.T, app *Application, payload []byte) {
	t.Helper()
	before, err := json.Marshal(app.committed)
	if err != nil {
		t.Fatal(err)
	}
	_, execution, executionErr := app.applyTransaction(app.cloneExecutionState(), payload, 0, time.Time{})
	want := &abcitypes.ResponseCheckTx{}
	if executionErr != nil {
		want.Code, want.Log = transactionCode(executionErr), executionErr.Error()
	} else {
		want.Data, want.Info = []byte(execution.resultHash(payload)), execution.typeName
		want.GasWanted, want.GasUsed = execution.gasUsed(), execution.gasUsed()
	}
	for i := 0; i < 2; i++ {
		got, err := app.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: payload})
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("CheckTx changed isolated execution result: got=%+v want=%+v err=%v", got, want, err)
		}
		after, err := json.Marshal(app.committed)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("CheckTx mutated committed records", err)
		}
	}
}

func TestCheckTxPreservesCommittedStateAndSpareCapacity(t *testing.T) {
	key := deterministicPrivateKey(91)
	sender := mustNativeAddress(t, key)
	recipient := mustNativeAddress(t, deterministicPrivateKey(92))
	for _, lots := range []int64{2, 3, 100} {
		for _, feeTarget := range []string{"ynx_validator_fee", sender, recipient} {
			accounts := make([]chain.ConsensusAccount, 8)
			accounts[0] = chain.ConsensusAccount{Address: sender, Balance: 100, Lots: map[string]int64{"lot": lots}}
			accounts[1] = chain.ConsensusAccount{Address: "capacity guard", Balance: 17, Lots: map[string]int64{"guard": 17}}
			fees := make([]BFTFeeEvent, 8)
			fees[0], fees[1] = BFTFeeEvent{ID: "existing"}, BFTFeeEvent{ID: "capacity guard"}
			app := &Application{migration: chain.ConsensusMigrationState{Network: chain.DefaultNetworkConfig("testnet")}, feeRecipient: feeTarget, committed: CommittedState{Accounts: accounts[:1], FeeEvents: fees[:1]}}
			beforeAccounts, _ := json.Marshal(accounts)
			beforeFees, _ := json.Marshal(fees)
			tx, err := NewSignedTransfer(key, 6423, recipient, 3, 1)
			if err != nil {
				t.Fatal(err)
			}
			payload, err := EncodeSignedTransaction(tx)
			if err != nil {
				t.Fatal(err)
			}
			assertCheckTxMatchesIsolatedExecution(t, app, payload)
			assertCheckTxMatchesIsolatedExecution(t, app, []byte(`{"type":"invalid"}`))
			var wg sync.WaitGroup
			for i := 0; i < 8; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					_, _ = app.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: payload})
				}()
			}
			wg.Wait()
			afterAccounts, _ := json.Marshal(accounts)
			afterFees, _ := json.Marshal(fees)
			if !bytes.Equal(afterAccounts, beforeAccounts) || !bytes.Equal(afterFees, beforeFees) {
				t.Fatalf("CheckTx changed shared account/history backing: lots=%d fee=%s", lots, feeTarget)
			}
		}
	}
}

func BenchmarkCheckTxTransfer(b *testing.B) {
	root := os.Getenv("YNX_CHAIN_CHECKTX_DIR")
	if root == "" {
		b.Skip("set YNX_CHAIN_CHECKTX_DIR to existing isolated performance fixture directory")
	}
	payload, err := os.ReadFile(filepath.Join(root, "local-performance-migration.json"))
	if err != nil {
		b.Fatal(err)
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(payload, &migration); err != nil {
		b.Fatal(err)
	}
	app, err := NewApplication(migration)
	if err != nil {
		b.Fatal(err)
	}
	app.committed, err = loadCommittedState(filepath.Join(root, "abci-run-1234288681/state.json"), migration)
	if err != nil || len(app.committed.FeeEvents) != 1024 {
		b.Fatal("real 1024-transfer fixture required", err)
	}
	senderSeed := sha256.Sum256([]byte("YNX_LOCAL_PERFORMANCE_TEST_ONLY_0"))
	recipientSeed := sha256.Sum256([]byte("YNX_LOCAL_PERFORMANCE_TEST_ONLY_64"))
	key := secp256k1.PrivKeyFromBytes(senderSeed[:])
	recipient, err := NativeAddress(secp256k1.PrivKeyFromBytes(recipientSeed[:]).PubKey().SerializeCompressed())
	if err != nil {
		b.Fatal(err)
	}
	sender, err := NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		b.Fatal(err)
	}
	index, ok := accountIndex(app.committed.Accounts, sender)
	if !ok {
		b.Fatal("fixture sender missing")
	}
	tx, err := NewSignedTransfer(key, migration.Network.ChainID, recipient, 1, app.committed.Accounts[index].Nonce+1)
	if err != nil {
		b.Fatal(err)
	}
	raw, err := EncodeSignedTransaction(tx)
	if err != nil {
		b.Fatal(err)
	}
	before, err := json.Marshal(app.committed)
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		response, err := app.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: raw})
		if err != nil || response.Code != 0 {
			b.Fatal("CheckTx rejected valid signed transfer", response, err)
		}
	}
	b.StopTimer()
	after, err := json.Marshal(app.committed)
	if err != nil || !bytes.Equal(before, after) {
		b.Fatal("benchmark mutated committed state", err)
	}
}
