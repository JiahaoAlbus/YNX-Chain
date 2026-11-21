//go:build darwin || linux

package authservertls

import (
	"context"
	"errors"
	"net"
	"runtime"
	"testing"
	"time"
)

type acceptTestConn struct {
	net.Conn
	closeErr error
	calls    int
}

func (c *acceptTestConn) Close() error {
	c.calls++
	if c.closeErr != nil {
		return c.closeErr
	}
	return c.Conn.Close()
}

type acceptTestListener struct {
	c     net.Conn
	calls int
}

func (l *acceptTestListener) Accept() (net.Conn, error) { l.calls++; return l.c, nil }
func (l *acceptTestListener) Close() error              { return nil }
func (l *acceptTestListener) Addr() net.Addr            { return nil }

func TestOriginalAcceptRejectsNilConnectionWithoutError(t *testing.T) {
	underlying := &acceptTestListener{}
	s := &leaseState{listener: underlying, changed: make(chan struct{})}
	l := &originalListener{borrow: &borrowState{owner: s}}
	calls := 0
	conn, err := l.acceptWithCurrent(func() error { calls++; return nil })
	if conn != nil || !errors.Is(err, ErrUnknown) || IsOriginalAcceptRetrySafe(err) {
		t.Fatalf("nil Accept result escaped or became retryable: %v %v", conn, err)
	}
	if calls != 1 || underlying.calls != 1 || s.acceptChecks != 0 || !s.retired || !errors.Is(s.first, ErrUnknown) {
		t.Fatalf("owner not retired cleanly: checks=%d retired=%t first=%v", s.acceptChecks, s.retired, s.first)
	}
	if _, err := l.acceptWithCurrent(func() error { return nil }); !errors.Is(err, ErrDenied) || underlying.calls != 1 {
		t.Fatalf("retired listener was reused: %v calls=%d", err, underlying.calls)
	}
}

func TestOriginalAcceptPendingCloseOwnership(t *testing.T) {
	for _, tc := range []struct {
		name       string
		before     bool
		closeFails bool
	}{
		{"before accept", true, false}, {"after accept closed", false, false}, {"after accept close unknown", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, b := net.Pipe()
			defer b.Close()
			defer a.Close()
			closeFailure := errors.New("PUBLIC injected physical close failure")
			c := &acceptTestConn{Conn: a}
			if tc.closeFails {
				c.closeErr = closeFailure
			}
			underlying := &acceptTestListener{c: c}
			s := &leaseState{listener: underlying, changed: make(chan struct{})}
			l := &originalListener{borrow: &borrowState{owner: s}}
			calls := 0
			got, err := l.acceptWithCurrent(func() error {
				calls++
				if tc.before || calls == 2 {
					return ErrPending
				}
				return nil
			})
			if got != nil {
				t.Fatal("connection escaped")
			}
			if tc.closeFails {
				if !errors.Is(err, ErrUnknown) || !errors.Is(err, closeFailure) || !errors.Is(err, ErrPending) || IsOriginalAcceptRetrySafe(err) || c.calls != 1 {
					t.Fatal(err, c.calls)
				}
				if len(s.acceptedCloseDebt) != 1 || s.acceptedCloseDebt[0] != c || !errors.Is(s.first, ErrPending) || !errors.Is(s.acceptedCloseErrors[0], closeFailure) {
					t.Fatal("lost first cause or close debt")
				}
				lease := &ReviewedServerTLSLease{s}
				if done, e := lease.Close(); done || !errors.Is(e, ErrUnknown) {
					t.Fatal(done, e)
				}
				if e := lease.Join(context.Background()); !errors.Is(e, ErrUnknown) {
					t.Fatal(e)
				}
				if c.calls != 1 {
					t.Fatal("ambiguous close retried")
				}
			} else if !errors.Is(err, ErrPending) || !IsOriginalAcceptRetrySafe(err) || c.calls != underlying.calls {
				t.Fatal(err, c.calls, underlying.calls)
			}
		})
	}
	if IsOriginalAcceptRetrySafe(ErrPending) {
		t.Fatal("bare pending advertised as safe")
	}
}

func TestAmbiguousAcceptCloseRemainsOwnedAfterLeaseGC(t *testing.T) {
	finalized := make(chan struct{}, 1)
	func() {
		a, b := net.Pipe()
		defer b.Close()
		c := &acceptTestConn{Conn: a, closeErr: errors.New("PUBLIC close failure")}
		runtime.SetFinalizer(c, func(*acceptTestConn) { finalized <- struct{}{} })
		s := &leaseState{listener: &acceptTestListener{c: c}, changed: make(chan struct{})}
		l := &originalListener{borrow: &borrowState{owner: s}}
		calls := 0
		_, err := l.acceptWithCurrent(func() error {
			calls++
			if calls == 2 {
				return ErrPending
			}
			return nil
		})
		if !errors.Is(err, ErrPending) || !errors.Is(err, ErrUnknown) || IsOriginalAcceptRetrySafe(err) || c.calls != 1 {
			t.Fatal(err)
		}
	}()
	for i := 0; i < 4; i++ {
		runtime.GC()
		select {
		case <-finalized:
			t.Fatal("unknown-close connection lost process ownership")
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestAcceptRetireDuringPostCurrentKeepsChildUntilClose(t *testing.T) {
	for _, failClose := range []bool{false, true} {
		t.Run(map[bool]string{false: "close-confirmed", true: "close-unknown"}[failClose], func(t *testing.T) {
			a, b := net.Pipe()
			defer a.Close()
			defer b.Close()
			c := &acceptTestConn{Conn: a}
			if failClose {
				c.closeErr = errors.New("PUBLIC physical close failed")
			}
			s := &leaseState{listener: &acceptTestListener{c: c}, changed: make(chan struct{})}
			l := &originalListener{borrow: &borrowState{owner: s}}
			lease := &ReviewedServerTLSLease{s}
			entered, release := make(chan struct{}), make(chan struct{})
			type result struct {
				conn net.Conn
				err  error
			}
			done := make(chan result, 1)
			go func() {
				calls := 0
				conn, err := l.acceptWithCurrent(func() error {
					calls++
					if calls == 2 {
						close(entered)
						<-release
					}
					return nil
				})
				done <- result{conn, err}
			}()
			<-entered
			lease.Retire()
			if closed, err := lease.Close(); closed || !errors.Is(err, ErrPending) {
				t.Fatal(closed, err)
			}
			close(release)
			res := <-done
			if res.conn != nil || c.calls != 1 || IsOriginalAcceptRetrySafe(res.err) {
				t.Fatal("connection escaped or was retried", res.err, c.calls)
			}
			if failClose {
				if !errors.Is(res.err, ErrUnknown) || !errors.Is(res.err, ErrDenied) {
					t.Fatal(res.err)
				}
				if closed, err := lease.Close(); closed || !errors.Is(err, ErrUnknown) {
					t.Fatal(closed, err)
				}
			} else {
				if !errors.Is(res.err, ErrDenied) {
					t.Fatal(res.err)
				}
				if closed, err := lease.Close(); !closed || err != nil {
					t.Fatal(closed, err)
				}
			}
		})
	}
}
