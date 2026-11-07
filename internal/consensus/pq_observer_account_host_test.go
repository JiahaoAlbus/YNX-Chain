//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

func TestPQObserverAccountHostPUBLICSameNodeDistinctScopes(t *testing.T) {
	// The fixed PUBLIC trajectory supplies every signed block. This creates no
	// signing key, starts no Node and fabricates no Source or Native authority.
	f := committedAccountFixture(t, "atomic-json", 5)
	originalNode, originalApp := f.node, f.app
	host, err := bindPQObserverAccountHost(originalNode, originalApp)
	if err != nil {
		t.Fatal("actual observer owning host", err)
	}
	if host.source != f.app.pqWalletPolicyLive {
		t.Fatal("host did not seal the actual constructor source")
	}
	ctxEarly, cancelEarly := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelEarly()
	early, _ := publicObserverAccountLaunch(t, f, ctxEarly)
	earlyFD := early.original.endpoint
	before := f.stateBytes(t)
	if err = host.attach(early); err == nil || !errors.Is(err, errPQObserverAccountLaunch) || early.original.wire != nil || !early.original.closed {
		t.Fatal("pre-minimum scope admitted or not closed", err)
	}
	if _, err = earlyFD.Stat(); !errors.Is(err, os.ErrClosed) || !bytes.Equal(before, f.stateBytes(t)) || f.node != originalNode || f.app != originalApp {
		t.Fatal("early scope consumed/rewrote another state or replaced Node", err)
	}
	if err = host.sameOriginal(); err != nil {
		t.Fatal("refused early scope retired the advancing observer", err)
	}
	for h := int64(6); h <= 10; h++ {
		f.advance(t, h) // real full response/state parity and original AND checks
	}
	if err = host.attach(early); !errors.Is(err, errPQObserverAccountLaunch) {
		t.Fatal("old failed scope was silently retried after sync", err)
	}
	ctxFirst, cancelFirst := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelFirst()
	first, firstConn := publicObserverAccountLaunch(t, f, ctxFirst)
	if err = host.attach(first); err != nil {
		t.Fatal("fresh scope could not attach after actual synchronization", err)
	}
	openedFirst, _ := accountWireExchange(t, firstConn, pqAccountWireOpen, 1, [32]byte{})
	if openedFirst.failure || openedFirst.status != pqAccountWireOK {
		t.Fatal("first actual OPEN failed")
	}
	f.advance(t, 11)
	readFirst, _ := accountWireExchange(t, firstConn, pqAccountWireRead, 2, openedFirst.reader)
	if readFirst.failure || readFirst.status != pqAccountWireOK || len(readFirst.payload) == 0 {
		t.Fatal("first original H10/H11 proof missing")
	}
	firstProof, err := accountWireHandler(t, first.original.wire).Read()
	if err != nil {
		t.Fatal(err)
	}
	firstView, err := firstProof.View()
	if err != nil || firstView.Proof.Height != 10 || firstView.CurrentCheckpoint.Height != 11 {
		t.Fatal("first scope capture changed", err)
	}
	ctxSecond, cancelSecond := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelSecond()
	second, secondConn := publicObserverAccountLaunch(t, f, ctxSecond)
	second.original.minimumHeight = 11
	if err = host.attach(second); err != nil {
		t.Fatal("second original scope reconstructed or refused same observer", err)
	}
	if first.original.wire == second.original.wire || first.original.wire.conn == second.original.wire.conn || first.original.wire.app != originalApp || second.original.wire.app != originalApp {
		t.Fatal("independent once scopes reused a reader/channel/App")
	}
	for _, scope := range []*pqObserverAccountLaunch{first, second} {
		got, ok := scope.original.wire.ctx.Deadline()
		want, _ := scope.original.ctx.Deadline()
		if !ok || got != want {
			t.Fatal("per-scope original deadline was extended or reused")
		}
	}
	openedSecond, _ := accountWireExchange(t, secondConn, pqAccountWireOpen, 1, [32]byte{})
	notReady, _ := accountWireExchange(t, secondConn, pqAccountWireRead, 2, openedSecond.reader)
	if openedSecond.failure || openedSecond.reader == openedFirst.reader || notReady.status != pqAccountWireNotReady || !notReady.failure {
		t.Fatal("second scope reused old proof or promoted absent H12")
	}
	third, _ := publicObserverAccountLaunch(t, f, ctxSecond)
	third.original.minimumHeight = 11
	if err = host.attach(third); !errors.Is(err, errPQAccountWireCapacity) || third.original.wire != nil || !third.original.closed {
		t.Fatal("original two-channel bound changed", err)
	}
	if err = host.sameOriginal(); err != nil {
		t.Fatal("capacity refusal retired shared host", err)
	}
	cancelFirst()
	accountWireWait(t, first.original.wire)
	if !accountWireHandler(t, first.original.wire).IsClosed() {
		t.Fatal("expired old scope did not drain its original capture")
	}
	if err = host.attach(first); !errors.Is(err, errPQObserverAccountLaunch) {
		t.Fatal("old once scope resumed", err)
	}
	if _, err = accountWireHandler(t, first.original.wire).Read(); err == nil {
		t.Fatal("old capture continued after original context ended")
	}
	f.advance(t, 12)
	readSecond, _ := accountWireExchange(t, secondConn, pqAccountWireRead, 3, openedSecond.reader)
	if readSecond.failure || readSecond.status != pqAccountWireOK || len(readSecond.payload) == 0 || bytes.Equal(readFirst.payload, readSecond.payload) {
		t.Fatal("fresh scope did not produce its actual H11/H12 proof")
	}
	proof, err := accountWireHandler(t, second.original.wire).Read()
	if err != nil {
		t.Fatal(err)
	}
	view, err := proof.View()
	if err != nil || view.Proof.Height != 11 || view.CurrentCheckpoint.Height != 12 || view.HistoricalAccount.Owner != f.expected.Owner {
		t.Fatal("new scope retargeted owner/checkpoint", err)
	}
	if f.node != originalNode || f.app != originalApp || f.node.IsRunning() || host.source.node != originalNode {
		t.Fatal("scope continuity replaced or started the original Node")
	}
	_ = host.source.Close() // actual original source retirement, not a Root bool
	accountWireWait(t, second.original.wire)
	late, _ := publicObserverAccountLaunch(t, f, ctxSecond)
	if err = host.attach(late); !errors.Is(err, ErrPQWalletPolicyLiveRetired) || late.original.wire != nil || !late.original.closed {
		t.Fatal("retired source admitted a new original channel", err)
	}
	if _, err = bindPQObserverAccountHost(originalNode, originalApp); !errors.Is(err, ErrPQWalletPolicyLiveRetired) {
		t.Fatal("retired original identity rebound", err)
	}
}

