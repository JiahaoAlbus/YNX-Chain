package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cmt "github.com/cometbft/cometbft/types"
)

func streamingOptions() options {
	return options{manifest: "manifest", transactions: "transactions", output: "new-result", concurrency: 1, observers: 4, offeredRate: 1000, rounds: 34, senderMode: "ready-pool", inclusionMode: "block-scan", terminalStream: true, reuseResultSlots: true, segmentedIntents: true, streamingWorkload: true, evidenceByteBudget: 4 << 20, timeout: 11 * time.Minute, poll: 100 * time.Millisecond}
}
func TestStreamingWorkloadScopeAndLegacyLimits(t *testing.T) {
	o := streamingOptions()
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	o.rounds = 293
	planned, _, err := plannedWorkload(o, 2048)
	if err != nil || planned != 600064 {
		t.Fatal("ten-minute count plan differs", planned, err)
	}
	o.rounds = 489
	if _, _, err := plannedWorkload(o, 2048); err == nil {
		t.Fatal("million-record profile ceiling expanded")
	}
	o = streamingOptions()
	o.streamingWorkload = false
	o.evidenceByteBudget = 0
	if validateOptions(o) == nil {
		t.Fatal("old nonce/time bounds expanded")
	}
	limits, _ := workloadLimits(options{})
	if limits.rounds != 32 || limits.records != 2048 || limits.timeout != 30*time.Second || limits.intentBytes != 8<<20 {
		t.Fatal("default profile changed", limits)
	}
	for _, mutate := range []func(*options){func(o *options) { o.terminalStream = false }, func(o *options) { o.reuseResultSlots = false }, func(o *options) { o.segmentedIntents = false }, func(o *options) { o.senderMode = "rounds" }, func(o *options) { o.inclusionMode = "tx-query" }, func(o *options) { o.observers = 2 }, func(o *options) { o.output = "" }, func(o *options) { o.evidenceByteBudget = 0 }, func(o *options) { o.evidenceByteBudget = (2 << 30) + 1 }, func(o *options) { o.timeout = 15*time.Minute + 1 }, func(o *options) { o.rounds = 4097 }} {
		o := streamingOptions()
		mutate(&o)
		if validateOptions(o) == nil {
			t.Fatal("invalid scoped profile accepted", o)
		}
	}
}
func TestStreamingWorkloadFundingAndNonceAreInstanceBound(t *testing.T) {
	path, raw, m, migration, initial := senderFixture(t)
	o := streamingOptions()
	limits, _ := workloadLimits(o)
	if _, err := loadSenderPool(path, raw, m, migration, initial, 34); err == nil {
		t.Fatal("legacy load accepted 34 cycles")
	}
	p, err := loadSenderPoolWithLimits(path, raw, m, migration, initial, 34, limits)
	if err != nil {
		t.Fatal(err)
	}
	underfunded := migration
	underfunded.Accounts = append(underfunded.Accounts[:0:0], migration.Accounts...)
	for i := range underfunded.Accounts {
		if underfunded.Accounts[i].Address == p.templates[0].From {
			underfunded.Accounts[i].Balance = 67
		}
	}
	if _, err := loadSenderPoolWithLimits(path, raw, m, underfunded, initial, 34, limits); err == nil || !strings.Contains(err.Error(), "balance") {
		t.Fatal("insufficient scoped funding accepted", err)
	}
	template := p.templates[0]
	tx, err := consensus.NewSignedTransfer(p.keys[0], template.ChainID, template.To, 1, 32)
	if err != nil {
		t.Fatal(err)
	}
	signed, err := consensus.EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	p.templates[0] = tx
	p.pending[0] = signed
	successor, err := p.nextForSender(0, gateResult(signed, 50))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := consensus.DecodeSignedTransaction(successor)
	if err != nil || decoded.Nonce != 33 || decoded.Verify(template.ChainID) != nil {
		t.Fatal("real successor signature/nonce differs", err)
	}
	prior := gateResult(signed, 50)
	prior.Status = "submission_unknown"
	if _, err := p.nextForSender(0, prior); err == nil {
		t.Fatal("UNKNOWN account signed successor")
	}
	p.nonceLimit = 32
	if _, err := p.nextForSender(0, gateResult(signed, 50)); err == nil {
		t.Fatal("instance nonce ceiling ignored")
	}
}
func TestStreamingWorkloadEvidenceBudgetPreservesFailedWrite(t *testing.T) {
	b := readyEvidenceBudgetReport{LimitBytes: 20}
	name := filepath.Join(t.TempDir(), "uncertain")
	calls := 0
	sentinel := errors.New("injected Sync failure after partial write")
	persist := b.persist(func(name string, raw []byte) error {
		calls++
		if err := os.WriteFile(name, raw[:1], 0600); err != nil {
			t.Fatal(err)
		}
		return sentinel
	})
	if err := persist(name, []byte("uncertain")); !errors.Is(err, sentinel) {
		t.Fatal(err)
	}
	if err := persist(name, []byte("retry")); err == nil || calls != 1 || !b.Poisoned || b.AttemptedBytes != 9 {
		t.Fatal("uncertain reservation retried or refunded", b, calls)
	}
	actual, err := os.ReadFile(name)
	if err != nil || string(actual) != "u" {
		t.Fatal("uncertain evidence changed", err)
	}
	cap := readyEvidenceBudgetReport{LimitBytes: 1}
	if cap.persist(func(string, []byte) error { t.Fatal("over-budget write started"); return nil })("unused", []byte("xx")) == nil {
		t.Fatal("cap ignored")
	}
}

