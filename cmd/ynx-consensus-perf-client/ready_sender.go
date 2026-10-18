package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmttypes "github.com/cometbft/cometbft/types"
)

const readySenderJournalName = "sender-ready.signed.jsonl"

type readySenderEnvelope struct {
	Index       int         `json:"index"`
	Sender      int         `json:"sender"`
	Round       int         `json:"round"`
	Hash        string      `json:"hash"`
	Transaction cmttypes.Tx `json:"transaction"`
}

type readySenderJournalHeader struct {
	Kind           string `json:"kind"`
	ManifestSHA256 string `json:"manifestSha256"`
	MigrationHash  string `json:"migrationHash"`
	GenesisHash    string `json:"genesisHash"`
}

type readyInputJournal interface {
	append([]readySenderEnvelope) error
	close() error
	durableBytes() int64
}

func (j *readySenderJournal) close() error        { return j.file.Close() }
func (j *readySenderJournal) durableBytes() int64 { return int64(j.bytes) }

type readySenderJournal struct {
	file interface {
		io.Writer
		Sync() error
		Close() error
	}
	poisoned       bool
	records, bytes int
}

func newReadySenderJournal(p *ephemeralSenderPool) (*readySenderJournal, error) {
	f, err := os.OpenFile(filepath.Join(p.root, readySenderJournalName), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	j := &readySenderJournal{file: f}
	header, err := json.Marshal(readySenderJournalHeader{"YNX_LOCAL_READY_SENDER_V1", p.manifestSHA256, p.migrationHash, p.genesisHash})
	if err == nil {
		err = j.writeAndSync(append(header, '\n'))
	}
	if err == nil {
		var dir *os.File
		dir, err = os.Open(p.root)
		if err == nil {
			err = errors.Join(dir.Sync(), dir.Close())
		}
	}
	if err != nil {
		j.poisoned = true
		_ = f.Close()
		return nil, err
	}
	return j, nil
}

func (j *readySenderJournal) writeAndSync(raw []byte) error {
	if j.poisoned {
		return errors.New("ready sender journal poisoned; preserve and reconcile only")
	}
	n, err := j.file.Write(raw)
	if err == nil && n != len(raw) {
		err = io.ErrShortWrite
	}
	if err == nil {
		err = j.file.Sync()
	}
	if err != nil {
		j.poisoned = true
		return err
	}
	j.bytes += len(raw)
	return nil
}

// One durable append for the currently ready wave, at most 64 envelopes. This
// is an identity journal, never a recovery/resubmission queue. Any I/O error
// permanently poisons the writer, and no member of that wave is dispatched.
func (j *readySenderJournal) append(envelopes []readySenderEnvelope) error {
	if len(envelopes) < 1 || len(envelopes) > 64 || j.records+len(envelopes) > maxTransactions {
		return errors.New("ready journal record bound")
	}
	var raw []byte
	for _, e := range envelopes {
		b, err := json.Marshal(e)
		if err != nil {
			return err
		}
		raw = append(raw, b...)
		raw = append(raw, '\n')
	}
	if j.bytes+len(raw) > 8<<20 {
		return errors.New("ready journal byte bound")
	}
	if err := j.writeAndSync(raw); err != nil {
		return err
	}
	j.records += len(envelopes)
	return nil
}

func (p *ephemeralSenderPool) nextForSender(sender int, prior transactionResult) (cmttypes.Tx, error) {
	return p.nextForSenderMeasured(sender, prior, nil)
}

func (p *ephemeralSenderPool) nextForSenderMeasured(sender int, prior transactionResult, supply *readySupplyStats) (cmttypes.Tx, error) {
	if p.stopped || sender < 0 || sender >= len(p.pending) {
		return nil, errors.New("sender pool stopped or sender outside pool")
	}
	if err := verifySenderRound([]cmttypes.Tx{p.pending[sender]}, []transactionResult{prior}); err != nil {
		return nil, err
	}
	template := p.templates[sender]
	limit := p.nonceLimit
	if limit == 0 {
		limit = 32
	}
	if template.Nonce >= limit {
		return nil, errors.New("ready sender nonce bound")
	}
	started := time.Now()
	tx, err := consensus.NewSignedTransfer(p.keys[sender], template.ChainID, template.To, template.Amount, template.Nonce+1)
	if supply != nil {
		supply.SignAttempts++
		supply.SignNs += time.Since(started).Nanoseconds()
	}
	if err != nil {
		return nil, err
	}
	started = time.Now()
	raw, err := consensus.EncodeSignedTransaction(tx)
	if supply != nil {
		supply.EncodeAttempts++
		supply.EncodeNs += time.Since(started).Nanoseconds()
		if err == nil {
			supply.SignedSuccessors++
		}
	}
	return raw, err
}

// Controller-owned sums of actual calls, including failed attempts. Initial
// fixture signatures precede the run and are not included as successor signing.
// Journal append includes JSON encoding, write and Sync; it is not pure disk I/O.
// CompletionWait measures only the controller's terminal-channel wait, excluding
// consume/verification/terminalSink. It is not an internal consensus timer.
// TerminalSink measures the complete evidence callback, not pure file Sync.
type readySupplyStats struct {
	CompletionWaitAttempts        int   `json:"completionWaitAttempts"`
	CompletionWaitNs              int64 `json:"completionWaitNs"`
	CompletionSupplyWaitAttempts  int   `json:"completionSupplyWaitAttempts"`
	CompletionSupplyWaitNs        int64 `json:"completionSupplyWaitNs"`
	CompletionDrainWaitAttempts   int   `json:"completionDrainWaitAttempts"`
	CompletionDrainWaitNs         int64 `json:"completionDrainWaitNs"`
	CompletionFailureWaitAttempts int   `json:"completionFailureWaitAttempts"`
	CompletionFailureWaitNs       int64 `json:"completionFailureWaitNs"`
	TerminalSinkAttempts          int   `json:"terminalSinkAttempts"`
	TerminalSinkNs                int64 `json:"terminalSinkNs"`
	OfferDecodeAttempts           int   `json:"offerDecodeAttempts"`
	OfferDecodeNs                 int64 `json:"offerDecodeNs"`
	PacingWaitAttempts            int   `json:"pacingWaitAttempts"`
	PacingWaitNs                  int64 `json:"pacingWaitNs"`
	PacingFutureTargetAttempts    int   `json:"pacingFutureTargetAttempts"`
	PacingAlreadyDueAttempts      int   `json:"pacingAlreadyDueAttempts"`
	PacingPositiveRemainingNs     int64 `json:"pacingPositiveRemainingNs"`
	PacingWakeLatenessNs          int64 `json:"pacingWakeLatenessNs"`
	PacingMaxWakeLatenessNs       int64 `json:"pacingMaxWakeLatenessNs"`
	PacingCatchupTargets          int   `json:"pacingCatchupTargets"`
	PacingCadenceResets           int   `json:"pacingCadenceResets"`
	PacingPeakCatchupTargets      int   `json:"pacingPeakCatchupTargets"`
	DispatchAttempts              int   `json:"dispatchAttempts"`
	DispatchNs                    int64 `json:"dispatchNs"`
	SignAttempts                  int   `json:"signAttempts"`
	SignNs                        int64 `json:"signNs"`
	EncodeAttempts                int   `json:"encodeAttempts"`
	EncodeNs                      int64 `json:"encodeNs"`
	SignedSuccessors              int   `json:"signedSuccessors"`
	JournalSetupNs                int64 `json:"journalSetupNs"`
	JournalAppendAttempts         int   `json:"journalAppendAttempts"`
	JournalAppendNs               int64 `json:"journalAppendNs"`
	JournalDurableEnvelopes       int   `json:"journalDurableEnvelopes"`
	JournalDurableBytes           int   `json:"journalDurableBytes"`
}

type readySenderStats struct {
	EvidenceBudget  *readyEvidenceBudgetReport `json:"evidenceBudget,omitempty"`
	IntentSegments  *readyIntentSegmentReport  `json:"intentSegments,omitempty"`
	Supply          readySupplyStats           `json:"supply"`
	Prepared        int                        `json:"prepared"`
	Offered         int                        `json:"offered"`
	Completed       int                        `json:"completed"`
	Quarantined     int                        `json:"quarantinedAccounts"`
	PeakInFlight    int                        `json:"peakInFlightAccounts"`
	RoundsCompleted int                        `json:"roundsCompleted"`
	Queues          pacedStatistics            `json:"queues"`
	BoundedSummary  *readyCumulativeReport     `json:"boundedSummary,omitempty"`
}

// This controller alone signs/advances account state. Submitters and observers
// own result fields until terminal(index) hands them back through a channel.
// There is one reserved/in-flight nonce per sender, with no whole-round barrier.
// Unknown/rejected/failed/timed-out senders are quarantined while peers continue.
func runReadySenderPool(ctx context.Context, o options, p *ephemeralSenderPool, txs []cmttypes.Tx, results []transactionResult, submit func(int) (time.Time, bool), observe func(int, <-chan acceptedObservation, func(int))) (stats readySenderStats, runErr error) {
	if _, err := normalizeReadyPacingMode(o.pacingMode); err != nil {
		return stats, err
	}
	limits, limitErr := workloadLimits(o)
	if limitErr != nil {
		return stats, limitErr
	}
	if p == nil || p.stopped || o.rounds < 2 || o.rounds > limits.rounds || !(o.offeredRate > 0) || o.offeredRate > maxTransactions || o.observers < 1 || o.observers > 4 || o.concurrency < 1 || o.concurrency > 4 || len(p.pending) == 0 || len(p.pending) > maxTransactions || len(txs) != len(results) || o.rounds > limits.records/len(p.pending) {
		return stats, errors.New("invalid bounded ready sender plan")
	}
	pacer, pacingErr := newReadyOfferPacer(o.pacingMode, time.Time{}, time.Duration(float64(time.Second)/o.offeredRate))
	if pacingErr != nil {
		return stats, pacingErr
	}
	if o.streamingWorkload && (o.evidenceBudget == nil || o.evidenceBudget.LimitBytes != o.evidenceByteBudget || o.evidenceBudget.Poisoned) {
		return stats, errors.New("streaming workload lacks shared evidence budget")
	}
	nonceLimit := p.nonceLimit
	if nonceLimit == 0 {
		nonceLimit = 32
	}
	if uint64(o.rounds) > nonceLimit {
		return stats, errors.New("sender pool nonce scope differs from workload")
	}
	stats.EvidenceBudget = o.evidenceBudget
	senders := len(p.pending)
	expectedStorage := senders * o.rounds
	if o.reuseResultSlots {
		expectedStorage = senders
		if o.terminalSink == nil {
			return stats, errors.New("slot reuse requires a terminal evidence sink")
		}
	}
	if len(results) != expectedStorage {
		return stats, errors.New("invalid ready sender storage size")
	}
	storageIndex := func(global int) int {
		if o.reuseResultSlots {
			return global % senders
		}
		return global
	}
	resultGeneration := func(index int) int {
		if o.reuseResultSlots {
			return results[index].Index
		}
		return index
	}
	if o.reuseResultSlots {
		cumulative, err := newReadyCumulativeSummary(senders * o.rounds)
		if err != nil {
			return stats, err
		}
		started := time.Now()
		cumulative.timeline = &readyTimeSeries{start: started}
		originalSink := o.terminalSink
		o.terminalSink = func(r transactionResult) error {
			// Preserve observed counts even if evidence output fails; that error
			// still stops signing. Counts are not a claim of stream durability.
			bound := r.Hash == fmt.Sprintf("%X", txs[storageIndex(r.Index)].Hash())
			return errors.Join(originalSink(r), cumulative.add(r, bound))
		}
		defer func() { stats.BoundedSummary = cumulative.snapshot(time.Since(started).Seconds()) }()
	}
	defer func() { p.stopped = true }()
	if o.segmentedIntents && (!o.reuseResultSlots || o.terminalSink == nil) {
		return stats, errors.New("segmented intents require slot retention and terminal evidence")
	}
	journalStarted := time.Now()
	var journal readyInputJournal
	var err error
	if o.segmentedIntents {
		var segmented *readyIntentSegments
		segmented, err = newReadyIntentSegments(filepath.Join(p.root, readyIntentSegmentsName), p, senders*o.rounds, limits.intentBytes)
		if err == nil {
			if o.intentPersistence != nil {
				segmented.persist = o.intentPersistence
			}
			if o.evidenceBudget != nil {
				segmented.persist = o.evidenceBudget.persist(segmented.persist)
			}
			journal = segmented
			stats.IntentSegments = &segmented.report
		}
	} else {
		journal, err = newReadySenderJournal(p)
	}
	stats.Supply.JournalSetupNs = time.Since(journalStarted).Nanoseconds()
	if err != nil {
		return stats, err
	}
	defer func() { runErr = errors.Join(runErr, journal.close()) }()
	jobs := make(chan int, len(results))
	type completion struct{ index, generation int }
	terminal := make(chan completion, len(results))
	accepted := make([]chan acceptedObservation, o.observers)
	var submitters, observers sync.WaitGroup
	var pendingSubmit, peakSubmit, pendingObserve, peakObserve atomic.Int64
	for worker := range accepted {
		accepted[worker] = make(chan acceptedObservation, len(results))
		observers.Add(1)
		go func(worker int) {
			defer observers.Done()
			observe(worker, accepted[worker], func(index int) {
				pendingObserve.Add(-1)
				terminal <- completion{index, resultGeneration(index)}
			})
		}(worker)
	}
	for worker := 0; worker < o.concurrency; worker++ {
		submitters.Add(1)
		go func() {
			defer submitters.Done()
			for index := range jobs {
				generation := resultGeneration(index)
				pendingSubmit.Add(-1)
				started, ok := submit(index)
				if !started.IsZero() {
					delay := started.Sub(results[index].offerMonotonic).Seconds() * 1000
					results[index].QueueDelayMs = &delay
				}
				if ok {
					atomicMaximum(&peakObserve, pendingObserve.Add(1))
					accepted[index%o.observers] <- acceptedObservation{index, started}
				} else {
					terminal <- completion{index, generation}
				}
			}
		}()
	}
	closed := false
	stopSubmitting := func() {
		if closed {
			return
		}
		closed = true
		close(jobs)
		submitters.Wait()
		for _, queue := range accepted {
			close(queue)
		}
	}
	ready := make([]int, senders)
	for i := range ready {
		ready[i] = i
	}
	last := make([]int, senders)
	for i := range last {
		last[i] = -1
	}
	inFlight := make([]bool, senders)
	completedRound := make([]int, senders)
	active := 0
	consume := func(event completion) {
		index := event.index
		if index < 0 || index >= len(results) {
			runErr = errors.Join(runErr, errors.New("completion outside result storage"))
			return
		}
		sender := index % senders
		if !inFlight[sender] || last[sender] != event.generation || (o.reuseResultSlots && results[index].Index != event.generation) {
			runErr = errors.Join(runErr, errors.New("unexpected sender completion"))
			return
		}
		active--
		inFlight[sender] = false
		if o.terminalSink != nil {
			started := time.Now()
			err := o.terminalSink(results[index])
			stats.Supply.TerminalSinkAttempts++
			stats.Supply.TerminalSinkNs += time.Since(started).Nanoseconds()
			if err != nil {
				runErr = errors.Join(runErr, fmt.Errorf("terminal evidence: %w", err))
			}
		}
		if err := verifySenderRound([]cmttypes.Tx{txs[index]}, []transactionResult{results[index]}); err != nil {
			stats.Quarantined++
			return
		}
		stats.Completed++
		completedRound[sender] = event.generation/senders + 1
		if completedRound[sender] < o.rounds && ctx.Err() == nil && runErr == nil {
			ready = append(ready, sender)
		}
	}
	pacer.target = time.Now()
	for len(ready) > 0 || active > 0 {
		// Recycle completed senders promptly, even while other initial accounts
		// are still being offered. No first-round/global readiness barrier.
		draining := true
		for draining {
			select {
			case index := <-terminal:
				consume(index)
			default:
				draining = false
			}
		}
		if ctx.Err() != nil {
			runErr = errors.Join(runErr, ctx.Err())
			ready = nil
		}
		if runErr != nil {
			ready = nil
			stopSubmitting()
		}
		if len(ready) == 0 {
			if active == 0 {
				break
			}
			started := time.Now()
			var event completion
			// Classify at entry: final drain is not a supply stall, and closed
			// error cleanup has its own bucket. A deadline during the wait does
			// not retrospectively change which phase was actually entered.
			failureWait := closed || runErr != nil
			drainWait := !failureWait && stats.Offered == senders*o.rounds
			received := false
			if closed {
				event, received = <-terminal, true
			} else {
				select {
				case event = <-terminal:
					received = true
				case <-ctx.Done():
				}
			}
			stats.Supply.CompletionWaitAttempts++
			elapsed := time.Since(started).Nanoseconds()
			stats.Supply.CompletionWaitNs += elapsed
			switch {
			case failureWait:
				stats.Supply.CompletionFailureWaitAttempts++
				stats.Supply.CompletionFailureWaitNs += elapsed
			case drainWait:
				stats.Supply.CompletionDrainWaitAttempts++
				stats.Supply.CompletionDrainWaitNs += elapsed
			default:
				stats.Supply.CompletionSupplyWaitAttempts++
				stats.Supply.CompletionSupplyWaitNs += elapsed
			}
			if received {
				consume(event)
			} else {
				runErr = ctx.Err()
				stopSubmitting()
			}
			continue
		}
		waveCount := len(ready)
		if waveCount > 64 {
			waveCount = 64
		}
		wave := make([]readySenderEnvelope, 0, waveCount)
		for _, sender := range ready[:waveCount] {
			index := sender
			raw := p.pending[sender]
			if last[sender] >= 0 {
				index = last[sender] + senders
				raw, err = p.nextForSenderMeasured(sender, results[storageIndex(last[sender])], &stats.Supply)
			}
			if err != nil {
				runErr = err
				break
			}
			wave = append(wave, readySenderEnvelope{Index: index, Sender: sender, Round: index/senders + 1, Hash: fmt.Sprintf("%X", raw.Hash()), Transaction: raw})
		}
		ready = ready[waveCount:]
		if runErr == nil {
			started := time.Now()
			beforeBytes := journal.durableBytes()
			runErr = journal.append(wave)
			stats.Supply.JournalAppendAttempts++
			stats.Supply.JournalAppendNs += time.Since(started).Nanoseconds()
			if runErr == nil {
				stats.Supply.JournalDurableEnvelopes += len(wave)
				stats.Supply.JournalDurableBytes += int(journal.durableBytes() - beforeBytes)
			}
		}
		if runErr != nil {
			ready = nil
			continue
		}
		stats.Prepared += len(wave)
		for _, e := range wave {
			index := storageIndex(e.Index)
			if o.reuseResultSlots {
				// Only the controller owns the slot now: its previous terminal
				// result was handed to the sink before this successor was signed.
				results[index] = transactionResult{Index: e.Index, Round: e.Round, Endpoint: results[index].Endpoint, Status: "not_submitted", Errors: []errorObservation{}}
			}
			txs[index] = e.Transaction
			results[index].Hash, results[index].Bytes, results[index].SignedTransaction = e.Hash, len(e.Transaction), base64.StdEncoding.EncodeToString(e.Transaction)
			decodeStarted := time.Now()
			template, decodeErr := consensus.DecodeSignedTransaction(e.Transaction)
			stats.Supply.OfferDecodeAttempts++
			stats.Supply.OfferDecodeNs += time.Since(decodeStarted).Nanoseconds()
			if decodeErr != nil {
				runErr = decodeErr
				break
			}
			p.pending[e.Sender], p.templates[e.Sender] = e.Transaction, template
			paceStarted := time.Now()
			nextOffer := pacer.target
			futureTarget := nextOffer.After(paceStarted)
			if remaining := nextOffer.Sub(paceStarted).Nanoseconds(); remaining > 0 {
				stats.Supply.PacingFutureTargetAttempts++
				stats.Supply.PacingPositiveRemainingNs += remaining
			} else {
				stats.Supply.PacingAlreadyDueAttempts++
			}
			paceReady := waitUntil(ctx, nextOffer)
			paceFinished := time.Now()
			stats.Supply.PacingWaitAttempts++
			stats.Supply.PacingWaitNs += paceFinished.Sub(paceStarted).Nanoseconds()
			// Only future targets measure wake lateness. Already-overdue targets
			// include prior signing/journal work and must not inflate this scope.
			if late := paceFinished.Sub(nextOffer).Nanoseconds(); paceReady && futureTarget && late > 0 {
				stats.Supply.PacingWakeLatenessNs += late
				if late > stats.Supply.PacingMaxWakeLatenessNs {
					stats.Supply.PacingMaxWakeLatenessNs = late
				}
			}
			if !paceReady {
				runErr = ctx.Err()
				break
			}
			now := time.Now()
			at, due := now.UTC(), nextOffer.UTC()
			results[index].offerMonotonic = now
			results[index].OfferedAt, results[index].ScheduledAt = &at, &due
			inFlight[e.Sender], last[e.Sender] = true, e.Index
			active++
			stats.Offered++
			if active > stats.PeakInFlight {
				stats.PeakInFlight = active
			}
			atomicMaximum(&peakSubmit, pendingSubmit.Add(1))
			dispatchStarted := time.Now()
			jobs <- index
			stats.Supply.DispatchAttempts++
			stats.Supply.DispatchNs += time.Since(dispatchStarted).Nanoseconds()
			catchup, reset := pacer.advance(now)
			if catchup {
				stats.Supply.PacingCatchupTargets++
			}
			if reset {
				stats.Supply.PacingCadenceResets++
			}
			if pacer.catchups > stats.Supply.PacingPeakCatchupTargets {
				stats.Supply.PacingPeakCatchupTargets = pacer.catchups
			}
		}
	}
	stopSubmitting()
	observers.Wait()
	stats.Queues = pacedStatistics{peakSubmit.Load(), peakObserve.Load()}
	if o.reuseResultSlots {
		stats.RoundsCompleted = o.rounds
		for _, round := range completedRound {
			if round < stats.RoundsCompleted {
				stats.RoundsCompleted = round
			}
		}
	} else {
		// Retain the existing complete-history final check on the default path.
		for round := 0; round < o.rounds; round++ {
			if verifySenderRound(txs[round*senders:(round+1)*senders], results[round*senders:(round+1)*senders]) != nil {
				break
			}
			stats.RoundsCompleted++
		}
	}
	if stats.Completed != senders*o.rounds && runErr == nil {
		runErr = errors.New("ready sender run incomplete; quarantined inputs are never retried")
	}
	return stats, runErr
}