func TestPQObserverAccountHostPUBLICIdentityAndScopeFailures(t *testing.T) {
	f := committedAccountFixture(t, "snapshot-journal", 10)
	host, err := bindPQObserverAccountHost(f.node, f.app)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = bindPQObserverAccountHost(f.node, &Application{}); err == nil {
		t.Fatal("unbound App paired by claimed Node pointer")
	}
	if _, err = bindPQObserverAccountHost(nil, f.app); err == nil {
		t.Fatal("missing actual Node accepted")
	}
	before := f.stateBytes(t)
	for _, name := range []string{"zero-host", "wrong-chain", "wrong-peer", "expired", "no-deadline", "future-height", "unknown-owner"} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			launch, _ := publicObserverAccountLaunch(t, f, ctx)
			actual := host
			switch name {
			case "zero-host":
				actual = &pqObserverAccountHost{}
			case "wrong-chain":
				launch.original.chainID += "-different"
			case "wrong-peer":
				launch.original.peer.pid++
			case "expired":
				cancel()
			case "no-deadline":
				launch.original.ctx = context.Background()
			case "future-height":
				launch.original.minimumHeight = 11
			case "unknown-owner":
				launch.original.canonicalOwner = "0x1111111111111111111111111111111111111111"
			}
			if err = actual.attach(launch); err == nil || !launch.original.closed || !launch.original.consumed || launch.original.wire != nil {
				t.Fatal("invalid scope admitted", err)
			}
			if !bytes.Equal(before, f.stateBytes(t)) || host.sameOriginal() != nil {
				t.Fatal("scope refusal mutated/released another original state")
			}
			if again := actual.attach(launch); !errors.Is(again, launch.original.firstCause) {
				t.Fatal("repeat scope lost original failure", again)
			}
		})
	}
}
