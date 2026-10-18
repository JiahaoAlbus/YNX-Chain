package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cmt "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// Explicit existing-CI application measurement. No BFT server, sockets, public
// endpoint, synthetic history events or padded checkpoint bytes are used.
func TestStreamingWorkloadActualFeeHistoryReadback(t *testing.T) {
	if os.Getenv("YNX_CHAIN_REAL_HISTORY") != "1" {
		t.Skip("explicit bounded real-history measurement not selected")
	}
	directory := os.Getenv("YNX_CHAIN_REAL_HISTORY_DIR")
	if directory == "" || !filepath.IsAbs(directory) {
		t.Fatal("new absolute evidence directory required")
	}
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	report := map[string]any{"schema": 1, "scope": "real_signed_application_pipeline_and_durable_readback_not_network_or_business_tps", "goVersion": runtime.Version(), "platform": runtime.GOOS + "/" + runtime.GOARCH, "numCPU": runtime.NumCPU(), "gomaxprocs": runtime.GOMAXPROCS(0), "businessTPS": nil, "inclusionLatency": nil, "finalityLatency": nil, "maxTransactions": 65536, "batchSize": 256, "wallDeadlineSeconds": 210}
	defer func() {
		var usage syscall.Rusage
		if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err == nil {
			report["maxRSSRaw"] = usage.Maxrss
			report["maxRSSPlatform"] = runtime.GOOS
		}
		report["testFailed"] = t.Failed()
		raw, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			t.Error(err)
			return
		}
		if err := os.WriteFile(filepath.Join(directory, "result.json"), append(raw, '\n'), 0600); err != nil {
			t.Error(err)
		}
		t.Logf("actual_fee_history_result %s", raw)
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 210*time.Second)
	defer cancel()
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	keys := make([]*secp256k1.PrivateKey, 256)
	addresses := make([]string, 256)
	recipientKey, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	for i := range keys {
		keys[i], err = secp256k1.GeneratePrivateKey()
		if err != nil {
			t.Fatal(err)
		}
		addresses[i], err = consensus.NativeAddress(keys[i].PubKey().SerializeCompressed())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := devnet.Faucet(addresses[i], 10000); err != nil {
			t.Fatal(err)
		}
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	migrationRaw, err := migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "migration.json"), migrationRaw, 0600); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(directory, "state.journal")
	app, err := consensus.NewBlockJournaledApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	app.SetCommitTimingEnabled(true)
	signedFile, err := os.OpenFile(filepath.Join(directory, "signed-inputs.jsonl"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer signedFile.Close()
	stages := map[string]int64{}
	commitStages := map[string]int64{}
	var total, blocks int
	var last []cmt.Tx
	began := time.Now()
	height := int64(migration.Height)
	for total < 65536 {
		if err := ctx.Err(); err != nil {
			t.Fatal(err)
		}
		block := make([]cmt.Tx, 256)
		signStart := time.Now()
		for i, key := range keys {
			tx, err := consensus.NewSignedTransfer(key, migration.Network.ChainID, recipient, 1, uint64(blocks+1))
			if err != nil {
				t.Fatal(err)
			}
			raw, err := consensus.EncodeSignedTransaction(tx)
			if err != nil {
				t.Fatal(err)
			}
			block[i] = raw
		}
		stages["sign_encode"] += time.Since(signStart).Nanoseconds()
		writeStart := time.Now()
		encoded, err := json.Marshal(struct {
			First        int      `json:"first"`
			Transactions []cmt.Tx `json:"transactions"`
		}{total, block})
		if err != nil {
			t.Fatal(err)
		}
		encoded = append(encoded, '\n')
		if _, err := signedFile.Write(encoded); err != nil {
			t.Fatal(err)
		}
		if err := signedFile.Sync(); err != nil {
			t.Fatal(err)
		}
		stages["signed_input_write_sync"] += time.Since(writeStart).Nanoseconds()
		stage := time.Now()
		for _, raw := range block {
			checked, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: raw})
			if err != nil || checked.Code != 0 {
				t.Fatal("actual signed CheckTx failed", err, checked)
			}
		}
		stages["check_tx"] += time.Since(stage).Nanoseconds()
		height++
		when := time.Unix(1802736000+height, 0)
		stage = time.Now()
		proposal, err := app.PrepareProposal(ctx, &abci.RequestPrepareProposal{Height: height, Time: when, Txs: byteTransactions(block)})
		if err != nil || len(proposal.Txs) != len(block) {
			t.Fatal("actual prepare failed", err)
		}
		stages["prepare_proposal"] += time.Since(stage).Nanoseconds()
		stage = time.Now()
		processed, err := app.ProcessProposal(ctx, &abci.RequestProcessProposal{Height: height, Time: when, Txs: proposal.Txs})
		if err != nil || processed.Status != abci.ResponseProcessProposal_ACCEPT {
			t.Fatal("actual process failed", err)
		}
		stages["process_proposal"] += time.Since(stage).Nanoseconds()
		stage = time.Now()
		finalized, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: when, Txs: proposal.Txs})
		if err != nil || len(finalized.TxResults) != len(block) {
			t.Fatal("actual finalize failed", err)
		}
		for _, result := range finalized.TxResults {
			if result.Code != 0 {
				t.Fatal("business execution rejected", result.Code)
			}
		}
		stages["finalize_block"] += time.Since(stage).Nanoseconds()
		stage = time.Now()
		if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		stages["application_commit"] += time.Since(stage).Nanoseconds()
		timing, ok := app.LastCommitTiming()
		if !ok || !timing.Durable {
			t.Fatal("actual durable Commit sample missing")
		}
		for name, ns := range timing.StagesNs {
			commitStages[name] += ns
		}
		total += len(block)
		blocks++
		last = block
		info, err := os.Stat(statePath)
		if err != nil {
			t.Fatal(err)
		}
		report["executedPersistedTransactions"], report["blocks"], report["storeBytes"] = total, blocks, info.Size()
		report["stageTotalsNs"], report["commitStageTotalsNs"] = stages, commitStages
		if info.Size() > durableSnapshotLimit {
			break
		}
	}
	report["applicationWallSeconds"] = time.Since(began).Seconds()
	if report["storeBytes"].(int64) <= durableSnapshotLimit {
		t.Fatal("actual history did not reach default reader boundary before bounded record cap")
	}
	legacy, err := newDurableReader(migration, []string{statePath})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.verifyBlockBatch(ctx, statePath, last, height); err == nil {
		t.Fatal("default16MiB reader unexpectedly accepted large actual history")
	}
	reader, err := newDurableReaderWithLimits(migration, []string{statePath}, 64<<20, 64<<20)
	if err != nil {
		t.Fatal(err)
	}
	readStart := time.Now()
	evidence, err := reader.verifyBlockBatch(ctx, statePath, last, height)
	if err != nil {
		t.Fatal("explicit reader failed actual history", err)
	}
	report["largeReadbackNs"] = time.Since(readStart).Nanoseconds()
	report["coldReadbackStats"] = reader.stats()
	warmStart := time.Now()
	warmEvidence, err := reader.verifyBlockBatch(ctx, statePath, last, height)
	if err != nil || !warmEvidence.Evidence.SnapshotCacheHit || warmEvidence.Evidence.AppHash != evidence.Evidence.AppHash || warmEvidence.Evidence.StoreSHA256 != evidence.Evidence.StoreSHA256 || warmEvidence.Transactions != evidence.Transactions {
		t.Fatal("fresh-byte warm readback differs from complete cold evidence", err)
	}
	report["warmReadbackNs"] = time.Since(warmStart).Nanoseconds()
	report["readbackStats"] = reader.stats()
	report["readbackEvidence"] = evidence
	store, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := consensus.DecodeBlockJournal(ctx, store, migration)
	if err != nil {
		t.Fatal(err)
	}
	if len(decoded.State.FeeEvents) != total {
		t.Fatal("actual fee history count differs")
	}
	var fees int64
	for _, event := range decoded.State.FeeEvents {
		fees += event.GrossFeeYNXT
	}
	if fees != int64(total) {
		t.Fatal("actual fee conservation differs", fees, total)
	}
	accounts := map[string]chain.ConsensusAccount{}
	for _, account := range decoded.State.Accounts {
		accounts[account.Address] = chain.ConsensusAccount{Address: account.Address, Balance: account.Balance, Nonce: account.Nonce}
	}
	for _, address := range addresses {
		account := accounts[address]
		if account.Nonce != uint64(blocks) || account.Balance != 10000-2*int64(blocks) {
			t.Fatal("actual sender balance/nonce differs", account)
		}
	}
	if accounts[recipient].Balance != int64(total) {
		t.Fatal("actual recipient amount differs")
	}
	published, err := app.Info(ctx, &abci.RequestInfo{})
	if err != nil || published.LastBlockHeight != height || fmt.Sprintf("%x", published.LastBlockAppHash) != decoded.State.AppHash {
		t.Fatal("actual publication/reconstructed state differs", err)
	}
	report["storeSHA256"] = fmt.Sprintf("%x", sha256.Sum256(store))
	report["stateSHA256"] = fmt.Sprintf("%x", sha256.Sum256(decoded.SnapshotJSON))
	report["verifiedFeeEvents"] = len(decoded.State.FeeEvents)
	report["verifiedSenders"] = len(addresses)
	t.Logf("actual_fee_history_application_only records=%d blocks=%d store_bytes=%d readback_ns=%v; no network TPS", total, blocks, len(store), report["largeReadbackNs"])
}
func byteTransactions(txs []cmt.Tx) [][]byte {
	out := make([][]byte, len(txs))
	for i, tx := range txs {
		out[i] = tx
	}
	return out
}