// Real signed CheckTx/Finalize/Commit/reopen, synthetic quorum observations for
// the controller interface only. This is not network finality or business TPS.
func TestStreamingWorkloadRealExecutionAcrossLegacyNonceBoundary(t *testing.T) {
	testStreamingWorkloadRealExecution(t, false, false)
}

func TestStreamingWorkloadGzipRealExecutionAcrossLegacyNonceBoundary(t *testing.T) {
	testStreamingWorkloadRealExecution(t, true, false)
}

func testStreamingWorkloadRealExecution(t *testing.T, compressed, native bool) {
	path, manifest, m, migration, initial := senderFixture(t)
	o := streamingOptions()
	if native {
		o = nativeStreamingOptions()
		o.pacedWorkerInventory = new(pacedWorkerInventory)
	}
	o.terminalGzip = compressed
	o.output = filepath.Join(t.TempDir(), "transactions-result.json")
	if native {
		o.output = filepath.Join(filepath.Dir(path), "transactions-result.json")
	}
	limits, _ := workloadLimits(o)
	p, err := loadSenderPoolWithLimits(path, manifest, m, migration, initial, o.rounds, limits)
	if err != nil {
		t.Fatal(err)
	}
	planPath, planHash, err := persistStreamingWorkloadPlan(o, manifest, m, initial)
	if err != nil {
		t.Fatal(err)
	}
	planBytes, err := os.ReadFile(planPath)
	if err != nil || fmt.Sprintf("%x", sha256.Sum256(planBytes)) != planHash {
		t.Fatal("durable public plan differs", err)
	}
	var plan streamingWorkloadPlan
	if err = json.Unmarshal(planBytes, &plan); err != nil || (plan.TerminalEncoding == "gzip") != compressed {
		t.Fatal("terminal encoding not bound to original durable plan", err)
	}
	if err := claimSenderPool(path); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "state.journal")
	app, err := consensus.NewBlockJournaledApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	var nativeReader *durableReader
	if native {
		nativeReader, err = newWorkloadDurableReader(migration, []string{statePath}, o)
		if err != nil {
			t.Fatal(err)
		}
		if err = nativeReader.configureNativeStreamingReplay(o); err != nil {
			t.Fatal(err)
		}
	}
	stream, err := newTerminalStream(o.output+".terminal-stream", p)
	if err != nil {
		t.Fatal(err)
	}
	stream.maxBytes = limits.terminalBytes
	if compressed {
		stream.report.Encoding = "gzip"
	}
	o.evidenceBudget = &readyEvidenceBudgetReport{LimitBytes: o.evidenceByteBudget}
	stream.persist = o.evidenceBudget.persist(stream.persist)
	o.terminalSink = stream.append
	txs := make([]cmt.Tx, len(initial))
	results := make([]transactionResult, len(initial))
	for i := range results {
		results[i] = transactionResult{Index: i, Round: 1, Status: "not_submitted", Errors: []errorObservation{}}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	var execute sync.Mutex
	height := int64(migration.Height)
	signed := 0
	stats, runErr := runReadySenderPool(ctx, o, p, txs, results, func(index int) (time.Time, bool) {
		began := time.Now()
		at := began.UTC()
		results[index].SubmittedAt = &at
		results[index].submitMonotonic = began
		response, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: txs[index]})
		if err != nil || response.Code != 0 {
			t.Errorf("real CheckTx failed: %v %+v", err, response)
			return began, false
		}
		ms := float64(time.Since(began).Nanoseconds()) / 1e6
		results[index].CheckTxMs = &ms
		return began, true
	}, func(_ int, queue <-chan acceptedObservation, terminal func(int)) {
		for job := range queue {
			index := job.index
			execute.Lock()
			height++
			h := height
			when := time.Unix(1802736000+h, 0)
			response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: h, Time: when, Txs: [][]byte{txs[index]}})
			if err != nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
				t.Errorf("real signed execution failed: %v %+v", err, response)
				execute.Unlock()
				terminal(index)
				continue
			}
			inclusion := float64(time.Since(results[index].submitMonotonic).Nanoseconds()) / 1e6
			if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Errorf("real durable Commit failed: %v", err)
				execute.Unlock()
				terminal(index)
				continue
			}
			stateBytes, err := os.ReadFile(statePath)
			if err != nil {
				t.Error(err)
			}
			info, err := app.Info(ctx, &abci.RequestInfo{})
			if err != nil || info.LastBlockHeight != h {
				t.Errorf("publication differs %v", err)
			}
			var nativeEvidence durableEvidence
			if native {
				nativeEvidence, err = nativeReader.verify(ctx, statePath, txs[index], h)
				if err != nil || nativeEvidence.Height != h || nativeEvidence.AppHash != fmt.Sprintf("%x", info.LastBlockAppHash) {
					t.Errorf("native stream current state/publication proof differs: %v", err)
				}
			}
			previous := results[index]
			row := gateResult(txs[index], h)
			row.Index, row.Round = previous.Index, previous.Round
			row.Bytes = len(txs[index])
			row.SignedTransaction = base64.StdEncoding.EncodeToString(txs[index])
			row.OfferedAt, row.offerMonotonic = previous.OfferedAt, previous.offerMonotonic
			row.SubmittedAt, row.submitMonotonic = previous.SubmittedAt, previous.submitMonotonic
			row.QueueDelayMs, row.CheckTxMs = previous.QueueDelayMs, previous.CheckTxMs
			final := float64(time.Since(row.submitMonotonic).Nanoseconds()) / 1e6
			row.InclusionMs = &inclusion
			row.ConfirmationMs = &final
			row.DurableSnapshotSHA256 = fmt.Sprintf("%x", sha256.Sum256(stateBytes))
			row.DurableStoreFormat = "block-journal-v2"
			row.DurableInfoVerified = true
			row.DurableInfoHeight = h
			if native {
				row.DurableSnapshotSHA256 = nativeEvidence.SnapshotSHA256
				row.DurableStoreSHA256 = nativeEvidence.StoreSHA256
				row.DurableStateAppHash = nativeEvidence.AppHash
				row.DurableStateHeight = nativeEvidence.Height
				row.DurableStoreFormat = nativeEvidence.StoreFormat
			}
			results[index] = row
			signed++
			execute.Unlock()
			terminal(index)
		}
	})
	if err := stream.close(); err != nil {
		t.Fatal(err)
	}
	if runErr != nil || stats.Completed != len(initial)*34 || stats.Quarantined != 0 || stats.RoundsCompleted != 34 || stats.PeakInFlight > len(initial) || len(results) != len(initial) || signed != 102 {
		t.Fatal("scoped controller differs", stats, runErr)
	}
	if native {
		actual := nativeReader.stats()
		if actual.ObserverNativeFacts == nil || actual.ObserverNativeFacts.Lookups != 102 || actual.ObserverNativeFacts.Hits != 102 || actual.ObserverNativeFacts.FallbackFailures != 0 || actual.PrefixReplay.CanonicalByteLimit != 32<<20 || actual.TransactionVerifications != 102 {
			t.Fatal("actual native stream current-state/signature work differs", actual)
		}
		inventory := o.pacedWorkerInventory
		if inventory.Submitters != 8 || inventory.Observers != 4 || inventory.SubmissionQueueCapacity != len(initial) || len(inventory.ObservationQueueCapacities) != 4 {
			t.Fatal("native stream actual workers/queues differ", inventory)
		}
		t.Logf("original signed execution+Commit+native readback+nonce34+stream recovery102 inputs; quorum remains unit gates, no network business TPS")
	}
	if o.evidenceBudget.Poisoned || o.evidenceBudget.AttemptedBytes != stats.IntentSegments.Bytes+int64(stream.report.Bytes) {
		t.Fatal("encoded budget differs from exact complete inventories")
	}
	if err := verifyStreamingWorkloadEvidence(ctx, manifest, m, initial, 34, stats.IntentSegments, &stream.report, results, o.output, o.evidenceByteBudget); err != nil {
		t.Fatal(err)
	}
	reopened, err := consensus.NewBlockJournaledApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := app.Info(ctx, &abci.RequestInfo{})
	after, _ := reopened.Info(ctx, &abci.RequestInfo{})
	if before.LastBlockHeight != after.LastBlockHeight || string(before.LastBlockAppHash) != string(after.LastBlockAppHash) {
		t.Fatal("real reopened state differs")
	}
	for _, raw := range txs {
		response, err := reopened.CheckTx(ctx, &abci.RequestCheckTx{Tx: raw})
		if err != nil || response.Code == 0 {
			t.Fatal("executed nonce replay accepted", err)
		}
	}
	if err := claimSenderPool(path); err == nil {
		t.Fatal("completed fixture claim was silently reusable")
	}
	if native {
		exportNativeStreamPublicFixture(t, filepath.Dir(path), o.output, stats, &stream.report, results)
	}
	t.Logf("application_pipeline_only real_signed_executed_persisted=%d sender_slots=%d nonce_cycles=%d evidence_attempted_bytes=%d; quorum flags synthetic, no network TPS", signed, len(results), stats.RoundsCompleted, o.evidenceBudget.AttemptedBytes)
}

