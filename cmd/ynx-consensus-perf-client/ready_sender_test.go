package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

func readyResults(count int) []transactionResult {
	r := make([]transactionResult, count*2)
	for i := range r {
		r[i] = transactionResult{Index: i, Round: i/count + 1, Status: "not_submitted", Errors: []errorObservation{}}
	}
	return r
}

// Real native signatures/execution/durability/restart are exercised below.
// Quorum flags remain explicit unit gate inputs, not a network consensus result.
func TestReadySenderFastAccountAdvancesBeforeSlowPeer(t *testing.T) {
	t.Run("full_history", func(t *testing.T) { testReadySenderFastAccount(t, false) })
	t.Run("reused_slots", func(t *testing.T) { testReadySenderFastAccount(t, true) })
}

func testReadySenderFastAccount(t *testing.T, reuseSlots bool, segmentOption ...bool) {
	segmented := len(segmentOption) > 0 && segmentOption[0]
	path, manifest, m, migration, initial := senderFixture(t)
	p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
	if err != nil {
		t.Fatal(err)
	}
	if err = claimSenderPool(path); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "state.json")
	app, err := consensus.NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	txs := make([]cmttypes.Tx, 6)
	results := readyResults(3)
	if reuseSlots {
		txs = txs[:3]
		results = results[:3]
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var releaseSlow, slowFinished, fastOffered atomic.Bool
	var execution sync.Mutex
	height := int64(migration.Height)
	stream, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), p)
	if err != nil {
		t.Fatal(err)
	}
	var finalizeNs, commitNs int64
	var finalizeCalls, commitCalls int
	controllerStarted := time.Now()
	stats, err := runReadySenderPool(ctx, options{rounds: 2, offeredRate: 2048, concurrency: 4, observers: 4, terminalSink: stream.append, reuseResultSlots: reuseSlots, segmentedIntents: segmented}, p, txs, results,
		func(index int) (time.Time, bool) {
			var data []byte
			var readErr error
			if segmented {
				var entries []os.DirEntry
				entries, readErr = os.ReadDir(filepath.Join(p.root, readyIntentSegmentsName))
				for _, entry := range entries {
					if readErr != nil {
						break
					}
					var part []byte
					part, readErr = os.ReadFile(filepath.Join(p.root, readyIntentSegmentsName, entry.Name()))
					data = append(data, part...)
				}
			} else {
				data, readErr = os.ReadFile(filepath.Join(p.root, readySenderJournalName))
			}
			if readErr != nil || !bytes.Contains(data, []byte(base64.StdEncoding.EncodeToString(txs[index]))) {
				t.Error("dispatch without durable public input identity")
			}
			if results[index].Index == 4 {
				if slowFinished.Load() {
					t.Error("fast sender waited for slow account")
				}
				fastOffered.Store(true)
				releaseSlow.Store(true)
			}
			results[index].CheckTxIdentityVerified = true
			return time.Now(), true
		},
		func(_ int, queue <-chan acceptedObservation, terminal func(int)) {
			runGroupedObservationLoop(ctx, time.Millisecond, queue, func(int) {}, func(pending []acceptedObservation) []acceptedObservation {
				var keep []acceptedObservation
				for _, job := range pending {
					if job.index == 0 && !releaseSlow.Load() && ctx.Err() == nil {
						keep = append(keep, job)
						continue
					}
					if ctx.Err() != nil {
						results[job.index].Status = "timeout"
						terminal(job.index)
						continue
					}
					execution.Lock()
					height++
					phaseStarted := time.Now()
					finalized, execErr := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000+height, 0), Txs: [][]byte{txs[job.index]}})
					finalizeNs += time.Since(phaseStarted).Nanoseconds()
					finalizeCalls++
					if execErr != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != 0 {
						t.Errorf("actual ready execution failed: %v", execErr)
					}
					phaseStarted = time.Now()
					_, execErr = app.Commit(ctx, &abci.RequestCommit{})
					commitNs += time.Since(phaseStarted).Nanoseconds()
					commitCalls++
					if execErr != nil {
						t.Error(execErr)
					}
					gate := gateResult(txs[job.index], height)
					gate.Index, gate.Round = results[job.index].Index, results[job.index].Round
					gate.SignedTransaction = results[job.index].SignedTransaction
					gate.OfferedAt, gate.ScheduledAt, gate.offerMonotonic = results[job.index].OfferedAt, results[job.index].ScheduledAt, results[job.index].offerMonotonic
					results[job.index] = gate
					execution.Unlock()
					if job.index == 0 {
						slowFinished.Store(true)
					}
					terminal(job.index)
				}
				return keep
			})
		})
	controllerNs := time.Since(controllerStarted).Nanoseconds()
	if err != nil || !fastOffered.Load() || stats.Completed != 6 || stats.Offered != 6 || stats.Prepared != 6 || stats.RoundsCompleted != 2 || stats.Quarantined != 0 || stats.PeakInFlight > 3 || !p.stopped {
		t.Fatalf("continuous ready run failed: %+v %v", stats, err)
	}
	if stats.Supply.SignAttempts != 3 || stats.Supply.EncodeAttempts != 3 || stats.Supply.SignedSuccessors != 3 || stats.Supply.JournalDurableEnvelopes != 6 || stats.Supply.JournalAppendAttempts < 2 || stats.Supply.JournalDurableBytes <= 0 || stats.Supply.SignNs <= 0 || stats.Supply.EncodeNs <= 0 || stats.Supply.JournalAppendNs <= 0 || stats.Supply.JournalSetupNs <= 0 {
		t.Fatalf("supply stages do not match actual signed/durable workload: %+v", stats.Supply)
	}
	if stats.Supply.OfferDecodeAttempts != 6 || stats.Supply.PacingWaitAttempts != 6 || stats.Supply.DispatchAttempts != 6 || stats.Supply.TerminalSinkAttempts != 6 || stats.Supply.OfferDecodeNs <= 0 || stats.Supply.PacingWaitNs <= 0 || stats.Supply.DispatchNs <= 0 || stats.Supply.TerminalSinkNs <= 0 || stats.Supply.CompletionWaitNs < 0 {
		t.Fatalf("controller phase counts differ from the actual six business inputs: %+v", stats.Supply)
	}
	if segmented {
		recovered, readErr := readReadySenderIntents(context.Background(), p.root, manifest, m, initial, 2, stats.IntentSegments)
		if readErr != nil || recovered.Records != 6 || recovered.IncompleteTail {
			t.Fatal("controller segmented inputs did not recover", recovered, readErr)
		}
		for i := 0; i < 3; i++ {
			if !bytes.Equal(recovered.Transactions[i], initial[i]) || !bytes.Equal(recovered.Transactions[i+3], p.pending[i]) {
				t.Fatal("controller identity changed", i)
			}
		}
	}
	terminalCloseStarted := time.Now()
	err = stream.close()
	terminalCloseNs := time.Since(terminalCloseStarted).Nanoseconds()
	if err != nil || stream.report.DurableRecords != 6 {
		t.Fatal("actual executed terminal evidence was not sealed", stream.report, err)
	}
	restartStarted := time.Now()
	restarted, err := consensus.NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	query, err := restarted.Query(context.Background(), &abci.RequestQuery{Path: "/state"})
	if err != nil {
		t.Fatal(err)
	}
	var state consensus.CommittedState
	if err = json.Unmarshal(query.Value, &state); err != nil {
		t.Fatal(err)
	}
	restartReadNs := time.Since(restartStarted).Nanoseconds()
	for _, template := range p.templates {
		found := false
		for _, account := range state.Accounts {
			if account.Address == template.From {
				found = true
				if account.Nonce != 2 || account.Balance != 9996 {
					t.Fatal("wrong durable sender state", account)
				}
			}
		}
		if !found {
			t.Fatal("missing durable sender")
		}
	}
	if len(state.FeeEvents) != 6 {
		t.Fatal("wrong fee count")
	}
	if segmented {
		if _, err = os.Lstat(filepath.Join(p.root, readySenderJournalName)); !os.IsNotExist(err) {
			t.Fatal("segmented controller created or obscured a flat journal", err)
		}
		if _, err = newReadyIntentSegments(stats.IntentSegments.Directory, p, 6, 8<<20); err == nil {
			t.Fatal("existing segmented ready journal reused")
		}
	} else if _, err = newReadySenderJournal(p); err == nil {
		t.Fatal("existing ready journal reused")
	}
	if err = claimSenderPool(path); err == nil {
		t.Fatal("fixture claim reused")
	}
	if finalizeCalls != 6 || commitCalls != 6 || finalizeNs <= 0 || commitNs <= 0 || terminalCloseNs <= 0 || restartReadNs <= 0 {
		t.Fatal("actual execution/persistence phase measurements missing")
	}
	mode := "flat-full-history"
	if reuseSlots {
		mode = "flat-reused-slots"
	}
	if segmented {
		mode = "segmented-reused-slots"
	}
	phase, err := json.Marshal(struct {
		Schema               string           `json:"schema"`
		Mode                 string           `json:"mode"`
		BusinessTransactions int              `json:"businessTransactions"`
		ControllerNs         int64            `json:"controllerNs"`
		Supply               readySupplyStats `json:"supply"`
		FinalizeCalls        int              `json:"finalizeCalls"`
		FinalizeNs           int64            `json:"finalizeNs"`
		CommitCalls          int              `json:"commitCalls"`
		CommitNs             int64            `json:"commitNs"`
		TerminalCloseNs      int64            `json:"terminalCloseNs"`
		RestartReadNs        int64            `json:"restartReadNs"`
		Scope                string           `json:"scope"`
	}{"ynx-ready-supply-phase-sample-v1", mode, 6, controllerNs, stats.Supply, finalizeCalls, finalizeNs, commitCalls, commitNs, terminalCloseNs, restartReadNs, "Real six signed local business executions and durable restart; controlled slow-peer scheduling; quorum flags are unit gate inputs, no RPC or network finality. Initial fixture signing excluded; callback totals overlap concurrent execution and are not additive."})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("YNX_READY_SUPPLY_PHASE_V1 %s", phase)
}

