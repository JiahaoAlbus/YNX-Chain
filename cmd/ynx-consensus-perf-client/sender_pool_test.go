package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func senderFixture(t *testing.T, counts ...int) (string, []byte, consensus.EphemeralNetworkManifest, chain.ConsensusMigrationState, []cmttypes.Tx) {
	t.Helper()
	validators := make([]chain.Validator, 4)
	for i := range validators {
		validators[i] = chain.Validator{Address: fmt.Sprintf("ynx_sender_test_%d", i), Moniker: fmt.Sprintf("sender-%d", i), VotingPower: 1, Active: true}
	}
	devnet := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), validators)
	var bundle consensus.EphemeralSenderBundle
	bundle.Purpose = consensus.EphemeralSenderPurpose
	var txs []cmttypes.Tx
	to, _ := consensus.NativeAddress(secp256k1.PrivKeyFromBytes([]byte{33}).PubKey().SerializeCompressed())
	count := 3
	if len(counts) > 0 {
		count = counts[0]
	}
	for i := 0; i < count; i++ {
		key, err := secp256k1.GeneratePrivateKey()
		if err != nil {
			t.Fatal(err)
		}
		address, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
		if _, err := devnet.Faucet(address, 10000); err != nil {
			t.Fatal(err)
		}
		tx, err := consensus.NewSignedTransfer(key, 6423, to, 1, 1)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := consensus.EncodeSignedTransaction(tx)
		if err != nil {
			t.Fatal(err)
		}
		txs = append(txs, raw)
		bundle.Senders = append(bundle.Senders, consensus.EphemeralSenderSecret{Address: address, PrivateKey: hex.EncodeToString(key.Serialize())})
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "network")
	m, err := consensus.GenerateEphemeralNetwork(migration, consensus.EphemeralNetworkOptions{RootDir: root, BaseP2P: 31656, BaseRPC: 31757, BaseABCI: 31858})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "network-manifest.json")
	manifestRaw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	migration, err = readMigration(m)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(manifestRaw)
	bundle.ManifestSHA256 = hex.EncodeToString(sum[:])
	bundle.MigrationStateHash, bundle.GenesisHash = m.MigrationStateHash, m.GenesisHash
	raw, err := json.Marshal(bundle)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, consensus.EphemeralSenderFile), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	input, err := json.Marshal(struct {
		Transactions []cmttypes.Tx `json:"transactions"`
	}{txs})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "transactions.json"), input, 0o600); err != nil {
		t.Fatal(err)
	}
	return path, manifestRaw, m, migration, txs
}

// Only local execution/durability is real here. Quorum fields below are explicit
// unit-test inputs to the driver gate, not evidence of any network consensus.
func gateResult(raw cmttypes.Tx, height int64) transactionResult {
	zero := uint32(0)
	now := time.Now()
	return transactionResult{Hash: fmt.Sprintf("%X", raw.Hash()), Status: "confirmed", CheckTxIdentityVerified: true, CheckTxCode: &zero, ExecutionCode: &zero, QuorumVerified: true, TransactionProofVerified: true, DurableStateVerified: true, ConfirmedObservedAt: &now, Height: height, DurableStateHeight: height, DurableSnapshotSHA256: "unit-gate-placeholder"}
}

