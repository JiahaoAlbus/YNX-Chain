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
