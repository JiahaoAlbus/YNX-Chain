//go:build securelink_openssl && cgo && securelink_reviewed_server_tls && securelink_public_server_tls_test && (darwin || linux)

package securelink

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"weak"

	"github.com/JiahaoAlbus/YNX-Chain/internal/authservertls"
)

// The Source busy/refusal is the actual Auth type and implementation. The PQ
// listener and successful HTTP handler remain explicitly PUBLIC fixtures.
type publicPendingIssuerBorrow struct {
	*publicServerTLSBorrow
}

func (p *publicPendingIssuerBorrow) originalServerTLSAcceptRetrySafe(err error) bool {
	return authservertls.IsOriginalAcceptRetrySafe(err)
}

type publicPendingIssuerListener struct {
	net.Listener
	auth net.Listener
	once sync.Once
}

type publicHeldIssuerAccept struct {
	net.Listener
	entered, resume chan struct{}
	once            sync.Once
}

func (l *publicHeldIssuerAccept) Accept() (net.Conn, error) {
	l.once.Do(func() { close(l.entered) })
	// PUBLIC boundary barrier models a Source observation already running
	// under Auth's background Accept context. Closing the kernel listener
	// cannot prove that this issuer work has returned.
	<-l.resume
	return l.Listener.Accept()
}

func (l *publicPendingIssuerListener) Accept() (net.Conn, error) {
	pending := false
	l.once.Do(func() { pending = true })
	if pending {
		// The real Auth listener refuses before accepting any socket while its
		// SAME Source is busy. No fabricated successful Source is introduced.
		return l.auth.Accept()
	}
	return l.Listener.Accept()
}