func TestSenderRoundsRealSignaturesExecutionPersistenceAndRestart(t *testing.T) {
	path, manifestRaw, m, migration, txs := senderFixture(t)
	p, err := loadSenderPool(path, manifestRaw, m, migration, txs, 4)
	if err != nil {
		t.Fatal(err)
	}
	if err := claimSenderPool(path); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "state.json")
	app, err := consensus.NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	results := make([]transactionResult, 12)
	for i := range results {
		results[i].Status = "not_submitted"
	}
	calls := 0
	completed, err := runSenderRounds(context.Background(), 4, txs, p, results, func(batch []cmttypes.Tx, current []transactionResult) {
		calls++
		journal, err := os.ReadFile(filepath.Join(filepath.Dir(path), fmt.Sprintf("sender-round-%02d.signed.json", calls)))
		if err != nil {
			t.Fatal("submission preceded durable journal", err)
		}
		var saved struct {
			Round        int
			Transactions []cmttypes.Tx
		}
		if err := json.Unmarshal(journal, &saved); err != nil || saved.Round != calls || len(saved.Transactions) != len(batch) {
			t.Fatal("invalid recovery journal", err)
		}
		for i := range batch {
			if !bytes.Equal(saved.Transactions[i], batch[i]) {
				t.Fatal("journal does not match submitted payload")
			}
		}
		height := int64(migration.Height) + int64(calls)
		for _, raw := range batch {
			tx, err := consensus.DecodeSignedTransaction(raw)
			if err != nil || tx.Verify(6423) != nil || tx.Nonce != uint64(calls) {
				t.Fatal("nonce or signature differs", err)
			}
			check, err := app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw})
			if err != nil || check.Code != 0 {
				t.Fatal("valid next nonce rejected", err)
			}
		}
		rawBatch := make([][]byte, len(batch))
		for i := range batch {
			rawBatch[i] = batch[i]
		}
		r, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000+int64(calls), 0), Txs: rawBatch})
		if err != nil {
			t.Fatal(err)
		}
		for _, x := range r.TxResults {
			if x.Code != 0 {
				t.Fatal("execution failed")
			}
		}
		if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		for i, raw := range batch {
			persisted, err := verifyDurableExecution(statePath, migration, raw, height)
			if err != nil || persisted.Height != height {
				t.Fatal("missing actual durable result", err)
			}
			signed, decodeErr := base64.StdEncoding.DecodeString(current[i].SignedTransaction)
			if decodeErr != nil || !bytes.Equal(signed, raw) {
				t.Fatal("public recovery envelope lost")
			}
			current[i] = gateResult(raw, height)
		}
		app, err = consensus.NewPersistentApplication(migration, statePath)
		if err != nil {
			t.Fatal(err)
		}
		for _, raw := range batch {
			check, err := app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw})
			if err != nil || check.Code != consensus.CodeInvalidNonce {
				t.Fatal("restart lost replay fence", err)
			}
		}
	})
	if err != nil || completed != 4 || calls != 4 {
		t.Fatal("bounded rounds failed", completed, calls, err)
	}
	if err := claimSenderPool(path); err == nil {
		t.Fatal("completed fixture resumed")
	}
}

func TestSenderJournalFailurePreventsAllSubmission(t *testing.T) {
	path, raw, m, migration, txs := senderFixture(t)
	p, err := loadSenderPool(path, raw, m, migration, txs, 2)
	if err != nil {
		t.Fatal(err)
	}
	journal := filepath.Join(filepath.Dir(path), "sender-round-01.signed.json")
	if err := os.WriteFile(journal, []byte("preserve previous uncertain bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	_, err = runSenderRounds(context.Background(), 2, txs, p, make([]transactionResult, 6), func([]cmttypes.Tx, []transactionResult) { calls++ })
	if err == nil || calls != 0 || !p.stopped {
		t.Fatal("journal failure allowed submission")
	}
	raw, err = os.ReadFile(journal)
	if err != nil || string(raw) != "preserve previous uncertain bytes" {
		t.Fatal("existing journal overwritten")
	}
}

func TestSenderProcessExitRecoveryFence(t *testing.T) {
	if root := os.Getenv("YNX_TEST_SENDER_EXIT_ROOT"); root != "" {
		path := filepath.Join(root, "network-manifest.json")
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var m consensus.EphemeralNetworkManifest
		if err := strictJSON(raw, &m); err != nil {
			t.Fatal(err)
		}
		migration, err := readMigration(m)
		if err != nil {
			t.Fatal(err)
		}
		input, err := os.ReadFile(filepath.Join(root, "transactions.json"))
		if err != nil {
			t.Fatal(err)
		}
		txs, err := decodeTransactions(input)
		if err != nil {
			t.Fatal(err)
		}
		p, err := loadSenderPool(path, raw, m, migration, txs, 2)
		if err != nil {
			t.Fatal(err)
		}
		if err := claimSenderPool(path); err != nil {
			t.Fatal(err)
		}
		if err := p.persistRound(1, txs); err != nil {
			t.Fatal(err)
		}
		os.Exit(17) // no deferred cleanup; no RPC or business execution in this probe
	}
	path, _, _, _, txs := senderFixture(t)
	cmd := exec.Command(os.Args[0], "-test.run=^TestSenderProcessExitRecoveryFence$")
	cmd.Env = append(os.Environ(), "YNX_TEST_SENDER_EXIT_ROOT="+filepath.Dir(path))
	output, err := cmd.CombinedOutput()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 17 {
		t.Fatalf("abrupt child did not exit at expected fence: %v %s", err, output)
	}
	if err := claimSenderPool(path); err == nil {
		t.Fatal("abrupt driver was automatically resumable")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(path), "sender-round-01.signed.json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved struct {
		Round        int
		Transactions []cmttypes.Tx
	}
	if err := json.Unmarshal(raw, &saved); err != nil || saved.Round != 1 || len(saved.Transactions) != len(txs) {
		t.Fatal("abrupt exit lost recovery identity", err)
	}
	for i := range txs {
		if !bytes.Equal(txs[i], saved.Transactions[i]) {
			t.Fatal("recovery envelope changed")
		}
	}
}

func TestSenderRoundFailureNeverSignsOrSubmitsLaterNonce(t *testing.T) {
	for _, mode := range []string{"unknown", "timeout", "rejected", "wrong_hash", "missing_durable", "missing_quorum", "journal_unpublished", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			path, raw, m, migration, txs := senderFixture(t)
			p, err := loadSenderPool(path, raw, m, migration, txs, 3)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			results := make([]transactionResult, 9)
			for i := range results {
				results[i].Status = "not_submitted"
			}
			calls := 0
			completed, err := runSenderRounds(ctx, 3, txs, p, results, func(batch []cmttypes.Tx, current []transactionResult) {
				calls++
				for i, tx := range batch {
					current[i] = gateResult(tx, 2)
				}
				switch mode {
				case "unknown":
					current[1].Status = "submission_unknown"
				case "timeout":
					current[1].Status = "timeout"
				case "rejected":
					code := uint32(2)
					current[1].CheckTxCode = &code
				case "wrong_hash":
					current[1].Hash = "wrong"
				case "missing_durable":
					current[1].DurableStateVerified = false
				case "missing_quorum":
					current[1].QuorumVerified = false
				case "journal_unpublished":
					current[1].DurableStoreFormat = "snapshot-journal"
				case "cancel":
					cancel()
				}
			})
			if err == nil || calls != 1 || (mode != "cancel" && completed != 0) {
				t.Fatal("incomplete barrier advanced", completed, calls, err)
			}
			for _, tx := range p.templates {
				if tx.Nonce != 1 {
					t.Fatal("later nonce signed after failure")
				}
			}
			for _, r := range results[3:] {
				if r.Status != "not_submitted" || r.Hash != "" {
					t.Fatal("later round submitted")
				}
			}
			if _, err := p.advance(results[:3]); err == nil {
				t.Fatal("failed pool resumed")
			}
		})
	}
}

