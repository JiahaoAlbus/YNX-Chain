//go:build cgo && (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"strings"
	"testing"
	"time"
)

// These are normal failed CODE capture and actual same-App SDK cleanup
// controls. The PUBLIC lifecycle fixture does not qualify a P09 launch, Auth
// Source, or successful C++ root record; no production exception is installed.
func TestPQNormalStartupFreshBrokerPUBLIC(t *testing.T) {
	t.Run("original-protocol-terminal-and-history", freshProtocolTerminalPUBLIC)
	t.Run("actual-CODE-refuses-both-before-stdin", func(t *testing.T) {
		old := os.Stdin
		defer func() { os.Stdin = old }()
		sourceBootstrapOnce.Lock()
		entered := sourceBootstrapOnce.entered
		sourceBootstrapOnce.Unlock()
		defer func() {
			sourceBootstrapOnce.Lock()
			sourceBootstrapOnce.entered = entered
			sourceBootstrapOnce.Unlock()
		}()
		for _, version := range []uint16{3, 4} {
			profile, first := originalPQObserverSourceBuildProfile()
			if first == nil || profile.codeProfile == nil {
				t.Fatal("expected actual Root-empty partial")
			}
			// These syntactically valid DATA pins cannot repair the actual failed actor.
			profile.images = [3]string{strings.Repeat("1", 64), strings.Repeat("2", 64), strings.Repeat("3", 64)}
			input, writer, e := os.Pipe()
			if e != nil {
				t.Fatal(e)
			}
			raw := freshLaunchDATA(version)
			_, e = writer.Write(raw)
			_ = writer.Close()
			if e != nil {
				t.Fatal(e)
			}
			os.Stdin = input
			sourceBootstrapOnce.Lock()
			sourceBootstrapOnce.entered = false
			sourceBootstrapOnce.Unlock()
			owner, fresh, e := captureOriginalSourceLaunchVersions(context.Background(), context.Background(), profile, 0)
			if e == nil || owner != nil || fresh != nil {
				t.Fatal("actual failed actor permitted launch")
			}
			remaining, e := io.ReadAll(input)
			_ = input.Close()
			if e != nil || string(remaining) != string(raw) {
				t.Fatal("failed Current consumed inherited launch", e)
			}
			profile.codeProfile.Retire()
			if !profile.codeProfile.Close().physicalDone {
				t.Fatal("real partial CODE debt")
			}
		}
	})
	t.Run("two-original-readers-drain-before-CODE", func(t *testing.T) {
		f := committedAccountFixture(t, "atomic-json", 10)
		process, cancel := context.WithCancel(context.Background())
		defer cancel()
		startup := originalObserverSourceStartupState(process, f.node, f.app)
		profile, profileErr := originalPQObserverSourceBuildProfile()
		if profileErr == nil || profile.codeProfile == nil {
			t.Fatal("expected actual Root-empty actor")
		}
		startup.codeProfile = profile.codeProfile
		startup.record(profileErr)
		ctx, stop := context.WithCancel(process)
		conn, _ := freshWirePair(t)
		broker := &pqFreshScopeBroker{process: process, readCtx: ctx, stopRead: stop, original: &pqOriginalFreshBrokerLaunch{original: &pqOriginalSourceLaunch{}}, conn: conn, hostReady: make(chan struct{}), done: make(chan struct{}), records: make(map[uint64]*pqFreshScopeRecord)}
		// No broker loop is invented: this PUBLIC test installs two already sealed
		// lifecycle scopes and exercises the production seal/Close and CODE ordering.
		close(broker.done)
		if e := broker.bindHost(startup.host); e != nil {
			t.Fatal(e)
		}
		if e := broker.bindHost(startup.host); e == nil {
			t.Fatal("host rebound")
		}
		startup.broker = broker
		var sources []*pqProtectedSourceParent
		var scopes []*pqObserverAccountLaunch
		var closes []func()
		for i := 0; i < 2; i++ {
			source := publicSealedSourceClock(t, process, sourceParentSelection{generation: uint64(i + 1), deadlineMs: uint64(time.Now().Add(30 * time.Second).UnixMilli())})
			scope, childConn := publicObserverAccountLaunch(t, f, source)
			if e := startup.host.attach(scope); e != nil {
				t.Fatal(e)
			}
			opened, _ := accountWireExchange(t, childConn, pqAccountWireOpen, 1, [32]byte{})
			if opened.failure {
				t.Fatal("original PUBLIC reader OPEN")
			}
			record := &pqFreshScopeRecord{id: uint64(i + 1), scope: scope, source: source, status: 2, done: make(chan struct{})}
			broker.records[record.id] = record
			broker.active++
			sources = append(sources, source)
			scopes = append(scopes, scope)
			closes = append(closes, func() {
				refused, _ := accountWireExchange(t, childConn, pqAccountWireRead, 2, opened.reader)
				if !refused.failure || refused.reader != opened.reader {
					t.Fatal("sealed fresh scope productive/replaced")
				}
				closed, _ := accountWireExchange(t, childConn, pqAccountWireClose, 3, opened.reader)
				if closed.status != pqAccountWireClosed || !closed.failure || closed.reader != opened.reader {
					t.Fatal("same reader cleanup lost")
				}
				_ = childConn.Close()
				accountWireWait(t, scope.original.wire)
				broker.finish(record, scope.close(), 0)
			})
		}
		go func() {
			err := broker.Close(context.Background())
			startup.mu.Lock()
			startup.cleanup = err
			startup.mu.Unlock()
			close(startup.done)
		}()
		startup.Close()
		// Source cancellation must be visible, without closing the SDK97 child.
		for _, source := range sources {
			normalSourceWait(t, source.Done())
		}
		if startup.LocalComplete() {
			t.Fatal("CODE released before both actual workers")
		}
		closes[0]()
		if startup.LocalComplete() {
			t.Fatal("first scope drain released second scope CODE")
		}
		closes[1]()
		deadline, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		if err := startup.Join(deadline); err == nil || errors.Is(err, context.DeadlineExceeded) || !startup.LocalComplete() {
			t.Fatal("same actor did not finish after actual drains", err)
		}
		if f.node.IsRunning() || process.Err() != nil || startup.host.sameOriginal() != nil || scopes[0].original.wire == scopes[1].original.wire {
			t.Fatal("fresh scopes changed original host or lifecycle")
		}
	})
}

