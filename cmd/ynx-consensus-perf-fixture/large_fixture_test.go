package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// Explicit, bounded fixture preparation/admission probe. No node, network,
// proposal, FinalizeBlock or Commit is started; CheckTx success is not final TPS.
func TestLargeEphemeralFixturePreparation(t *testing.T) {
	if os.Getenv("YNX_CHAIN_LARGE_FIXTURE") != "1" {
		t.Skip("set YNX_CHAIN_LARGE_FIXTURE=1 for1024-sender local fixture probe")
	}
	parent := os.Getenv("YNX_CHAIN_FIXTURE_PROBE_DIR")
	if parent == "" {
		parent = t.TempDir()
	}
	root, err := os.MkdirTemp(parent, "large-fixture-")
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "network")
	started := time.Now()
	if err := run(dir, 1024, true, 31656, 31757, 31858); err != nil {
		t.Fatal(err)
	}
	preparation := time.Since(started)
	var manifest consensus.EphemeralNetworkManifest
	data, err := os.ReadFile(filepath.Join(dir, "network-manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	var migration chain.ConsensusMigrationState
	data, err = os.ReadFile(manifest.MigrationPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &migration); err != nil {
		t.Fatal(err)
	}
	if err := migration.Validate(); err != nil {
		t.Fatal(err)
	}
	var workload struct {
		Transactions [][]byte `json:"transactions"`
	}
	data, err = os.ReadFile(filepath.Join(dir, "transactions.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &workload); err != nil {
		t.Fatal(err)
	}
	if len(workload.Transactions) != 1024 {
		t.Fatal("wrong bounded transaction count")
	}
	app, err := consensus.NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	senders := map[string]bool{}
	checkStarted := time.Now()
	for _, raw := range workload.Transactions {
		tx, err := consensus.DecodeSignedTransaction(raw)
		if err != nil || tx.Verify(migration.Network.ChainID) != nil || tx.Nonce != 1 || tx.Amount != 1 || tx.Fee != 1 || senders[tx.From] {
			t.Fatal("invalid or duplicate independent fixture sender", err)
		}
		senders[tx.From] = true
		response, err := app.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: raw})
		if err != nil || response.Code != 0 {
			t.Fatalf("real signed fixture admission failed: %+v %v", response, err)
		}
	}
	checkElapsed := time.Since(checkStarted)
	var totalBytes int64
	if err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type().IsRegular() {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			totalBytes += info.Size()
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	report := map[string]any{"schema": 1, "measurement": "1024_independent_local_fixture_preparation_and_CheckTx_not_business_commit_TPS", "network": dir, "transactions": 1024, "uniqueSenders": len(senders), "migrationHash": migration.StateHash, "transactionsFileSHA256": hex.EncodeToString(digest[:]), "preparationSeconds": preparation.Seconds(), "checkAndSignatureValidationSeconds": checkElapsed.Seconds(), "fixtureLogicalBytes": totalBytes, "nodeProcessesStarted": 0, "finalizeBlockTransactions": 0, "committedTransactions": 0, "effectiveBusinessTPS": nil}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	result := filepath.Join(root, "result.json")
	if err := os.WriteFile(result, append(payload, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Logf("report=%s preparation=%s signatureAndCheckTx=%s logicalBytes=%d", result, preparation, checkElapsed, totalBytes)
}