func TestReadySenderQuarantinesOnlyUncertainOrUnverifiedAccount(t *testing.T) {
	for _, mode := range []string{"unknown", "rejected", "bad_final", "published_lag"} {
		t.Run(mode, func(t *testing.T) {
			path, manifest, m, migration, initial := senderFixture(t)
			p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
			if err != nil {
				t.Fatal(err)
			}
			if err = claimSenderPool(path); err != nil {
				t.Fatal(err)
			}
			txs := make([]cmttypes.Tx, 6)
			results := readyResults(3)
			var submits atomic.Int64
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			stats, err := runReadySenderPool(ctx, options{rounds: 2, offeredRate: 2048, concurrency: 4, observers: 4}, p, txs, results,
				func(index int) (time.Time, bool) {
					submits.Add(1)
					if index == 4 {
						t.Error("quarantined sender signed/submitted another nonce")
					}
					if index == 1 && (mode == "unknown" || mode == "rejected") {
						results[index].Status = "submission_unknown"
						if mode == "rejected" {
							results[index].Status = "checktx_rejected"
						}
						return time.Now(), false
					}
					return time.Now(), true
				},
				func(_ int, queue <-chan acceptedObservation, terminal func(int)) {
					for job := range queue {
						gate := gateResult(txs[job.index], 5)
						if job.index == 1 {
							if mode == "bad_final" {
								gate.DurableStateVerified = false
							}
							if mode == "published_lag" {
								gate.DurableStoreFormat = "block-journal"
								gate.DurableInfoVerified = true
								gate.DurableInfoHeight = 4
							}
						}
						results[job.index] = gate
						terminal(job.index)
					}
				})
			if err == nil || stats.Quarantined != 1 || stats.Completed != 4 || stats.Offered != 5 || submits.Load() != 5 || p.templates[1].Nonce != 1 || !p.stopped {
				t.Fatal("quarantine failed", stats, err)
			}
			raw, err := os.ReadFile(filepath.Join(p.root, readySenderJournalName))
			if err != nil {
				t.Fatal(err)
			}
			for _, line := range bytes.Split(bytes.TrimSpace(raw), []byte{'\n'})[1:] {
				var e readySenderEnvelope
				if json.Unmarshal(line, &e) != nil {
					t.Fatal("bad persisted envelope")
				}
				if e.Sender == 1 && e.Round > 1 {
					t.Fatal("quarantined sender signed later input")
				}
			}
		})
	}
}

