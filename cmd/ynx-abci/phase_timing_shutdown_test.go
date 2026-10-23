package main

import (
	"bytes"
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"sync"
	"testing"
	"time"
)

type heldPhaseCheck struct {
	abci.Application
	entered, release chan struct{}
	once             sync.Once
}

func (a *heldPhaseCheck) CheckTx(ctx context.Context, req *abci.RequestCheckTx) (*abci.ResponseCheckTx, error) {
	a.once.Do(func() { close(a.entered) })
	<-a.release
	return a.Application.CheckTx(ctx, req)
}
func TestPhaseTimingTransportStopDrainsAdmittedHandlerBeforeTerminal(t *testing.T) {
	var output bytes.Buffer
	r := newPhaseRecorder(&output)
	app := &heldPhaseCheck{Application: abci.NewBaseApplication(), entered: make(chan struct{}), release: make(chan struct{})}
	timed := &phaseTimedApplication{Application: app, recorder: r}
	callDone := make(chan error, 1)
	go func() { _, err := timed.CheckTx(context.Background(), &abci.RequestCheckTx{}); callDone <- err }()
	<-app.entered
	stopped := make(chan struct{})
	done := make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go func() { done <- stopPhaseDiagnostics(ctx, func() error { close(stopped); return nil }, r) }()
	<-stopped
	select {
	case err := <-done:
		close(app.release)
		<-callDone
		t.Fatalf("transport Stop returned while admitted handler was still held: %v; %s", err, output.String())
	case <-time.After(20 * time.Millisecond):
	}
	close(app.release)
	if err := <-callDone; err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	rows := phaseReports(t, output.String())
	if len(rows) != 1 || !rows[0].Valid || rows[0].InFlight != 0 || rows[0].Stages["check_tx"].Calls != 1 {
		t.Fatal("final record lost completed handler", rows)
	}
	if _, err := timed.CheckTx(context.Background(), &abci.RequestCheckTx{}); err == nil {
		t.Fatal("post-drain request reached delegate")
	}
}

func TestPhaseTimingDrainCancellationNeverPromotesIncompleteEvidence(t *testing.T) {
	var output bytes.Buffer
	r := newPhaseRecorder(&output)
	r.begin()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := stopPhaseDiagnostics(ctx, func() error { return nil }, r)
	if !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled drain accepted", err)
	}
	rows := phaseReports(t, output.String())
	if len(rows) != 1 || rows[0].Valid || rows[0].InFlight != 1 {
		t.Fatal("unfinished drain promoted", rows)
	}
}

func TestPhaseTimingDrainKeepsFinalCommitSampleBeforeTerminal(t *testing.T) {
	var output bytes.Buffer
	r := newPhaseRecorder(&output)
	entered, release := make(chan struct{}), make(chan struct{})
	timed := &phaseTimedApplication{Application: abci.NewBaseApplication(), recorder: r, commitTiming: func() (consensus.CommitTimingSample, bool) {
		close(entered)
		<-release
		return consensus.CommitTimingSample{Height: 2, Durable: true}, true
	}}
	callDone := make(chan error, 1)
	go func() { _, err := timed.Commit(context.Background(), &abci.RequestCommit{}); callDone <- err }()
	<-entered
	stopCalled, done := make(chan struct{}), make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go func() { done <- stopPhaseDiagnostics(ctx, func() error { close(stopCalled); return nil }, r) }()
	<-stopCalled
	select {
	case err := <-done:
		close(release)
		<-callDone
		t.Fatalf("sealed before final Commit sample: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if err := <-callDone; err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	rows := phaseReports(t, output.String())
	if len(rows) != 2 || rows[0].Reason != "commit" || rows[0].Commit == nil || rows[1].Reason != "shutdown" || !rows[1].Valid || rows[1].InFlight != 0 || rows[1].Stages["commit"].Calls != 1 {
		t.Fatal("final Commit ordering/counter lost", rows)
	}
}
func TestPhaseTimingDrainTransportStopErrorNeverPromotesValidity(t *testing.T) {
	var output bytes.Buffer
	r := newPhaseRecorder(&output)
	cause := errors.New("transport Stop refused")
	if err := stopPhaseDiagnostics(context.Background(), func() error { return cause }, r); !errors.Is(err, cause) {
		t.Fatal("transport error lost", err)
	}
	rows := phaseReports(t, output.String())
	if len(rows) != 1 || rows[0].Valid {
		t.Fatal("failed transport Stop marked valid", rows)
	}
}
