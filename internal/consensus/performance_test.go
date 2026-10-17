package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type performanceSamples []time.Duration

func (s performanceSamples) summary() map[string]any {
	sorted := append(performanceSamples(nil), s...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	var total time.Duration
	for _, d := range s {
		total += d
	}
	percentile := func(p float64) float64 {
		return float64(sorted[int(math.Ceil(p*float64(len(sorted))))-1]) / float64(time.Millisecond)
	}
	return map[string]any{"samples": len(s), "total_ms": float64(total) / float64(time.Millisecond), "p50_ms": percentile(.50), "p95_ms": percentile(.95), "p99_ms": percentile(.99)}
}

// TestABCITransferPerformance is an opt-in, bounded application-stage probe.
// It runs real signatures, proposals, execution, fsync commits and restart checks.
// It has no networking, mempool, consensus voting or finality measurement.
func TestABCITransferPerformance(t *testing.T) {
	if os.Getenv("YNX_CHAIN_PERF") != "1" {
		t.Skip("set YNX_CHAIN_PERF=1 for the bounded local ABCI probe")
	}
	const accounts = 256
	batch, blocks := 64, 16
	if os.Getenv("YNX_CHAIN_PERF_BLOCKS") == "32" {
		batch, blocks = 32, 32
	} else if value := os.Getenv("YNX_CHAIN_PERF_BLOCKS"); value != "" && value != "16" {
		t.Fatal("bounded benchmark supports 16 or 32 blocks only")
	}
	layout := os.Getenv("YNX_CHAIN_PERF_LAYOUT")
	constructor := NewPersistentApplication
	phaseCount := 8
	if layout == "snapshot-journal" {
		constructor = NewJournaledApplication
		phaseCount = 7
	} else if layout != "" && layout != "atomic-json" {
		t.Fatal("unsupported benchmark storage layout")
	}
	if layout == "" {
		layout = "atomic-json"
	}
	root := os.Getenv("YNX_CHAIN_PERF_DIR")
	if root == "" {
		root = t.TempDir()
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	runDir, err := os.MkdirTemp(root, "abci-run-")
	if err != nil {
		t.Fatal(err)
	}
	keys := make([]*secp256k1.PrivateKey, accounts)
	addresses := make([]string, accounts)
	for i := range keys {
		seed := sha256.Sum256([]byte(fmt.Sprintf("YNX_LOCAL_PERFORMANCE_TEST_ONLY_%d", i)))
		keys[i] = secp256k1.PrivKeyFromBytes(seed[:])
		addresses[i] = mustNativeAddress(t, keys[i])
	}
	// Reuse exactly the same isolated migration across before/after runs so
	// app hashes and traceable lots can be compared byte for byte.
	migrationPath := filepath.Join(root, "local-performance-migration.json")
	var migration chain.ConsensusMigrationState
	payload, err := os.ReadFile(migrationPath)
	if os.IsNotExist(err) {
		devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
		for _, address := range addresses {
			if _, err := devnet.Faucet(address, 10000); err != nil {
				t.Fatal(err)
			}
		}
		devnet.ProduceBlock()
		migration, err = devnet.ExportConsensusMigrationState()
		if err != nil {
			t.Fatal(err)
		}
		payload, err = json.Marshal(migration)
		if err != nil {
			t.Fatal(err)
		}
		file, err := os.OpenFile(migrationPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			t.Fatal(err)
		}
		_, writeErr := file.Write(payload)
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			t.Fatalf("write migration: %v; close: %v", writeErr, closeErr)
		}
	} else if err != nil {
		t.Fatal(err)
	} else if err := json.Unmarshal(payload, &migration); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(runDir, "state.json")
	app, err := constructor(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	storageProbe := os.Getenv("YNX_CHAIN_PERF_STORAGE_PROBE") == "1"
	storageSamples := []map[string]any{}
	var peakStorageBytes int64
	sampleStorage := func(stage string) {
		if !storageProbe {
			return
		}
		var logical, accounted int64
		physicalKnown := true
		entries, err := os.ReadDir(runDir)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if !entry.Type().IsRegular() {
				t.Fatal("unexpected probe artifact")
			}
			info, err := entry.Info()
			if err != nil {
				t.Fatal(err)
			}
			logical += info.Size()
			allocated := info.Size()
			meta := reflect.ValueOf(info.Sys())
			if meta.IsValid() && meta.Kind() == reflect.Pointer {
				meta = meta.Elem()
			}
			if meta.IsValid() && meta.Kind() == reflect.Struct {
				blocks := meta.FieldByName("Blocks")
				if blocks.IsValid() && blocks.CanInt() {
					if n := blocks.Int() * 512; n > allocated {
						allocated = n
					}
				} else {
					physicalKnown = false
				}
			} else {
				physicalKnown = false
			}
			accounted += allocated
		}
		if accounted > peakStorageBytes {
			peakStorageBytes = accounted
		}
		storageSamples = append(storageSamples, map[string]any{"stage": stage, "logical_bytes": logical, "accounted_bytes": accounted, "physical_blocks_available": physicalKnown, "files": len(entries)})
	}
	if storageProbe && app.journal != nil {
		app.journal.fault = func(stage string) error {
			if stage == "compaction_synced" {
				sampleStorage(stage)
			}
			return nil
		}
	}
	sampleStorage("setup")
	// Transactions use independent senders within a block: CheckTx currently
	// checks committed nonce, not speculative mempool nonce.
	work := make([][][]byte, blocks)
	signStart := time.Now()
	for b := range work {
		for i := 0; i < batch; i++ {
			tx, err := NewSignedTransfer(keys[i], migration.Network.ChainID, addresses[batch+i], 1, uint64(b+1))
			if err != nil {
				t.Fatal(err)
			}
			raw, err := EncodeSignedTransaction(tx)
			if err != nil {
				t.Fatal(err)
			}
			work[b] = append(work[b], raw)
		}
	}
	signDuration := time.Since(signStart)
	ctx := context.Background()
	if _, err := app.InitChain(ctx, &abcitypes.RequestInitChain{ChainId: fmt.Sprintf("ynx_%d-1", migration.Network.ChainID), InitialHeight: int64(migration.Height) + 1}); err != nil {
		t.Fatal(err)
	}
	stages := map[string]performanceSamples{}
	commitStages := map[string]performanceSamples{}
	var snapshotBytesWritten int
	accepted, executed := 0, 0
	hashes := make([]string, 0, blocks)
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	start := time.Now()
	for b, txs := range work {
		height := int64(migration.Height) + int64(b) + 1
		blockTime := time.Unix(1802736000+int64(b), 0).UTC()
		for _, raw := range txs {
			ts := time.Now()
			check, err := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: raw})
			stages["check_tx"] = append(stages["check_tx"], time.Since(ts))
			if err != nil || check.Code != 0 {
				t.Fatalf("CheckTx: %v %+v", err, check)
			}
			accepted++
		}
		ts := time.Now()
		prepared, err := app.PrepareProposal(ctx, &abcitypes.RequestPrepareProposal{Height: height, Time: blockTime, MaxTxBytes: 1 << 20, Txs: txs})
		stages["prepare_proposal"] = append(stages["prepare_proposal"], time.Since(ts))
		if err != nil || len(prepared.Txs) != len(txs) {
			t.Fatalf("PrepareProposal: %v", err)
		}
		ts = time.Now()
		processed, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: prepared.Txs})
		stages["process_proposal"] = append(stages["process_proposal"], time.Since(ts))
		if err != nil || processed.Status != abcitypes.ResponseProcessProposal_ACCEPT {
			t.Fatalf("ProcessProposal: %v %+v", err, processed)
		}
		ts = time.Now()
		finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: prepared.Txs})
		stages["finalize_block"] = append(stages["finalize_block"], time.Since(ts))
		if err != nil || len(finalized.TxResults) != len(txs) {
			t.Fatalf("FinalizeBlock: %v", err)
		}
		for _, result := range finalized.TxResults {
			if result.Code != 0 {
				t.Fatalf("failed execution: %+v", result)
			}
			executed++
		}
		hashes = append(hashes, hex.EncodeToString(finalized.AppHash))
		app.commitTimings = &commitTimings{}
		if storageProbe {
			app.commitTimings.onStage = func(stage string) {
				if stage == "file_sync" {
					sampleStorage(stage)
				}
			}
		}
		ts = time.Now()
		if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		stages["durable_commit"] = append(stages["durable_commit"], time.Since(ts))
		for name, duration := range app.commitTimings.stages {
			commitStages[name] = append(commitStages[name], duration)
		}
		snapshotBytesWritten += app.commitTimings.bytes
		sampleStorage("after_commit")
	}
	elapsed := time.Since(start)
	runtime.ReadMemStats(&after)
	restarted, err := constructor(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	info, err := restarted.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil || info.LastBlockHeight != int64(migration.Height)+int64(blocks) || hex.EncodeToString(info.LastBlockAppHash) != hashes[len(hashes)-1] {
		t.Fatalf("restart mismatch: %v %+v", err, info)
	}
	for i := 0; i < batch; i++ {
		assertConsensusAccount(t, restarted, addresses[i], int64(10000-blocks*2), uint64(blocks))
		assertConsensusAccount(t, restarted, addresses[batch+i], int64(10000+blocks), 0)
	}
	if len(restarted.committed.FeeEvents) != batch*blocks {
		t.Fatal("fee audit count mismatch")
	}
	replay, err := restarted.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: work[blocks-1][0]})
	if err != nil || replay.Code != CodeInvalidNonce {
		t.Fatalf("replay accepted after restart: %v %+v", err, replay)
	}
	stored, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	storageBytes := len(stored)
	journalCompactions := 0
	if app.journal != nil {
		journalCompactions = app.journal.compactions
		stored, err = encodeCommittedStateJSON(restarted.committed)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(runDir, "canonical-state.json"), stored, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	decoded, err := json.Marshal(app.committed)
	if err != nil {
		t.Fatal(err)
	}
	decodedRestarted, _ := json.Marshal(restarted.committed)
	if !bytes.Equal(decoded, decodedRestarted) {
		t.Fatal("complete committed state changed across restart")
	}
	summaries := map[string]any{}
	for name, samples := range stages {
		summaries[name] = samples.summary()
	}
	commitSummaries := map[string]any{}
	for name, samples := range commitStages {
		if len(samples) != blocks {
			t.Fatalf("missing commit phase %s samples: %d", name, len(samples))
		}
		commitSummaries[name] = samples.summary()
	}
	if len(commitStages) != phaseCount {
		t.Fatalf("expected %d durable commit phases, got %d", phaseCount, len(commitStages))
	}
	report := map[string]any{
		"storage_probe_enabled": storageProbe, "peak_owned_store_accounted_bytes": peakStorageBytes, "storage_samples": storageSamples,
		"native_signature_cache": app.nativeVerification.stats(),
		"storage_layout":         layout, "storage_bytes": storageBytes, "journal_compactions": journalCompactions,
		"journal_retention_target_bytes": snapshotJournalTargetBytes,
		"schema":                         2, "measurement": "single_process_abci_application_stages_not_network_tps_or_finality",
		"label": os.Getenv("YNX_CHAIN_PERF_LABEL"), "commit_stages": commitSummaries, "snapshot_bytes_written": snapshotBytesWritten,
		"go_version": runtime.Version(), "goos": runtime.GOOS, "goarch": runtime.GOARCH, "gomaxprocs": runtime.GOMAXPROCS(0),
		"accounts_seeded": accounts, "senders": batch, "txs_per_block": batch, "blocks": blocks, "offered": batch * blocks,
		"accepted": accepted, "executed_code_zero": executed, "failed": 0, "rejected": 0, "persisted_fee_events": len(restarted.committed.FeeEvents),
		"application_pipeline_seconds": elapsed.Seconds(), "application_pipeline_tx_per_second": float64(executed) / elapsed.Seconds(),
		"offline_signing_seconds_excluded": signDuration.Seconds(), "stages": summaries,
		"allocated_bytes": after.TotalAlloc - before.TotalAlloc, "mallocs": after.Mallocs - before.Mallocs, "gc_cycles": after.NumGC - before.NumGC,
		"snapshot_bytes": len(stored), "migration_hash": migration.StateHash, "block_app_hashes": hashes,
		"rpc_submit_tps": nil, "mempool_accept_tps": nil, "consensus_inclusion_tps": nil, "inclusion_latency": nil, "finality_latency": nil,
		"restart_full_state_equal": true, "replay_rejected_after_restart": true,
	}
	result, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runDir, "result.json"), append(result, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Logf("report=%s pipeline_tx_per_second=%.2f accepted=%d executed=%d duration=%s", filepath.Join(runDir, "result.json"), float64(executed)/elapsed.Seconds(), accepted, executed, elapsed)
}
