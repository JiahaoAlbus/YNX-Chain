//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"context"
	"testing"
	"time"
)

// PUBLIC lifecycle-only attachment: uses Core's existing private sealed-clock
// helper and actual original App/SDK97 worker. It does not qualify Source pins.
// Crucially the REAL Core process-loss guard remains in the tested source.
func TestPQNormalStartupSeparateProcessAndScopePUBLIC(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	t.Run("optional-close-keeps-sdk-cleanup", func(t *testing.T) {
		process, cancel := context.WithCancel(context.Background())
		defer cancel()
		startup := newOriginalObserverSourceStartup(process, f.node, f.app, pqOriginalSourceProfile{}, ErrPQOriginalSourceProfileNotSupplied)
		deadline := time.Now().Add(20 * time.Second)
		source := publicSealedSourceClock(t, startup.process, sourceParentSelection{generation: 31, deadlineMs: uint64(deadline.UnixMilli())})
		startup.mu.Lock()
		startup.source = source
		startup.mu.Unlock() // PUBLIC fixture only
		w, conn := accountWireAttach(t, f, f.expected.Owner, source)
		opened, _ := accountWireExchange(t, conn, pqAccountWireOpen, 1, [32]byte{})
		if opened.failure {
			t.Fatal("actual account OPEN failed")
		}
		startup.Close()
		select {
		case <-source.Done():
		case <-time.After(time.Second):
			t.Fatal("optional close failed to retire same Source")
		}
		// Old startup cancelled source.process, which this exact real Core wire
		// correctly treats as transport termination. That closes this READ/cleanup.
		failed, _ := accountWireExchange(t, conn, pqAccountWireRead, 2, opened.reader)
		if !failed.failure || failed.reader != opened.reader {
			t.Fatal("scope cancel remained productive or changed reader")
		}
		for i, op := range []uint32{pqAccountWireRetire, pqAccountWireJoin} {
			reply, _ := accountWireExchange(t, conn, op, uint64(i+3), opened.reader)
			if reply.reader != opened.reader {
				t.Fatal("same SDK cleanup reader changed")
			}
		}
		closed, _ := accountWireExchange(t, conn, pqAccountWireClose, 5, opened.reader)
		if closed.status != pqAccountWireClosed || !closed.failure || closed.code != 0 || !accountWireHandler(t, w).IsClosed() {
			t.Fatal("scope close lost CLOSED+failure0 under original process guard")
		}
		if process.Err() != nil || source.process != process || source.process.Err() != nil || !source.cleanupOnly() {
			t.Fatal("optional Source lifetime replaced/canceled the real Node process")
		}
		if source.originalSourceDeadlineMs() != uint64(deadline.UnixMilli()) {
			t.Fatal("Source deadline changed")
		}
		_ = conn.Close()
		accountWireWait(t, w)
		if startup.host.sameOriginal() != nil || f.node.IsRunning() {
			t.Fatal("optional Source close affected original Node")
		}
	})
	t.Run("real-process-loss-still-closes-wire", func(t *testing.T) {
		process, cancel := context.WithCancel(context.Background())
		defer cancel()
		startup := newOriginalObserverSourceStartup(process, f.node, f.app, pqOriginalSourceProfile{}, ErrPQOriginalSourceProfileNotSupplied)
		defer startup.Close()
		source := publicSealedSourceClock(t, startup.process, sourceParentSelection{generation: 32, deadlineMs: uint64(time.Now().Add(20 * time.Second).UnixMilli())})
		startup.mu.Lock()
		startup.source = source
		startup.mu.Unlock()
		w, conn := accountWireAttach(t, f, f.expected.Owner, source)
		opened, _ := accountWireExchange(t, conn, pqAccountWireOpen, 1, [32]byte{})
		if opened.failure {
			t.Fatal("actual second OPEN failed")
		}
		cancel() // actual Node/process loss, NOT optional Scope Close
		accountWireWait(t, w)
		if !accountWireHandler(t, w).IsClosed() || source.cleanupOnly() {
			t.Fatal("real process-loss physical guard was removed/weakened")
		}
		_ = conn.Close()
	})
}