func TestOriginalServerTLSIssuerPending(t *testing.T) {
	f := newTLSFixture(t)
	t.Run("actual-auth-pending-cancellation-and-permanent-denial", func(t *testing.T) {
		lease, loan, _, release := authservertls.PUBLICPendingServerTLSForLINK(t)
		actual := &originalAuthServerTLSCredential{lease: lease, borrow: loan}
		owner, borrow, _ := publicOriginalServerTLS(t, f)
		t.Cleanup(func() {
			owner.Retire()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_ = owner.Join(ctx)
			_ = owner.Close()
			if !owner.Lifetime().PhysicalComplete || borrow.releases.Load() != 1 {
				t.Error("original denied transport did not physically drain", owner.Lifetime())
			}
		})
		borrow.setCurrent(actual.currentOriginalServerTLSCredential)
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
		defer cancel()
		if err := owner.Current(ctx); !errors.Is(err, context.DeadlineExceeded) {
			t.Errorf("busy actual Auth Source did not wait for its own observation: %v", err)
		}
		if owner.FirstCause() != nil || owner.Lifetime().Retired || borrow.retires.Load() != 0 {
			t.Error("temporary Source contention retired the listener", owner.FirstCause(), owner.Lifetime())
		}
		if err := lease.Current(context.Background()); err != authservertls.ErrPending {
			t.Error("request timeout changed the actual Auth Source", err)
		}
		release()
		if err := owner.Current(context.Background()); !errors.Is(err, authservertls.ErrSourceDenied) ||
			!errors.Is(owner.FirstCause(), authservertls.ErrSourceDenied) || !owner.Lifetime().Retired {
			t.Error("permanent actual Source denial was softened", err, owner.FirstCause(), owner.Lifetime())
		}
	})
	t.Run("each-queued-current-validates-and-cancel-is-local", func(t *testing.T) {
		owner, borrow, _ := publicOriginalServerTLS(t, f)
		entered, resume := make(chan struct{}), make(chan struct{})
		var once sync.Once
		unblock := func() { once.Do(func() { close(resume) }) }
		defer unblock()
		var calls atomic.Int32
		borrow.setCurrent(func(ctx context.Context) error {
			if calls.Add(1) == 1 {
				close(entered)
				select {
				case <-resume:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			return nil
		})
		first := make(chan error, 1)
		go func() { first <- owner.Current(t.Context()) }()
		select {
		case <-entered:
		case <-time.After(time.Second):
			t.Fatal("first original Current did not enter")
		}
		wait, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
		defer cancel()
		if err := owner.Current(wait); !errors.Is(err, context.DeadlineExceeded) || calls.Load() != 1 {
			t.Error("queued caller skipped waiting or reused an in-flight observation", err, calls.Load())
		}
		unblock()
		select {
		case err := <-first:
			if err != nil {
				t.Error("first actual Current failed", err)
			}
		case <-time.After(time.Second):
			t.Fatal("first actual Current did not return")
		}
		if err := owner.Current(t.Context()); err != nil || calls.Load() != 2 ||
			owner.FirstCause() != nil || owner.Lifetime().Retired {
			t.Error("next caller did not perform its own validation", err, calls.Load(), owner.Lifetime())
		}
	})
	t.Run("actual-auth-listener-pending-does-not-end-http-serve", func(t *testing.T) {
		_, _, listener, _ := authservertls.PUBLICPendingServerTLSForLINK(t)
		owner, borrow, _ := publicOriginalServerTLS(t, f)
		owner.state.lease = &publicPendingIssuerBorrow{publicServerTLSBorrow: borrow}
		owner.state.listener = &publicPendingIssuerListener{Listener: owner.state.listener, auth: listener}
		var requests atomic.Int32
		server := &http.Server{ReadHeaderTimeout: time.Second, ErrorLog: log.New(io.Discard, "", 0),
			Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				requests.Add(1)
				_, _ = io.WriteString(w, "PUBLIC native request")
			})}
		done := make(chan error, 1)
		go func() { done <- owner.Serve(server) }()
		defer func() {
			_ = server.Close()
			owner.Retire()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = owner.Join(ctx)
			_ = owner.Close()
			select {
			case err := <-done:
				if !errors.Is(err, http.ErrServerClosed) {
					t.Error("original HTTP server did not stop normally", err)
				}
			case <-ctx.Done():
				t.Error("original HTTP server did not return")
			}
		}()
		conn, response, err := originalServerTLSClient(t, f, borrow.listener.Addr().String())
		if conn != nil {
			defer conn.Close()
		}
		if err != nil {
			t.Fatal("busy original issuer ended the native listener", err)
		}
		body, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr != nil || response.StatusCode != http.StatusOK || string(body) != "PUBLIC native request" ||
			requests.Load() != 1 || owner.FirstCause() != nil || owner.Lifetime().Retired {
			t.Fatal("pending listener did not recover with exact one request", readErr, requests.Load(), owner.FirstCause())
		}
	})
	t.Run("retire-wakes-queued-call-and-retains-active-issuer", func(t *testing.T) {
		owner, borrow, _ := publicOriginalServerTLS(t, f)
		entered, resume := make(chan struct{}), make(chan struct{})
		var once sync.Once
		unblock := func() { once.Do(func() { close(resume) }) }
		defer unblock()
		var calls atomic.Int32
		borrow.setCurrent(func(context.Context) error {
			if calls.Add(1) == 1 {
				close(entered)
			}
			<-resume
			return nil
		})
		first, second := make(chan error, 1), make(chan error, 1)
		go func() { first <- owner.Current(t.Context()) }()
		<-entered
		go func() { second <- owner.Current(t.Context()) }()
		wait, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		for {
			owner.state.mu.Lock()
			n, changed := owner.state.calls, owner.state.changed
			owner.state.mu.Unlock()
			if n == 2 {
				break
			}
			select {
			case <-changed:
			case <-wait.Done():
				t.Fatal("second original Current did not queue")
			}
		}
		owner.Retire()
		select {
		case err := <-second:
			if !errors.Is(err, ErrRevoked) || calls.Load() != 1 {
				t.Fatal("queued Current observed Source after retirement", err, calls.Load())
			}
		case <-wait.Done():
			t.Fatal("retirement did not wake queued Current")
		}
		probe, stop := context.WithCancel(context.Background())
		stop()
		if !errors.Is(owner.Join(probe), context.Canceled) || owner.Close() == nil ||
			owner.Lifetime().PhysicalComplete || borrow.releases.Load() != 0 {
			t.Fatal("active issuer was treated as returned", owner.Lifetime())
		}
		unblock()
		if err := <-first; !errors.Is(err, ErrRevoked) {
			t.Fatal("active Current returned qualified after retirement", err)
		}
		if err := owner.Join(wait); err != nil {
			t.Fatal("returned issuer did not join", err)
		}
		if err := owner.Close(); err != nil || !owner.Lifetime().PhysicalComplete || borrow.releases.Load() != 1 {
			t.Fatal("issuer return did not permit exact physical close", err, owner.Lifetime())
		}
		originalServerTLSCustody.Lock()
		_, held := originalServerTLSCustody.owners[owner.state]
		originalServerTLSCustody.Unlock()
		if held {
			t.Fatal("known physical close retained a completed owner")
		}
	})
	t.Run("retire-preserves-inflight-issuer-failure", func(t *testing.T) {
		owner, borrow, _ := publicOriginalServerTLS(t, f)
		entered, resume := make(chan struct{}), make(chan struct{})
		var once sync.Once
		unblock := func() { once.Do(func() { close(resume) }) }
		defer unblock()
		originalCtx := t.Context()
		borrow.setCurrent(func(ctx context.Context) error {
			close(entered)
			<-resume
			if ctx != originalCtx || ctx.Err() != nil {
				return errors.New("original issuer context changed during owner retirement")
			}
			return authservertls.ErrSourceDenied
		})
		done := make(chan error, 1)
		go func() { done <- owner.Current(originalCtx) }()
		wait, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		select {
		case <-entered:
		case <-wait.Done():
			t.Fatal("original issuer observation did not enter")
		}
		owner.Retire()
		probe, stop := context.WithCancel(context.Background())
		stop()
		if !errors.Is(owner.Join(probe), context.Canceled) || owner.Close() == nil ||
			owner.Lifetime().PhysicalComplete || borrow.releases.Load() != 0 {
			t.Fatal("retirement released a still-running original issuer", owner.Lifetime())
		}
		unblock()
		select {
		case err := <-done:
			if err != authservertls.ErrSourceDenied || originalCtx.Err() != nil ||
				owner.FirstCause() != authservertls.ErrSourceDenied {
				t.Fatal("owner retirement swallowed the original issuer failure", err, owner.FirstCause())
			}
		case <-wait.Done():
			t.Fatal("returned original issuer did not complete")
		}
		if err := owner.Join(wait); err != nil {
			t.Fatal("failed original issuer did not physically join", err)
		}
		if err := owner.Close(); err != authservertls.ErrSourceDenied ||
			!owner.Lifetime().PhysicalComplete || borrow.releases.Load() != 1 {
			t.Fatal("physical close erased original issuer first cause", err, owner.Lifetime())
		}
	})
	t.Run("background-accept-work-retains-borrow-until-return", func(t *testing.T) {
		owner, borrow, _ := publicOriginalServerTLS(t, f)
		listener := &publicHeldIssuerAccept{Listener: owner.state.listener, entered: make(chan struct{}), resume: make(chan struct{})}
		owner.state.listener = listener
		var once sync.Once
		unblock := func() { once.Do(func() { close(listener.resume) }) }
		defer unblock()
		server := &http.Server{Handler: http.NotFoundHandler()}
		done := make(chan error, 1)
		go func() { done <- owner.Serve(server) }()
		<-listener.entered
		owner.Retire()
		probe, stop := context.WithCancel(context.Background())
		stop()
		if !errors.Is(owner.Join(probe), context.Canceled) || owner.Close() == nil ||
			owner.Lifetime().ServeExited || owner.Lifetime().PhysicalComplete || borrow.releases.Load() != 0 {
			t.Fatal("background Accept was counted as complete", owner.Lifetime())
		}
		unblock()
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		select {
		case err := <-done:
			if !errors.Is(err, http.ErrServerClosed) {
				t.Fatal("retired background Accept did not stop normally", err)
			}
		case <-ctx.Done():
			t.Fatal("released background Accept did not return")
		}
		if err := owner.Join(ctx); err != nil {
			t.Fatal(err)
		}
		if err := owner.Close(); err != nil || !owner.Lifetime().PhysicalComplete || borrow.releases.Load() != 1 {
			t.Fatal("background issuer return did not permit physical close", err, owner.Lifetime())
		}
	})
	t.Run("actual-auth-unknown-close-is-not-pending", func(t *testing.T) {
		lease, calls := authservertls.PUBLICUnknownServerTLSLeaseForLINK(t)
		actual := &originalAuthServerTLSCredential{lease: lease}
		_, _, pendingListener, _ := authservertls.PUBLICPendingServerTLSForLINK(t)
		_, safePending := pendingListener.Accept()
		if actual.originalServerTLSAcceptRetrySafe(authservertls.ErrPending) ||
			actual.originalServerTLSAcceptRetrySafe(authservertls.ErrUnknown) ||
			actual.originalServerTLSAcceptRetrySafe(errors.Join(safePending, authservertls.ErrUnknown)) ||
			actual.originalServerTLSCurrentPending(errors.Join(authservertls.ErrPending, authservertls.ErrUnknown)) {
			t.Fatal("unwitnessed Accept failure became retryable")
		}
		released, closed, err := actual.releaseOriginalServerTLSCredential(t.Context())
		if !released || closed || !errors.Is(err, authservertls.ErrUnknown) ||
			errors.Is(err, errOriginalServerTLSPending) || !actual.closeUnknown {
			t.Fatal("actual Auth UNKNOWN became retryable pending", released, closed, err)
		}
		first := err
		released, closed, err = actual.releaseOriginalServerTLSCredential(t.Context())
		if !released || closed || err != first || calls.Load() != 1 {
			t.Fatal("actual unknown parent cleanup repeated or lost its first cause", released, closed, err, calls.Load())
		}
		if done, err := lease.Close(); done || !errors.Is(err, authservertls.ErrUnknown) || calls.Load() != 1 {
			t.Fatal("unknown accepted connection released the real Auth parent", done, err)
		}
	})
	t.Run("unknown-owner-remains-in-custody-after-caller-gc", func(t *testing.T) {
		lease, calls := authservertls.PUBLICUnknownServerTLSLeaseForLINK(t)
		makePartial := func() weak.Pointer[originalServerTLSState] {
			actual := &originalAuthServerTLSCredential{lease: lease}
			owner, err := newOriginalServerTLS(t.Context(), nil, nil, actual, authservertls.ErrUnknown)
			if owner == nil || !errors.Is(err, authservertls.ErrUnknown) {
				t.Fatal("actual unknown Auth partial was lost", err)
			}
			_ = owner.Join(t.Context())
			if err := owner.Close(); !errors.Is(err, authservertls.ErrUnknown) || !owner.Lifetime().CleanupUnknown {
				t.Fatal("actual Auth close debt was not kept", err)
			}
			return weak.Make(owner.state)
		}
		original := makePartial()
		runtime.GC()
		runtime.GC()
		s := original.Value()
		if s == nil {
			t.Fatal("dropping the caller lost original UNKNOWN ownership")
		}
		originalServerTLSCustody.Lock()
		_, held := originalServerTLSCustody.owners[s]
		originalServerTLSCustody.Unlock()
		owner := &OriginalServerTLS{state: s}
		if !held || owner.Lifetime().PhysicalComplete || !owner.Lifetime().IssuerLeaseHeld ||
			!errors.Is(owner.Close(), authservertls.ErrUnknown) || calls.Load() != 1 {
			t.Fatal("UNKNOWN custody was cleared or selected close retried", owner.Lifetime(), calls.Load())
		}
		runtime.KeepAlive(s)
	})
}
