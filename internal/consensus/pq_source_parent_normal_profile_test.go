//go:build cgo && (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	sourceparentprofile "github.com/JiahaoAlbus/YNX-Chain/packages/wallet-auth/go/sourceparentprofile"
	"github.com/cometbft/cometbft/libs/log"
)

func normalSourceWait(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("actual optional Source worker did not finish")
	}
}

func TestPQNormalStartupOriginalRootEmptyAndCustodyPUBLIC(t *testing.T) {
	t.Run("background-join-returns-known-unknown", func(t *testing.T) {
		// Private close-result bookkeeping control, not a fabricated C owner or
		// a claim that the production Root-empty profile fails physical close.
		first, prior, closeFailure := errors.New("PUBLIC original cause"), errors.New("PUBLIC earlier cleanup cause"), errors.New("PUBLIC ambiguous close result")
		s := &PQObserverSourceStartup{first: first, cleanup: prior, codeClosed: make(chan struct{}), codeCloseReturned: make(chan struct{})}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := s.Join(ctx); !errors.Is(err, context.Canceled) || s.LocalComplete() {
			t.Fatal("unfinished close stopped obeying caller cancellation")
		}
		// Use the same private completion path as the once-only production
		// goroutine after its real worker and physical close attempt return.
		s.finishCodeCloseAttempt(pqSourceCodeDrain{failure: closeFailure, physicalDone: false})
		returned := make(chan error, 1)
		go func() { returned <- s.Join(context.Background()) }()
		select {
		case err := <-returned:
			for _, want := range []error{first, prior, closeFailure, ErrPQOriginalSourceClosePending} {
				if !errors.Is(err, want) {
					t.Fatal("known UNKNOWN lost original failure or explicit pending")
				}
			}
		case <-time.After(3 * time.Second):
			t.Fatal("background Join blocked after the close attempt returned UNKNOWN")
		}
		if s.LocalComplete() || s.SourceFailure() != first {
			t.Fatal("known UNKNOWN promoted physical completion or replaced first cause")
		}
		select {
		case <-s.codeClosed:
			t.Fatal("UNKNOWN closed the physical-completion signal")
		default:
		}
		// Rejoining observes the same result; it does not retry Close or retire
		// a different owner. Even a canceled caller sees this completed attempt.
		if err := s.Join(ctx); !errors.Is(err, ErrPQOriginalSourceClosePending) || errors.Is(err, context.Canceled) {
			t.Fatal("known returned close attempt was treated as still running")
		}
	})
	t.Run("unknown-close-preserves-independent-first-and-cleanup", func(t *testing.T) {
		// Private error/debt-state control only, not a fabricated C owner or
		// physical-close receipt. No timeout can promote UNKNOWN to completion.
		first, cleanup := errors.New("PUBLIC original cause"), errors.New("PUBLIC ambiguous selected close")
		s := &PQObserverSourceStartup{first: first, cleanup: cleanup, codeClosed: make(chan struct{})}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		err := s.Join(ctx)
		if !errors.Is(err, first) || !errors.Is(err, cleanup) || !errors.Is(err, context.Canceled) || s.LocalComplete() {
			t.Fatal("UNKNOWN close lost debt or first cause")
		}
	})
	f := committedAccountFixture(t, "atomic-json", 10)
	// Reuse the existing PUBLIC trajectory's original stores and existing P2P
	// key. No new key, signature, Node.Start, validator or Source is produced.
	f.closeNode()
	app, err := NewPersistentApplicationWithEngineAuthorization(f.migration, f.path, f.bootstrap, f.engine)
	if err != nil {
		t.Fatal(err)
	}
	process, cancel := context.WithCancel(context.Background())
	defer cancel()
	n, startup, err := NewPQObserverNodeWithOriginalSourceStartup(process, f.config, app, f.key, log.NewNopLogger())
	if err != nil || n == nil || startup == nil {
		t.Fatal("normal constructor", err)
	}
	f.app, f.node = app, n
	normalSourceWait(t, startup.Ready())
	var cause sourceparentprofile.Failure
	if !errors.As(startup.SourceFailure(), &cause) || !cause.Present || cause.Code != 1 {
		t.Fatal("normal factory did not return actual Auth Root-empty failure")
	}
	if startup.codeProfile == nil || startup.original != nil || startup.scope != nil {
		t.Fatal("partial profile lost or empty Root captured a launch")
	}
	if n.IsRunning() || n.IsListening() || n.PrivValidator() != nil || process.Err() != nil || startup.host.sameOriginal() != nil {
		t.Fatal("optional failure affected ordinary Node or obtained permission")
	}
	startup.Close()
	ctx, stop := context.WithTimeout(context.Background(), 3*time.Second)
	defer stop()
	if err = startup.Join(ctx); !errors.As(err, &cause) || !startup.LocalComplete() {
		t.Fatal("actual partial did not physically drain with original first failure", err)
	}
	if startup.host.sameOriginal() != nil || process.Err() != nil {
		t.Fatal("optional teardown stopped the original host")
	}
	// A pipe could carry inherited endpoints, but failed CODE qualification
	// cannot authenticate descriptor numbers in it. Preserve this separate debt.
	t.Run("unqualified-inherited-pipe-is-not-closed", func(t *testing.T) {
		input, writer, e := os.Pipe()
		if e != nil {
			t.Fatal(e)
		}
		defer input.Close()
		defer writer.Close()
		old := os.Stdin
		os.Stdin = input
		defer func() { os.Stdin = old }()
		profile, e := originalPQObserverSourceBuildProfile()
		if profile.codeProfile == nil || e == nil {
			t.Fatal("actual empty Root admitted")
		}
		s := newOriginalObserverSourceStartup(process, n, app, profile, e)
		s.Close()
		if e = s.Join(ctx); !errors.Is(e, errPQSourceInheritedCustodyPending) || s.LocalComplete() {
			t.Fatal("worker done falsely closed unadopted inherited transport")
		}
		if _, e = input.Stat(); e != nil || process.Err() != nil {
			t.Fatal("untrusted descriptor/process was closed")
		}
		if !profile.codeProfile.Close().physicalDone {
			t.Fatal("CODE owner itself retained unexpected debt")
		}
	})
}

