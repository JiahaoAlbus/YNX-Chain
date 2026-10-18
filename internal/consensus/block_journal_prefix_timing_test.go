package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	abci "github.com/cometbft/cometbft/abci/types"
	"os"
	"testing"
	"time"
)

func TestBlockJournalPrefixPhaseTimingPreservesBytesAndMeasuresActualBranches(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	timed, err := NewBlockJournalPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := NewBlockJournalPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	appendBlock := func(n uint64) []byte {
		t.Helper()
		r, e := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(n), Time: time.Unix(1802736000+int64(n), 0), Txs: [][]byte{journalTransfer(t, n)}})
		if e != nil || r.TxResults[0].Code != 0 {
			t.Fatal(e)
		}
		if _, e = app.Commit(context.Background(), &abci.RequestCommit{}); e != nil {
			t.Fatal(e)
		}
		b, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	first := appendBlock(1)
	cold, err := timed.DecodeWithPhaseTiming(context.Background(), first)
	if err != nil {
		t.Fatal(err)
	}
	base, err := plain.Decode(context.Background(), first)
	if err != nil {
		t.Fatal(err)
	}
	if base.WorkPhases != nil || !bytes.Equal(cold.SnapshotJSON, base.SnapshotJSON) {
		t.Fatal("timing changed default output")
	}
	if cold.WorkPhases == nil || cold.WorkPhases.GateWait.Calls != 1 || cold.WorkPhases.FullReplay.Calls != 1 || cold.WorkPhases.PrivateJSON.Calls != 0 || cold.WorkPhases.CertificatePublish.Calls != 1 {
		t.Fatalf("cold actual phases: %+v", cold.WorkPhases)
	}
	same, err := timed.DecodeWithPhaseTiming(context.Background(), first)
	if err != nil {
		t.Fatal(err)
	}
	p := same.WorkPhases
	exactPhases := *p
	if p.GateWait.Calls != 1 || p.PrefixCheck.Calls != 1 || p.PrivateJSON.Calls != 1 || p.PrivateValidate.Calls != 1 || p.CanonicalCopy.Calls != 1 || p.FullReplay.Calls != 0 || p.SuffixReplay.Calls != 0 || p.CertificatePublish.Calls != 0 {
		t.Fatalf("exact input actual phases: %+v", p)
	}
	if !bytes.Equal(same.SnapshotJSON, base.SnapshotJSON) || same.ReplayedBlocks != 0 {
		t.Fatal("timed exact input bytes/work changed")
	}
	p.PrivateJSON.Calls = 999 // Caller mutation must not touch another call's timing.
	next := appendBlock(2)
	suffix, err := timed.DecodeWithPhaseTiming(context.Background(), next)
	if err != nil {
		t.Fatal(err)
	}
	p = suffix.WorkPhases
	if p.PrivateJSON.Calls != 1 || p.PrivateValidate.Calls != 1 || p.SuffixSetup.Calls != 1 || p.SuffixReplay.Calls != 1 || p.SuffixEncode.Calls != 1 || p.CertificatePublish.Calls != 1 || p.CanonicalCopy.Calls != 0 || suffix.ReplayedBlocks != 1 || suffix.ReplayedTransactionInputs != 1 {
		t.Fatalf("actual suffix phases/work: %+v", p)
	}
	full, err := DecodeBlockJournal(context.Background(), next, migration)
	if err != nil || !bytes.Equal(full.SnapshotJSON, suffix.SnapshotJSON) {
		t.Fatal("timed suffix differs from original full replay", err)
	}
	for name, phases := range map[string]*BlockJournalPrefixWorkPhases{"cold": cold.WorkPhases, "identical": &exactPhases, "suffix": suffix.WorkPhases} {
		raw, _ := json.Marshal(*phases)
		t.Logf("LOCAL_REAL_SIGNED_PREFIX_PHASES %s %s", name, raw)
	}
	timed.prefix.payload = []byte("bad cached JSON")
	bad, err := timed.DecodeWithPhaseTiming(context.Background(), next)
	if err == nil || bad.WorkPhases.PrivateJSON.Errors != 1 || bad.WorkPhases.PrivateValidate.Calls != 0 || bad.WorkPhases.FullReplay.Calls != 0 {
		t.Fatal("failed private decode lost actual phase/error", err, bad.WorkPhases)
	}
}

func TestBlockJournalPrefixPhaseTimingCancellationAccountsHeldGateWait(t *testing.T) {
	migration, path := journalFixture(t)
	if _, err := NewBlockJournaledApplication(migration, path); err != nil {
		t.Fatal(err)
	}
	d, err := NewBlockJournalPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	<-d.gate
	ctx, cancel := context.WithCancel(context.Background())
	observed := &prefixGateObservedContext{Context: ctx, reached: make(chan struct{})}
	type outcome struct {
		result BlockJournalPrefixReadback
		err    error
	}
	done := make(chan outcome, 1)
	go func() { r, e := d.DecodeWithPhaseTiming(observed, raw); done <- outcome{r, e} }()
	<-observed.reached
	cancel()
	got := <-done
	d.gate <- struct{}{}
	if !errors.Is(got.err, context.Canceled) || got.result.WorkPhases == nil {
		t.Fatal("lost cancelled wait", got.err)
	}
	p := got.result.WorkPhases
	if p.GateWait.Calls != 1 || p.GateWait.Errors != 1 || p.GateWait.DurationNs <= 0 || p.PrefixCheck.Calls != 0 || p.FullReplay.Calls != 0 {
		t.Fatalf("cancelled gate performed replay or lost timing: %+v", p)
	}
}