type readyFaultFile struct {
	writes, syncs int
	mode          string
}

func (f *readyFaultFile) Write(raw []byte) (int, error) {
	f.writes++
	if f.mode == "short" {
		return len(raw) - 1, nil
	}
	if f.mode == "write" {
		return 0, io.ErrClosedPipe
	}
	return len(raw), nil
}
func (f *readyFaultFile) Sync() error {
	f.syncs++
	if f.mode == "sync" {
		return io.ErrUnexpectedEOF
	}
	return nil
}
func (f *readyFaultFile) Close() error { return nil }

func TestReadySenderJournalNeverRetriesUncertainAppend(t *testing.T) {
	for _, mode := range []string{"short", "write", "sync"} {
		t.Run(mode, func(t *testing.T) {
			f := &readyFaultFile{mode: mode}
			j := &readySenderJournal{file: f}
			wave := []readySenderEnvelope{{Index: 0, Sender: 0, Round: 1, Transaction: cmttypes.Tx("identity-only fault fixture")}}
			if j.append(wave) == nil || !j.poisoned || j.records != 0 {
				t.Fatal("failed append published record")
			}
			if j.append(wave) == nil || f.writes != 1 {
				t.Fatal("uncertain append retried")
			}
		})
	}
}

func TestReadySenderCanceledPlanDoesNotOfferOrResume(t *testing.T) {
	path, manifest, m, migration, initial := senderFixture(t)
	p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	stats, err := runReadySenderPool(ctx, options{rounds: 2, offeredRate: 128, concurrency: 4, observers: 4}, p, make([]cmttypes.Tx, 6), readyResults(3), func(int) (time.Time, bool) { t.Error("cancelled plan submitted"); return time.Now(), false }, func(_ int, q <-chan acceptedObservation, _ func(int)) {
		for range q {
			t.Error("cancelled plan observed")
		}
	})
	if !errors.Is(err, context.Canceled) || stats.Offered != 0 || stats.Prepared != 0 || !p.stopped {
		t.Fatal("cancelled pool reusable", stats, err)
	}
}