func TestSenderBundleBindingPermissionsAndExclusiveClaim(t *testing.T) {
	path, raw, m, migration, txs := senderFixture(t)
	secretPath := filepath.Join(filepath.Dir(path), consensus.EphemeralSenderFile)
	original, err := os.ReadFile(secretPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"purpose", "manifest", "genesis", "migration", "address", "key", "duplicate", "permissions", "symlink"} {
		t.Run(mode, func(t *testing.T) {
			var b consensus.EphemeralSenderBundle
			if err := json.Unmarshal(original, &b); err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "purpose":
				b.Purpose = "other"
			case "manifest":
				b.ManifestSHA256 = "other"
			case "genesis":
				b.GenesisHash = "other"
			case "migration":
				b.MigrationStateHash = "other"
			case "address":
				b.Senders[0].Address = "other"
			case "key":
				b.Senders[0].PrivateKey = "00"
			case "duplicate":
				b.Senders[1] = b.Senders[0]
			}
			mutated, _ := json.Marshal(b)
			if err := os.WriteFile(secretPath, mutated, 0o600); err != nil {
				t.Fatal(err)
			}
			if mode == "permissions" {
				if err := os.Chmod(secretPath, 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "symlink" {
				target := filepath.Join(t.TempDir(), "secret")
				if err := os.WriteFile(target, original, 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(secretPath); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, secretPath); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := loadSenderPool(path, raw, m, migration, txs, 3); err == nil {
				t.Fatal("unsafe bundle accepted")
			}
			if err := os.Remove(secretPath); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(secretPath, original, 0o600); err != nil {
				t.Fatal(err)
			}
		})
	}
	if err := claimSenderPool(path); err != nil {
		t.Fatal(err)
	}
	claimPath := filepath.Join(filepath.Dir(path), "sender-pool-run.claim")
	before, _ := os.ReadFile(claimPath)
	if err := claimSenderPool(path); err == nil {
		t.Fatal("uncertain previous run resumed")
	}
	after, _ := os.ReadFile(claimPath)
	if !bytes.Equal(before, after) {
		t.Fatal("claim replaced")
	}
}
