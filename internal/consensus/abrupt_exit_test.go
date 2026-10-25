package consensus

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// The child exits without running deferred cleanup. Only the committed file
// can carry state into the fresh application opened by the parent process.
func TestApplicationAbruptExitRecovery(t *testing.T) {
	if phase := os.Getenv("YNX_ABCI_ABRUPT_PHASE"); phase != "" {
		runAbruptExitChild(t, os.Getenv("YNX_ABCI_ABRUPT_DIR"), phase)
		return
	}
	for _, phase := range []string{"after_finalize", "after_durable_commit"} {
		t.Run(phase, func(t *testing.T) {
			dir := t.TempDir()
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, os.Args[0], "-test.run", "^TestApplicationAbruptExitRecovery$", "-test.count=1")
			child.Env = append(os.Environ(), "GOMAXPROCS=1", "YNX_ABCI_ABRUPT_DIR="+dir, "YNX_ABCI_ABRUPT_PHASE="+phase)
			output, err := child.CombinedOutput()
			if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 17 {
				t.Fatalf("child did not reach abrupt exit: %v %s", err, output)
			}
			var migration chain.ConsensusMigrationState
			raw, err := os.ReadFile(filepath.Join(dir, "migration.json"))
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(raw, &migration); err != nil {
				t.Fatal(err)
			}
			restarted, err := NewPersistentApplication(migration, filepath.Join(dir, "state.json"))
			if err != nil {
				t.Fatal(err)
			}
			sender := mustNativeAddress(t, deterministicPrivateKey(211))
			recipient := mustNativeAddress(t, deterministicPrivateKey(212))
			wantHeight := int64(migration.Height) + 1
			wantBalance, wantNonce, wantFees := int64(100), uint64(0), 0
			if phase == "after_durable_commit" {
				wantHeight++
				wantBalance, wantNonce, wantFees = 96, 1, 1
				assertConsensusAccount(t, restarted, recipient, 3, 0)
			}
			assertConsensusAccount(t, restarted, sender, wantBalance, wantNonce)
			if restarted.committed.Height != wantHeight || len(restarted.committed.FeeEvents) != wantFees {
				t.Fatalf("recovery crossed commit boundary: height=%d fees=%d", restarted.committed.Height, len(restarted.committed.FeeEvents))
			}
			tx, err := NewSignedTransfer(deterministicPrivateKey(211), 6423, recipient, 3, 1)
			if err != nil {
				t.Fatal(err)
			}
			payload, err := EncodeSignedTransaction(tx)
			if err != nil {
				t.Fatal(err)
			}
			check, err := restarted.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: payload})
			if err != nil {
				t.Fatal(err)
			}
			wantCode := uint32(0)
			if phase == "after_durable_commit" {
				wantCode = CodeInvalidNonce
			}
			if check.Code != wantCode {
				t.Fatalf("recovery replay decision=%d want=%d", check.Code, wantCode)
			}
		})
	}
}

func runAbruptExitChild(t *testing.T, dir, phase string) {
	t.Helper()
	if dir == "" || (phase != "after_finalize" && phase != "after_durable_commit") {
		t.Fatal("invalid local crash probe input")
	}
	key := deterministicPrivateKey(211)
	sender := mustNativeAddress(t, key)
	recipient := mustNativeAddress(t, deterministicPrivateKey(212))
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(migration)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "migration.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplication(migration, filepath.Join(dir, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	height := int64(migration.Height) + 1
	if _, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000, 0)}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	tx, err := NewSignedTransfer(key, 6423, recipient, 3, 1)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height + 1, Time: time.Unix(1802736001, 0), Txs: [][]byte{payload}})
	if err != nil || finalized.TxResults[0].Code != 0 {
		t.Fatalf("finalize: %+v %v", finalized, err)
	}
	if phase == "after_durable_commit" {
		if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	os.Exit(17)
}