func TestPQNormalStartupProfileCurrentAndWorkerDrainPUBLIC(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	for _, operation := range []uint32{pqAccountWireRead, pqAccountWireCurrent} {
		t.Run(map[uint32]string{pqAccountWireRead: "READ", pqAccountWireCurrent: "CURRENT"}[operation], func(t *testing.T) {
			process, cancel := context.WithCancel(context.Background())
			defer cancel()
			source := publicSealedSourceClock(t, process, sourceParentSelection{generation: 31 + uint64(operation), deadlineMs: uint64(time.Now().Add(20 * time.Second).UnixMilli())})
			w, conn := accountWireAttach(t, f, f.expected.Owner, source)
			defer conn.Close()
			opened, _ := accountWireExchange(t, conn, pqAccountWireOpen, 1, [32]byte{})
			if opened.failure {
				t.Fatal("PUBLIC lifecycle OPEN")
			}
			// No production positive is invented. After PUBLIC lifecycle OPEN, bind
			// the ACTUAL failed C owner to exercise concrete Current refusal. Auth's
			// separate physical originals controls cover positive file replacement.
			profile, profileErr := originalPQObserverSourceBuildProfile()
			if profile.codeProfile == nil || profileErr == nil {
				t.Fatal("expected actual Root-empty partial")
			}
			source.original.mu.Lock()
			source.original.profile = profile
			source.original.mu.Unlock()
			startup := originalObserverSourceStartupState(process, f.node, f.app)
			startup.codeProfile, startup.source = profile.codeProfile, source
			defer startup.Close()
			// Keep the same concrete CODE owner until the real SDK worker finishes.
			go func() { <-w.done; close(startup.done) }()
			failed, _ := accountWireExchange(t, conn, operation, 2, opened.reader)
			if !failed.failure || failed.status != pqAccountWireFailed || failed.reader != opened.reader || !source.cleanupOnly() {
				t.Fatal("actual profile failure allowed productive output or killed cleanup")
			}
			var actual sourceparentprofile.Failure
			if !errors.As(w.cause(), &actual) || !actual.Present || actual.Code != 1 {
				t.Fatal("actual Auth first cause lost")
			}
			startup.Close()
			if startup.LocalComplete() {
				t.Fatal("CODE released before SDK worker.done")
			}
			for i, op := range []uint32{pqAccountWireRetire, pqAccountWireJoin} {
				r, _ := accountWireExchange(t, conn, op, uint64(i+3), opened.reader)
				if r.reader != opened.reader {
					t.Fatal("profile revocation replaced same cleanup reader")
				}
			}
			closed, _ := accountWireExchange(t, conn, pqAccountWireClose, 5, opened.reader)
			if closed.status != pqAccountWireClosed || !closed.failure || closed.code != 0 {
				t.Fatal("profile gate blocked CLOSED/failure0")
			}
			_ = conn.Close()
			accountWireWait(t, w)
			ctx, stop := context.WithTimeout(context.Background(), 3*time.Second)
			defer stop()
			if e := startup.Join(ctx); !errors.As(e, &actual) || !startup.LocalComplete() {
				t.Fatal("same CODE partial failed to drain after worker", e)
			}
			if process.Err() != nil || startup.host.sameOriginal() != nil {
				t.Fatal("profile failure stopped ordinary host")
			}
		})
	}
}