func TestReadySenderMidFlightCancellationClosesObservationQueues(t *testing.T) {
	path, manifest, m, migration, initial := senderFixture(t)
	p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	results := readyResults(3)
	returned := make(chan error, 1)
	go func() {
		_, runErr := runReadySenderPool(ctx, options{rounds: 2, offeredRate: 128, concurrency: 4, observers: 4}, p, make([]cmttypes.Tx, 6), results,
			func(int) (time.Time, bool) { cancel(); return time.Now(), true },
			func(_ int, q <-chan acceptedObservation, terminal func(int)) {
				runGroupedObservationLoop(ctx, time.Millisecond, q, func(int) {}, func(pending []acceptedObservation) []acceptedObservation {
					for _, job := range pending {
						results[job.index].Status = "timeout"
						terminal(job.index)
					}
					return nil
				})
			})
		returned <- runErr
	}()
	select {
	case err := <-returned:
		if !errors.Is(err, context.Canceled) || !p.stopped {
			t.Fatal("mid-flight cancellation lost", err)
		}
	case <-time.After(time.Second):
		t.Fatal("controller and canceled observers waited on each other")
	}
}

func TestReadySenderAbruptExitPreservesSignedIdentitiesAndClaim(t *testing.T) {
	path, manifest, m, _, initial := senderFixture(t)
	child := exec.Command(os.Args[0], "-test.run=^TestReadySenderAbruptJournalHelper$", "-test.count=1")
	child.Env = append(os.Environ(), "GOMAXPROCS=1", "YNX_READY_JOURNAL_EXIT_MANIFEST="+path)
	output, err := child.CombinedOutput()
	var exited *exec.ExitError
	if !errors.As(err, &exited) || exited.ExitCode() != 17 {
		t.Fatalf("unexpected abrupt helper result: %v %s", err, output)
	}
	file := filepath.Join(filepath.Dir(path), readySenderJournalName)
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := decodeReadySenderJournal(context.Background(), before, manifest, m, initial, 2)
	if err != nil || recovered.IncompleteTail || recovered.Records != 3 {
		t.Fatal("abrupt input identities lost", recovered, err)
	}
	for i, raw := range initial {
		if !bytes.Equal(raw, recovered.Transactions[i]) {
			t.Fatal("recovered initial identity differs")
		}
	}
	if err = claimSenderPool(path); err == nil {
		t.Fatal("abrupt fixture was allowed to restart")
	}
	after, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("read-only recovery changed original bytes")
	}
}

