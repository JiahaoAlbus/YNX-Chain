package main

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmt "github.com/cometbft/cometbft/types"
)

// Synthetic finality flags test storage/ownership, not actual BFT throughput.
// The shared real execution/restart test exercises both retention modes too.
func TestReadySenderSlotsRecycleAcrossAllBoundedCycles(t *testing.T) {
	path, manifest, m, migration, initial := senderFixture(t)
	p, err := loadSenderPool(path, manifest, m, migration, initial, 32)
	if err != nil {
		t.Fatal(err)
	}
	stream, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), p)
	if err != nil {
		t.Fatal(err)
	}
	count := len(initial)
	results := readyResults(count)[:count]
	txs := make([]cmt.Tx, count)
	seen := make(map[int]string)
	sink := func(r transactionResult) error {
		if _, exists := seen[r.Index]; exists {
			t.Error("terminal identity reused")
		}
		raw, e := base64.StdEncoding.DecodeString(r.SignedTransaction)
		if e != nil {
			t.Error(e)
			return e
		}
		tx, e := consensus.DecodeSignedTransaction(raw)
		if e != nil {
			t.Error(e)
			return e
		}
		if e = tx.Verify(migration.Network.ChainID); e != nil {
			t.Error(e)
			return e
		}
		if tx.Nonce != uint64(r.Round) || r.Round != r.Index/count+1 {
			t.Error("slot generation changed transaction identity")
		}
		seen[r.Index] = r.Hash
		return stream.append(r)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	stats, err := runReadySenderPool(ctx, options{rounds: 32, offeredRate: 2048, concurrency: 4, observers: 4, reuseResultSlots: true, terminalSink: sink}, p, txs, results,
		func(slot int) (time.Time, bool) {
			if slot < 0 || slot >= count {
				t.Error("job outside fixed slot array")
			}
			journal, e := os.ReadFile(filepath.Join(p.root, readySenderJournalName))
			if e != nil {
				t.Error(e)
				return time.Time{}, false
			}
			if len(journal) == 0 {
				t.Error("missing durable intent before submission")
			}
			now := time.Now()
			at := now.UTC()
			results[slot].SubmittedAt, results[slot].submitMonotonic = &at, now
			return now, true
		},
		func(_ int, queue <-chan acceptedObservation, terminal func(int)) {
			for job := range queue {
				slot := job.index
				previous := results[slot]
				gate := gateResult(txs[slot], int64(previous.Round+1))
				gate.Index, gate.Round = previous.Index, previous.Round
				gate.SignedTransaction = previous.SignedTransaction
				gate.OfferedAt, gate.offerMonotonic = previous.OfferedAt, previous.offerMonotonic
				gate.SubmittedAt, gate.submitMonotonic = previous.SubmittedAt, previous.submitMonotonic
				gate.QueueDelayMs = previous.QueueDelayMs
				results[slot] = gate
				terminal(slot)
			}
		})
	if err != nil || stats.Completed != count*32 || stats.RoundsCompleted != 32 || stats.PeakInFlight > count || len(seen) != count*32 || len(results) != count || len(txs) != count {
		t.Fatal("slot lifetime storage/counters differ", stats, err)
	}
	if stats.BoundedSummary == nil || stats.BoundedSummary.TerminalRecords != count*32 || stats.BoundedSummary.Counts.Input != count*32 || stats.BoundedSummary.Counts.Submitted != count*32 || stats.BoundedSummary.Counts.FinalSubmitted != count*32 || stats.BoundedSummary.Counts.NotSubmitted != 0 {
		t.Fatal("cumulative summary counted only the last slot generation", stats.BoundedSummary)
	}
	if err = stream.close(); err != nil || stream.report.DurableRecords != count*32 {
		t.Fatal("terminal evidence lost", err, stream.report)
	}
	restored, err := readCompletedTerminalResults(stream.report.Directory, stream.report, stream.binding, count, count*32)
	if err != nil || len(restored) != count*32 {
		t.Fatal("full history not recoverable from fixed slots", err)
	}
	for index, r := range restored {
		if r.Index != index || r.Hash != seen[index] {
			t.Fatal("restored identity differs from original terminal handoff")
		}
	}
	for slot, r := range results {
		if r.Index != 31*count+slot || r.Round != 32 {
			t.Fatal("last generation differs", r)
		}
	}
}

func TestReadySenderSlotsRejectMissingTerminalSinkBeforeJournalOrDispatch(t *testing.T) {
	p := terminalFixture(t)
	_, err := runReadySenderPool(context.Background(), options{rounds: 2, offeredRate: 128, concurrency: 1, observers: 1, reuseResultSlots: true}, p, make([]cmt.Tx, len(p.pending)), readyResults(len(p.pending))[:len(p.pending)], func(int) (time.Time, bool) { t.Error("dispatched without evidence sink"); return time.Time{}, false }, func(int, <-chan acceptedObservation, func(int)) { t.Error("observer launched before validation") })
	if err == nil {
		t.Fatal("slot reuse accepted without evidence sink")
	}
	if _, err = os.Stat(filepath.Join(p.root, readySenderJournalName)); !os.IsNotExist(err) {
		t.Fatal("invalid plan created or reused a journal", err)
	}
}

func TestReadySenderSlotsQuarantineUnknownWithoutBlockingOtherAccounts(t *testing.T) {
	p := terminalFixture(t)
	count := len(p.pending)
	txs := make([]cmt.Tx, count)
	results := readyResults(count)[:count]
	stream, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), p)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	stats, err := runReadySenderPool(ctx, options{rounds: 2, offeredRate: 2048, concurrency: 4, observers: 4, reuseResultSlots: true, terminalSink: stream.append}, p, txs, results,
		func(slot int) (time.Time, bool) {
			if slot == 0 {
				results[slot].Status = "submission_unknown"
				return time.Now(), false
			}
			return time.Now(), true
		},
		func(_ int, queue <-chan acceptedObservation, terminal func(int)) {
			for job := range queue {
				prior := results[job.index]
				gate := gateResult(txs[job.index], int64(prior.Round+1))
				gate.Index, gate.Round = prior.Index, prior.Round
				gate.SignedTransaction = prior.SignedTransaction
				results[job.index] = gate
				terminal(job.index)
			}
		})
	if err == nil || stats.Completed != (count-1)*2 || stats.Quarantined != 1 || stats.Offered != (count-1)*2+1 || p.templates[0].Nonce != 1 {
		t.Fatal("UNKNOWN retried or peers blocked", stats, err)
	}
	if err = stream.close(); err != nil || stream.report.DurableRecords != (count-1)*2+1 {
		t.Fatal("uncertain terminal result lost", err)
	}
	for i := 1; i < count; i++ {
		if p.templates[i].Nonce != 2 {
			t.Fatal("healthy account failed to advance")
		}
	}
}