func freshProtocolTerminalPUBLIC(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	host, err := bindPQObserverAccountHost(f.node, f.app)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"healthy-close", "EOF-without-close", "source-failure-CLOSED", "CLOSE-output-lost", "prior-control-close"} {
		t.Run(mode, func(t *testing.T) {
			process, cancel := context.WithCancel(context.Background())
			defer cancel()
			source := publicSealedSourceClock(t, process, sourceParentSelection{generation: 51, deadlineMs: uint64(time.Now().Add(30 * time.Second).UnixMilli())})
			// Existing PUBLIC sealed-clock fixture has no production BIND reader. Drain
			// its actual held control FD here; this is not a qualified Source producer.
			go func() { _, _ = io.Copy(io.Discard, source.conn); close(source.readerDone) }()
			scope, conn := publicObserverAccountLaunch(t, f, source)
			if err := host.attach(scope); err != nil {
				t.Fatal(err)
			}
			wire := scope.original.wire
			opened, _ := accountWireExchange(t, conn, pqAccountWireOpen, 1, [32]byte{})
			if opened.failure {
				t.Fatal("actual original OPEN")
			}
			cause := sourceParentFailure{present: true, code: 0, reason: 1}
			if mode == "source-failure-CLOSED" {
				source.cancel(context.Canceled, cause)
			}
			switch mode {
			case "EOF-without-close":
				_ = conn.Close()
			case "CLOSE-output-lost":
				// Hold the real handler's normal mutex until the original peer has
				// physically closed. The real queued CLOSE can then complete locally,
				// but its reply cannot be written. No synthetic writer/failure hook.
				handler := accountWireHandler(t, wire)
				handler.core.mu.Lock()
				sendErr := writePQAccountWire(conn, accountWireRequest(pqAccountWireClose, 2, opened.reader))
				_ = conn.Close()
				handler.core.mu.Unlock()
				if sendErr != nil {
					t.Fatal(sendErr)
				}
			default:
				closed, _ := accountWireExchange(t, conn, pqAccountWireClose, 2, opened.reader)
				if closed.status != pqAccountWireClosed || closed.reader != opened.reader || closed.failure != (mode == "source-failure-CLOSED") {
					t.Fatal("original CLOSED receipt mismatch")
				}
				_ = conn.Close()
			}
			accountWireWait(t, wire)
			_ = conn.Close()
			written, failed := wire.terminalCloseObservation()
			if written != (mode != "EOF-without-close" && mode != "CLOSE-output-lost") || failed != (mode == "source-failure-CLOSED") {
				t.Fatal("actual complete response confused with local EOF", written, failed)
			}
			if mode == "prior-control-close" {
				// Fault injection is the actual original Go object close, not an error
				// string shim. The first Source-owned close MUST retain net.ErrClosed.
				if err := source.conn.Close(); err != nil {
					t.Fatal(err)
				}
			}
			r := &pqFreshScopeRecord{id: 1, owner: source.original, source: source, scope: scope, status: 2, done: make(chan struct{})}
			b := &pqFreshScopeBroker{process: process, records: map[uint64]*pqFreshScopeRecord{1: r}, active: 1}
			b.completeScope(r)
			normalSourceWait(t, r.done)
			healthy := mode == "healthy-close"
			if (r.status == 5) != healthy || (r.first == nil) != healthy || b.active != 0 {
				t.Fatal("protocol retirement misclassified", r.status, r.first)
			}
			if mode == "source-failure-CLOSED" && !errors.Is(r.first, cause) {
				t.Fatal("present/code0 Source first cause erased", r.first)
			}
			if mode == "prior-control-close" && !errors.Is(r.first, net.ErrClosed) {
				t.Fatal("first actual control close failure hidden", r.first)
			}
			if healthy || mode == "source-failure-CLOSED" {
				// Fill with successful observations while keeping the real tested
				// record, including the original failure when CLOSE carried it.
				for id := uint64(2); id <= 36; id++ {
					copyRecord := *r
					copyRecord.id = id
					copyRecord.first, copyRecord.failure = nil, sourceParentFailure{}
					copyRecord.status = 5
					b.records[id] = &copyRecord
				}
				b.pruneClosedLocked()
				if healthy && (len(b.records) != 32 || b.records[36] == nil || b.records[1] != nil) {
					t.Fatal("healthy completion exhausts retained history instead of pruning")
				}
				if !healthy && (len(b.records) != 33 || b.records[1] != r || r.status != 3 || !errors.Is(r.first, cause)) {
					t.Fatal("bounded success history erased the original Source failure")
				}
			}
			if host.sameOriginal() != nil || f.node.IsRunning() || process.Err() != nil {
				t.Fatal("scope completion changed/stopped original host")
			}
		})
	}
}
