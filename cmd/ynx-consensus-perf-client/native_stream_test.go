package main

import (
	"context"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmt "github.com/cometbft/cometbft/types"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func nativeStreamingOptions() options {
	o := streamingOptions()
	o.nativeStream8, o.prefixDurableReplay, o.prefixNativeClone, o.observerNativeFacts, o.observerPhaseTiming = true, true, true, true, true
	o.concurrency = 8
	o.durableStoreByteLimit, o.durableCacheByteBudget = 32<<20, 32<<20
	return o
}
func TestNativeStreamingScopeAndOriginalLimits(t *testing.T) {
	o := nativeStreamingOptions()
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	o.rounds = 293
	if planned, _, err := plannedWorkload(o, 2048); err != nil || planned != 600064 {
		t.Fatal("original planned-record bound differs", planned, err)
	}
	for _, mutate := range []func(*options){
		func(o *options) { o.nativeStream8 = false }, func(o *options) { o.streamingWorkload = false }, func(o *options) { o.concurrency = 4 }, func(o *options) { o.concurrency = 9 }, func(o *options) { o.observers = 2 }, func(o *options) { o.offeredRate = 1001 }, func(o *options) { o.rounds = 1 }, func(o *options) { o.senderMode = "rounds" }, func(o *options) { o.prefixNativeClone = false }, func(o *options) { o.prefixDurableReplay = false }, func(o *options) { o.observerNativeFacts = false }, func(o *options) { o.observerPhaseTiming = false }, func(o *options) { o.sharedDurableReplay = true }, func(o *options) { o.nativeSubmit8 = true }, func(o *options) { o.nativeSuffixSetup = true }, func(o *options) { o.clientProcs2 = true }, func(o *options) { o.endpointFair = true }, func(o *options) { o.segmentedIntents = false }, func(o *options) { o.durableCacheByteBudget = 0 },
	} {
		bad := nativeStreamingOptions()
		mutate(&bad)
		if err := validateOptions(bad); err == nil {
			t.Fatal("unsupported native streaming scope accepted", bad)
		}
	}
	old := streamingOptions()
	old.concurrency = 8
	if validateOptions(old) == nil {
		t.Fatal("default ready sender worker bound expanded")
	}
	b, err := json.Marshal(report{})
	if err != nil || strings.Contains(string(b), "nativeStream8") {
		t.Fatal("default report changed", err)
	}
}
func TestNativeStreamingReaderHasFreshConstructionAndCoupledBudget(t *testing.T) {
	_, migration, path, raw, height := durableJournalFixture(t, "block-journal")
	o := nativeStreamingOptions()
	r, err := newWorkloadDurableReader(migration, []string{path}, o)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.configureObserverNativeFacts(); err == nil {
		t.Fatal("legacy observer mode accepted profiled reader")
	}
	if err = r.configureNativeStreamingReplay(o); err != nil {
		t.Fatal(err)
	}
	if r.profileMu == nil || r.signatureFacts != nil || r.prefixDecoder.ByteLimit() != 32<<20 {
		t.Fatal("profile lock/signature-cache/actual cap differs")
	}
	if _, err = r.verify(context.Background(), path, raw, height); err != nil {
		t.Fatal(err)
	}
	if err = r.configureNativeStreamingReplay(o); err == nil {
		t.Fatal("active reader reconfigured")
	}
	if _, err = r.verify(context.Background(), path, raw, height+1); err == nil {
		t.Fatal("wrong execution height accepted")
	}
	oldChain := r.migration.Network.ChainID
	r.migration.Network.ChainID++
	if _, err = r.verify(context.Background(), path, raw, height); err == nil {
		t.Fatal("cached signature accepted under another reader chain")
	}
	r.migration.Network.ChainID = oldChain
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = r.verify(cancelled, path, raw, height); err == nil {
		t.Fatal("cancelled observation accepted")
	}

	fresh, err := newWorkloadDurableReader(migration, []string{path}, o)
	if err != nil {
		t.Fatal(err)
	}
	fresh.signatureFacts.verified = 1
	if err = fresh.configureNativeStreamingReplay(o); err == nil || fresh.signatureFacts == nil {
		t.Fatal("existing signature work discarded")
	}
	fresh, err = newWorkloadDurableReader(migration, []string{path}, o)
	if err != nil {
		t.Fatal(err)
	}
	fresh.slots[path].stats.Attempts = 1
	if err = fresh.configureNativeStreamingReplay(o); err == nil {
		t.Fatal("previously attempted reader reconfigured")
	}
}
func TestNativeStreamingLargeCurrentInputEvictsAndNeverFallsBackToStaleState(t *testing.T) {
	migration, first, tx, height, data := paddedCheckpointFixture(t)
	second := filepath.Join(t.TempDir(), "second-checkpoint")
	if err := os.WriteFile(second, data, 0600); err != nil {
		t.Fatal(err)
	}
	// Retain the normal writer lease for both independent stores.
	if _, err := consensus.NewBlockJournaledApplication(migration, second); err != nil {
		t.Fatal(err)
	}
	o := nativeStreamingOptions()
	r, err := newWorkloadDurableReader(migration, []string{first, second}, o)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.configureNativeStreamingReplay(o); err != nil {
		t.Fatal(err)
	}
	one, err := r.verify(context.Background(), first, tx, height)
	if err != nil {
		t.Fatal(err)
	}
	two, err := r.verify(context.Background(), second, tx, height)
	if err != nil || one.AppHash != two.AppHash || one.SnapshotSHA256 != two.SnapshotSHA256 {
		t.Fatal("bounded native state differs", err)
	}
	back, err := r.verify(context.Background(), first, tx, height)
	if err != nil || back.SnapshotCacheHit || back.AppHash != one.AppHash {
		t.Fatal("evicted state did not revalidate", err)
	}
	actual := r.stats()
	if actual.ReaderBudget == nil || actual.ReaderBudget.Evictions != 2 || actual.ReaderBudget.CachedInputBytes > 32<<20 || actual.PrefixReplay.CanonicalByteLimit != 32<<20 || actual.ObserverNativeFacts.FallbackMathVerifications != 3 || actual.ObserverNativeFacts.FallbackFailures != 0 {
		t.Fatal("actual bounded input/fallback facts differ", actual)
	}
	if err = os.WriteFile(first, data[:len(data)-1], 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = r.verify(context.Background(), first, tx, height); err == nil {
		t.Fatal("truncated current input borrowed old prefix state")
	}
	if err = os.WriteFile(first, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = r.verify(context.Background(), first, tx, height); err != nil {
		t.Fatal("restored current input failed", err)
	}
	restarted, err := newWorkloadDurableReader(migration, []string{first}, o)
	if err != nil {
		t.Fatal(err)
	}
	if err = restarted.configureNativeStreamingReplay(o); err != nil {
		t.Fatal(err)
	}
	got, err := restarted.verify(context.Background(), first, tx, height)
	if err != nil || got.AppHash != one.AppHash {
		t.Fatal("fresh restart changed actual state", err)
	}
	if err = os.Rename(first+".read.lock", first+".read.lock.saved"); err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.verify(context.Background(), first, tx, height); err == nil || !strings.Contains(err.Error(), "read.lock") {
		t.Fatal("normal writer lease bypassed", err)
	}
	t.Logf("actual validated native checkpoint with synthetic whitespace input_bytes=%d; no large-history TPS or quorum claimed", len(data))
}
func TestNativeStreamingRealExecutionNonceEvidenceAndRecovery(t *testing.T) {
	testStreamingWorkloadRealExecution(t, true, true)
}

func TestNativeStreamingActualEightWorkersKeepUnknownAccountQuarantined(t *testing.T) {
	path, manifest, m, migration, initial := senderFixture(t, 16)
	o := nativeStreamingOptions()
	o.rounds = 2
	o.output = filepath.Join(t.TempDir(), "gate-only-result")
	limits, err := workloadLimits(o)
	if err != nil {
		t.Fatal(err)
	}
	p, err := loadSenderPoolWithLimits(path, manifest, m, migration, initial, o.rounds, limits)
	if err != nil {
		t.Fatal(err)
	}
	if err = claimSenderPool(path); err != nil {
		t.Fatal(err)
	}
	o.pacedWorkerInventory = new(pacedWorkerInventory)
	o.submissionOccupancy = new(submissionOccupancyRecorder)
	o.evidenceBudget = &readyEvidenceBudgetReport{LimitBytes: o.evidenceByteBudget}
	o.terminalSink = func(transactionResult) error { return nil }
	txs := make([]cmt.Tx, len(initial))
	results := make([]transactionResult, len(initial))
	var attempts [32]atomic.Int32
	var observed [32]atomic.Int32
	ready := make(chan struct{}, 32)
	release := make(chan struct{})
	done := make(chan struct{})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var stats readySenderStats
	var runErr error
	go func() {
		defer close(done)
		stats, runErr = runReadySenderPool(ctx, o, p, txs, results, func(index int) (time.Time, bool) {
			global := results[index].Index
			attempts[global].Add(1)
			ready <- struct{}{}
			select {
			case <-release:
			case <-ctx.Done():
				return time.Time{}, false
			}
			began := time.Now()
			if global == 5 {
				results[index].Status = "submission_unknown"
				return began, false
			}
			return began, true
		}, func(_ int, queue <-chan acceptedObservation, terminal func(int)) {
			for job := range queue {
				index := job.index
				previous := results[index]
				observed[previous.Index].Add(1)
				row := gateResult(txs[index], int64(previous.Round+100))
				row.Index, row.Round = previous.Index, previous.Round
				row.OfferedAt, row.offerMonotonic = previous.OfferedAt, previous.offerMonotonic
				row.QueueDelayMs, row.SignedTransaction = previous.QueueDelayMs, previous.SignedTransaction
				results[index] = row
				terminal(index)
			}
		})
	}()
	for i := 0; i < 8; i++ {
		select {
		case <-ready:
		case <-ctx.Done():
			close(release)
			<-done
			t.Fatal("eight real submit callbacks did not reach gate")
		}
	}
	if o.submissionOccupancy.active.Load() != 8 || o.submissionOccupancy.peak.Load() != 8 {
		close(release)
		<-done
		t.Fatal("actual streaming worker occupancy differs")
	}
	close(release)
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("worker shutdown failed")
	}
	if runErr == nil || runErr.Error() != "ready sender run incomplete; quarantined inputs are never retried" || stats.Completed != 30 || stats.Prepared != 31 || stats.Offered != 31 || stats.Quarantined != 1 || attempts[5].Load() != 1 || attempts[21].Load() != 0 || observed[5].Load() != 0 || observed[21].Load() != 0 {
		t.Fatal("UNKNOWN account retried/advanced/observed", stats, runErr)
	}
	for i := range attempts {
		if i == 21 {
			continue
		}
		if attempts[i].Load() != 1 {
			t.Fatal("original index duplicated/lost", i)
		}
		wantObserved := int32(1)
		if i == 5 {
			wantObserved = 0
		}
		if observed[i].Load() != wantObserved {
			t.Fatal("original accepted observation duplicated/lost", i)
		}
	}
	inventory := o.pacedWorkerInventory
	if inventory.Submitters != 8 || inventory.Observers != 4 || inventory.SubmissionQueueCapacity != 16 {
		t.Fatal("actual original stream queues differ", inventory)
	}
	for _, capacity := range inventory.ObservationQueueCapacities {
		if capacity != 16 {
			t.Fatal("observation queue enlarged")
		}
	}
	occupancy := o.submissionOccupancy.snapshot(time.Second)
	if occupancy.CallbackStarted != 31 || occupancy.CallbackReturned != 31 || occupancy.ActiveCallbacksAtEnd != 0 || occupancy.PeakActiveCallbacks != 8 || occupancy.QueueWaitSamples != 31 {
		t.Fatal("actual callback accounting differs", occupancy)
	}
	t.Logf("actual started=%d returned=%d active=%d peak=%d UNKNOWNattempt=%d successor21=%d unknownObserved=%d completed=%d quarantined=%d expectedIncomplete=%q; unit observation gates, no network business TPS", occupancy.CallbackStarted, occupancy.CallbackReturned, occupancy.ActiveCallbacksAtEnd, occupancy.PeakActiveCallbacks, attempts[5].Load(), attempts[21].Load(), observed[5].Load(), stats.Completed, stats.Quarantined, runErr.Error())
}

func TestNativeStreamingDurablePlanBindsActualModeAndPreservesLegacy(t *testing.T) {
	_, manifest, m, _, initial := senderFixture(t)
	o := nativeStreamingOptions()
	o.output = filepath.Join(t.TempDir(), "native-stream-plan")
	path, _, err := persistStreamingWorkloadPlan(o, manifest, m, initial)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var plan streamingWorkloadPlan
	if err = json.Unmarshal(raw, &plan); err != nil {
		t.Fatal(err)
	}
	if plan.Profile != "scoped_native_prefix_stream8_v1" || plan.NativePrefix == nil || plan.NativePrefix.Submitters != 8 || plan.NativePrefix.Observers != 4 || plan.NativePrefix.CanonicalByteLimit != 32<<20 || !plan.NativePrefix.ObserverNativeFacts || !plan.NativePrefix.OriginalSuffixSetup || !plan.NativePrefix.SerializedReaderBudget {
		t.Fatal("native mode/resource scope not durably bound", plan)
	}
	if _, _, err = persistStreamingWorkloadPlan(o, manifest, m, initial); err == nil {
		t.Fatal("existing durable plan overwritten")
	}
	legacy := streamingOptions()
	legacy.output = filepath.Join(t.TempDir(), "legacy-stream-plan")
	path, _, err = persistStreamingWorkloadPlan(legacy, manifest, m, initial)
	if err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var old streamingWorkloadPlan
	if err = json.Unmarshal(raw, &old); err != nil {
		t.Fatal(err)
	}
	if old.Profile != "scoped_streaming_v1" || old.NativePrefix != nil || strings.Contains(string(raw), "nativePrefix") {
		t.Fatal("legacy plan schema changed")
	}
}
