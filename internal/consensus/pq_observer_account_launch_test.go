//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"bytes"
	"context"
	"errors"
	"net"
	"os"
	"testing"
	"time"

	"github.com/cometbft/cometbft/libs/log"
)

// Only PUBLIC tests construct the private selection here. This is not a
// replacement for Native's genuine OriginalEngineSource acquisition bridge.
func publicObserverAccountLaunch(t *testing.T, f *committedTraceObserver, ctx context.Context) (*pqObserverAccountLaunch, *net.UnixConn) {
	t.Helper()
	fd, conn := current4Socketpair(t)
	l := &pqObserverAccountLaunch{original: &pqObserverAccountLaunchState{ctx: ctx, canonicalOwner: f.expected.Owner, chainID: f.bootstrap.record.ChainID, minimumHeight: 10, endpoint: fd, peer: pqAccountWirePeer{uid: uint32(os.Getuid()), pid: int32(os.Getpid())}}}
	t.Cleanup(func() { _ = l.close() })
	return l, conn
}

func publicObserverAccountColdApp(t *testing.T, f *committedTraceObserver) *Application {
	t.Helper()
	f.closeNode()
	var app *Application
	var err error
	switch f.layout {
	case "atomic-json":
		app, err = NewPersistentApplicationWithEngineAuthorization(f.migration, f.path, f.bootstrap, f.engine)
	case "snapshot-journal":
		app, err = NewJournaledApplicationWithEngineAuthorization(f.migration, f.path, f.bootstrap, f.engine)
	case "block-journal":
		app, err = NewBlockJournaledApplicationWithEngineAuthorization(f.migration, f.path, f.bootstrap, f.engine)
	default:
		t.Fatal("unknown PUBLIC layout")
	}
	if err != nil {
		t.Fatal("actual original cold application", err)
	}
	return app
}

func TestPQObserverAccountLaunchPUBLICOwningConstructorAndCold(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			f := committedAccountFixture(t, layout, 10)
			before := f.stateBytes(t)
			app := publicObserverAccountColdApp(t, f)
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			launch, conn := publicObserverAccountLaunch(t, f, ctx)
			n, err := newPQObserverNodeWithAccountLaunch(f.config, app, f.key, log.NewNopLogger(), launch)
			if err != nil {
				t.Fatal("actual owning observer constructor", err)
			}
			f.app, f.node = app, n
			w := launch.original.wire
			if n.IsRunning() || n.IsListening() || n.PrivValidator() != nil || w == nil || w.app != app || w.source.node != n || w.ctx == nil || launch.original.endpoint != nil {
				t.Fatal("constructor lost actual App/Node custody or started a Node")
			}
			if deadline, ok := w.ctx.Deadline(); !ok {
				t.Fatal("original deadline lost")
			} else if original, _ := ctx.Deadline(); deadline != original {
				t.Fatal("original Source deadline was renewed")
			}
			if !bytes.Equal(before, f.stateBytes(t)) {
				t.Fatal("owning constructor changed the original committed state")
			}
			// The resource channel is a DIFFERENT socket and the original single
			// slot remains usable. Account attachment cannot consume that slot.
			resourceFD, _ := current4Socketpair(t)
			resource, err := attachPQCurrent4Wire(ctx, w.source, resourceFD, pqCurrent4Peer{uid: uint32(os.Getuid()), pid: int32(os.Getpid())})
			if err != nil || resource == nil || w.source.current4 != resource || resource.conn == w.conn {
				t.Fatal("independent purposes shared a slot or endpoint", err)
			}
			opened, _ := accountWireExchange(t, conn, pqAccountWireOpen, 1, [32]byte{})
			if opened.failure || opened.status != pqAccountWireOK || opened.reader == [32]byte{} || len(opened.payload) != 0 {
				t.Fatal("original empty OPEN failed")
			}
			pending, _ := accountWireExchange(t, conn, pqAccountWireRead, 2, opened.reader)
			if pending.status != pqAccountWireNotReady || !pending.failure || pending.code != 0 || pending.reader != opened.reader {
				t.Fatal("missing actual successor promoted or capture replaced")
			}
			f.advance(t, 11)
			read, _ := accountWireExchange(t, conn, pqAccountWireRead, 3, opened.reader)
			if read.failure || read.status != pqAccountWireOK || len(read.payload) == 0 {
				t.Fatal("original H/H+1 account proof unavailable")
			}
			proof, err := accountWireHandler(t, w).Read()
			if err != nil {
				t.Fatal(err)
			}
			view, err := proof.View()
			if err != nil || view.HistoricalAccount.Owner != f.expected.Owner || view.Proof.Height != 10 || view.CurrentCheckpoint.Height != 11 {
				t.Fatal("proof retargeted original owner/checkpoint", err)
			}
			encoded, err := encodePQAccountWireView(view)
			if err != nil || !bytes.Equal(encoded, read.payload) {
				t.Fatal("normal wire altered original sealed proof DATA", err)
			}
			originalApp := app
			cold := publicObserverAccountColdApp(t, f) // actual OnStop drains both children
			accountWireWait(t, w)
			current4Wait(t, resource)
			if !accountWireHandler(t, w).IsClosed() {
				t.Fatal("Node teardown released stores before account reader drained")
			}
			origin, err := proof.Origin()
			if err != nil || origin.OwnedBy(originalApp) == nil || origin.OwnedBy(cold) == nil {
				t.Fatal("original proof identity survived Stop/cold restart", err)
			}
			copyOfLaunch := *launch
			if other, err := newPQObserverNodeWithAccountLaunch(f.config, cold, f.key, log.NewNopLogger(), &copyOfLaunch); other != nil || !errors.Is(err, errPQObserverAccountLaunch) || cold.pqWalletPolicyLive != nil {
				t.Fatal("consumed launch was reused against a cold App", err)
			}
			second, secondConn := publicObserverAccountLaunch(t, f, ctx)
			n, err = newPQObserverNodeWithAccountLaunch(f.config, cold, f.key, log.NewNopLogger(), second)
			if err != nil {
				t.Fatal("fresh original private launch could not cold-open", err)
			}
			f.app, f.node = cold, n
			opened, _ = accountWireExchange(t, secondConn, pqAccountWireOpen, 1, [32]byte{})
			pending, _ = accountWireExchange(t, secondConn, pqAccountWireRead, 2, opened.reader)
			if pending.status != pqAccountWireNotReady || !pending.failure {
				t.Fatal("cold capture reused an old height's successor")
			}
		})
	}
}