func streamingEvidenceFixture(t *testing.T, wrongInput bool) ([]byte, consensus.EphemeralNetworkManifest, []cmt.Tx, *readyIntentSegmentReport, *terminalStreamReport, []transactionResult, string) {
	t.Helper()
	path, manifest, m, migration, initial := senderFixture(t)
	o := streamingOptions()
	limits, _ := workloadLimits(o)
	p, err := loadSenderPoolWithLimits(path, manifest, m, migration, initial, 2, limits)
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "result")
	intents, err := newReadyIntentSegments(filepath.Join(p.root, readyIntentSegmentsName), p, 6, 8<<20)
	if err != nil {
		t.Fatal(err)
	}
	term, err := newTerminalStream(output+".terminal-stream", p)
	if err != nil {
		t.Fatal(err)
	}
	latest := make([]transactionResult, 3)
	for round := 1; round <= 2; round++ {
		wave := make([]readySenderEnvelope, 0, 3)
		for sender, template := range p.templates {
			raw := initial[sender]
			if round > 1 {
				tx, err := consensus.NewSignedTransfer(p.keys[sender], template.ChainID, template.To, 1, uint64(round))
				if err != nil {
					t.Fatal(err)
				}
				raw, err = consensus.EncodeSignedTransaction(tx)
				if err != nil {
					t.Fatal(err)
				}
			}
			wave = append(wave, readySenderEnvelope{Index: (round-1)*3 + sender, Sender: sender, Round: round, Hash: fmt.Sprintf("%X", raw.Hash()), Transaction: raw})
		}
		if err := intents.append(wave); err != nil {
			t.Fatal(err)
		}
		for _, e := range wave {
			raw := e.Transaction
			if wrongInput && e.Index == 0 {
				raw = initial[1]
			}
			row := gateResult(raw, int64(round+2))
			row.Index, row.Round = e.Index, e.Round
			row.Bytes = len(raw)
			row.SignedTransaction = base64.StdEncoding.EncodeToString(raw)
			latest[e.Sender] = row
			if err := term.append(row); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := intents.close(); err != nil {
		t.Fatal(err)
	}
	if err := term.close(); err != nil {
		t.Fatal(err)
	}
	return manifest, m, initial, &intents.report, &term.report, latest, output
}
func TestStreamingWorkloadReadbackBindsBothStreamsAndLatestSlots(t *testing.T) {
	manifest, m, initial, intents, terminal, latest, output := streamingEvidenceFixture(t, false)
	verify := func(ctx context.Context) error {
		return verifyStreamingWorkloadEvidence(ctx, manifest, m, initial, 2, intents, terminal, latest, output, 16<<20)
	}
	if err := verify(context.Background()); err != nil {
		t.Fatal(err)
	}
	latest[0].Status = "submission_unknown"
	if err := verify(context.Background()); err == nil {
		t.Fatal("changed latest observation promoted")
	}
	latest[0].Status = "confirmed"
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := verify(ctx); err == nil {
		t.Fatal("cancelled verifier completed")
	}
	if err := verifyStreamingWorkloadEvidence(context.Background(), manifest, m, initial, 2, intents, terminal, latest, output, intents.Bytes+int64(terminal.Bytes)-1); err == nil {
		t.Fatal("combined evidence budget ignored")
	}
}
func TestStreamingWorkloadReadbackRejectsUnmatchedButValidSignedBytes(t *testing.T) {
	manifest, m, initial, intents, terminal, latest, output := streamingEvidenceFixture(t, true)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err := verifyStreamingWorkloadEvidence(ctx, manifest, m, initial, 2, intents, terminal, latest, output, 16<<20)
	if err == nil || !strings.Contains(err.Error(), "differs from verified intent") {
		t.Fatal("valid signature under wrong workload identity accepted", err)
	}
}

func TestStreamingWorkloadDurablePlanNeverOverwritesPriorScope(t *testing.T) {
	_, manifest, m, _, initial := senderFixture(t)
	o := streamingOptions()
	o.output = filepath.Join(t.TempDir(), "new-output")
	path, hash, err := persistStreamingWorkloadPlan(o, manifest, m, initial)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var plan streamingWorkloadPlan
	if err := json.Unmarshal(raw, &plan); err != nil {
		t.Fatal(err)
	}
	if plan.PlannedRecords != 102 || plan.RequiredBalancePerSender != 68 || len(plan.InitialSignedHashes) != 3 || fmt.Sprintf("%x", sha256.Sum256(raw)) != hash {
		t.Fatal("plan scope/identity differs", plan)
	}
	o.rounds = 35
	if _, _, err := persistStreamingWorkloadPlan(o, manifest, m, initial); err == nil {
		t.Fatal("prior durable plan overwritten")
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(raw) {
		t.Fatal("old scope changed", err)
	}
}