func TestReadySenderAbruptJournalHelper(t *testing.T) {
	path := os.Getenv("YNX_READY_JOURNAL_EXIT_MANIFEST")
	if path == "" {
		t.Skip("explicit isolated child helper only")
	}
	manifest, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var m consensus.EphemeralNetworkManifest
	if err = json.Unmarshal(manifest, &m); err != nil {
		t.Fatal(err)
	}
	migration, err := readMigration(m)
	if err != nil {
		t.Fatal(err)
	}
	input, err := os.ReadFile(filepath.Join(filepath.Dir(path), "transactions.json"))
	if err != nil {
		t.Fatal(err)
	}
	initial, err := decodeTransactions(input)
	if err != nil {
		t.Fatal(err)
	}
	p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
	if err != nil {
		t.Fatal(err)
	}
	if err = claimSenderPool(path); err != nil {
		t.Fatal(err)
	}
	_, err = runReadySenderPool(context.Background(), options{rounds: 2, offeredRate: 128, concurrency: 4, observers: 4}, p, make([]cmttypes.Tx, len(initial)*2), readyResults(len(initial)), func(int) (time.Time, bool) { os.Exit(17); return time.Time{}, false }, func(_ int, q <-chan acceptedObservation, _ func(int)) {
		for range q {
		}
	})
	t.Fatalf("abrupt helper returned: %v", err)
}

// A prior UNKNOWN result must not create a signing sample or another nonce.
func TestReadySupplyRejectsUnknownBeforeSigning(t *testing.T) {
	p := terminalFixture(t)
	before := append([]byte(nil), p.pending[0]...)
	var supply readySupplyStats
	if _, err := p.nextForSenderMeasured(0, transactionResult{Status: "submission_unknown"}, &supply); err == nil {
		t.Fatal("unknown predecessor signed")
	}
	if supply != (readySupplyStats{}) || !bytes.Equal(before, p.pending[0]) {
		t.Fatal("rejected predecessor mutated signing supply or pending identity", supply)
	}
}

func TestReadySenderSegmentedIntentBarrierAndRecovery(t *testing.T) {
	testReadySenderFastAccount(t, true, true)
}

func TestReadySenderSegmentedIntentFailureNeverSubmits(t *testing.T) {
	p := terminalFixture(t)
	results := readyResults(3)[:3]
	txs := make([]cmttypes.Tx, 3)
	var submitted atomic.Int64
	var path string
	stats, err := runReadySenderPool(context.Background(), options{rounds: 2, offeredRate: 2048, concurrency: 1, observers: 1, reuseResultSlots: true, segmentedIntents: true, terminalSink: func(transactionResult) error { return nil }, intentPersistence: func(name string, raw []byte) error {
		path = name
		if err := os.WriteFile(name, raw[:len(raw)/2], 0600); err != nil {
			return err
		}
		return io.ErrShortWrite
	}}, p, txs, results, func(int) (time.Time, bool) { submitted.Add(1); return time.Now(), true }, func(_ int, queue <-chan acceptedObservation, _ func(int)) {
		for range queue {
			t.Error("unpersisted input reached observer")
		}
	})
	if err == nil || submitted.Load() != 0 || stats.Prepared != 0 || stats.Offered != 0 || stats.Completed != 0 || stats.Supply.JournalDurableEnvelopes != 0 || stats.Supply.JournalDurableBytes != 0 || stats.IntentSegments == nil || !stats.IntentSegments.Poisoned || !p.stopped {
		t.Fatal("failed input persistence crossed dispatch barrier", stats, err)
	}
	raw, readErr := os.ReadFile(path)
	if readErr != nil || len(raw) == 0 {
		t.Fatal("failed input evidence lost", readErr)
	}
}