func TestPQObserverAccountLaunchPUBLICRefusalsAndFailurePreservation(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	app := publicObserverAccountColdApp(t, f)
	before, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"no-deadline", "expired", "wrong-chain", "future-height", "malformed-owner", "wrong-peer", "missing-node-key", "nil-application", "already-closed-endpoint"} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			launch, _ := publicObserverAccountLaunch(t, f, ctx)
			key, actualApp := f.key, app
			originalFD := launch.original.endpoint
			switch name {
			case "no-deadline":
				launch.original.ctx = context.Background()
			case "expired":
				cancel()
			case "wrong-chain":
				launch.original.chainID += "-foreign"
			case "future-height":
				launch.original.minimumHeight = 11
			case "malformed-owner":
				launch.original.canonicalOwner = "not-an-owner"
			case "wrong-peer":
				launch.original.peer.pid++
			case "missing-node-key":
				key = nil
			case "nil-application":
				actualApp = nil
			case "already-closed-endpoint":
				if err := originalFD.Close(); err != nil {
					t.Fatal(err)
				}
			}
			n, originalError := newPQObserverNodeWithAccountLaunch(f.config, actualApp, key, log.NewNopLogger(), launch)
			if n != nil || originalError == nil || !launch.original.consumed || !launch.original.closed || app.pqWalletPolicyLive != nil {
				t.Fatal("invalid original launch mutated engine binding", originalError)
			}
			if _, err := originalFD.Stat(); !errors.Is(err, os.ErrClosed) {
				t.Fatal("failed constructor lost owned endpoint debt", err)
			}
			if name == "expired" && !errors.Is(originalError, context.Canceled) {
				t.Fatal("original cancellation replaced", originalError)
			}
			if name == "already-closed-endpoint" && !errors.Is(originalError, os.ErrClosed) {
				t.Fatal("cleanup error was swallowed", originalError)
			}
			first := launch.original.firstCause
			if n, err = newPQObserverNodeWithAccountLaunch(f.config, app, f.key, log.NewNopLogger(), launch); n != nil || !errors.Is(err, first) {
				t.Fatal("failed original launch retried or lost first cause", err)
			}
			after, err := os.ReadFile(f.path)
			if err != nil || !bytes.Equal(after, before) {
				t.Fatal("refusal rewrote original state", err)
			}
		})
	}
}

func TestPQObserverAccountLaunchPUBLICParentCloseAndNodeStopDrain(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	app := publicObserverAccountColdApp(t, f)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	launch, conn := publicObserverAccountLaunch(t, f, ctx)
	n, err := newPQObserverNodeWithAccountLaunch(f.config, app, f.key, log.NewNopLogger(), launch)
	if err != nil {
		t.Fatal(err)
	}
	f.app, f.node = app, n
	w := launch.original.wire
	opened, _ := accountWireExchange(t, conn, pqAccountWireOpen, 1, [32]byte{})
	if opened.failure {
		t.Fatal("original OPEN failed")
	}
	app.mu.Lock()
	locked := true
	defer func() {
		if locked {
			app.mu.Unlock()
		}
	}()
	if err = writePQAccountWire(conn, accountWireRequest(pqAccountWireRead, 2, opened.reader)); err != nil {
		t.Fatal(err)
	}
	handler := accountWireHandler(t, w)
	deadline := time.Now().Add(time.Second)
	for {
		handler.core.mu.Lock()
		running := handler.core.running
		handler.core.mu.Unlock()
		if running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("actual original handler did not enter read")
		}
		time.Sleep(time.Millisecond)
	}
	parentClosed := make(chan error, 1)
	go func() { parentClosed <- launch.close() }()
	nodeStopped := make(chan struct{})
	go func() { n.OnStop(); close(nodeStopped) }()
	for _, done := range []<-chan struct{}{nodeStopped, w.done} {
		select {
		case <-done:
			t.Fatal("owner released actual reader/Node before admitted read drained")
		case <-time.After(20 * time.Millisecond):
		}
	}
	select {
	case <-parentClosed:
		t.Fatal("parent close falsely reported drained original read")
	default:
	}
	app.mu.Unlock()
	locked = false
	select {
	case err = <-parentClosed:
		if err == nil {
			t.Fatal("interrupted original read lost its failure")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("parent close failed to join actual worker")
	}
	select {
	case <-nodeStopped:
	case <-time.After(3 * time.Second):
		t.Fatal("Node stop failed to join original source")
	}
	f.node = nil // the original Node was stopped exactly once above
	if !handler.IsClosed() || w.cause() == nil || !errors.Is(launch.close(), w.cause()) {
		t.Fatal("late partial/UNKNOWN first cause did not survive repeated close")
	}
	w.source.mu.Lock()
	remaining := len(w.source.accountProof)
	w.source.mu.Unlock()
	if remaining != 0 {
		t.Fatal("drained original reader remained in owning Source")
	}
}
