package securelink

import (
	"context"
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"testing"
)

type publicServerTLSBorrow struct {
	mu                sync.Mutex
	profile           originalServerTLSProfile
	listener          net.Listener
	current           func(context.Context) error
	release           func() (bool, bool, error)
	retires, releases atomic.Int32
}

func (p *publicServerTLSBorrow) originalServerTLSBorrowHeld() bool { return p.releases.Load() == 0 }

func (p *publicServerTLSBorrow) currentOriginalServerTLSCredential(ctx context.Context) error {
	p.mu.Lock()
	f := p.current
	p.mu.Unlock()
	if f != nil {
		return f(ctx)
	}
	return ctx.Err()
}
func (p *publicServerTLSBorrow) setCurrent(f func(context.Context) error) {
	p.mu.Lock()
	p.current = f
	p.mu.Unlock()
}
func (p *publicServerTLSBorrow) originalServerTLSProfile(context.Context) (originalServerTLSProfile, error) {
	return p.profile, nil
}
func (p *publicServerTLSBorrow) retireOriginalServerTLSCredential() {
	p.retires.Add(1)
	if p.listener != nil {
		_ = p.listener.Close()
	}
}
func (p *publicServerTLSBorrow) releaseOriginalServerTLSCredential(context.Context) (bool, bool, error) {
	p.releases.Add(1)
	if p.release != nil {
		return p.release()
	}
	return true, true, nil
}

// PUBLIC transport lifecycle controls only. These private fake borrows are
// neither the concrete Auth normal adapter nor reviewed Root issuance.
func TestOriginalServerTLSZeroAndFirstCloseUnknown(t *testing.T) {
	var zero OriginalServerTLS
	if !errors.Is(zero.Current(context.Background()), ErrDenied) || !errors.Is(zero.CurrentOriginalRequest(nil), ErrDenied) || zero.Lifetime().PhysicalComplete {
		t.Fatal("zero transport capability minted identity")
	}
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	injected := errors.New("PUBLIC first close unknown")
	raw := &publicFirstCloseConn{Conn: a, first: injected}
	p := &publicServerTLSBorrow{}
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	s := &originalServerTLSState{ctx: ctx, cancel: cancel, changed: make(chan struct{}), lease: p, borrowed: true, retired: true, connections: make(map[*originalServerTLSConn]struct{})}
	c := &originalServerTLSConn{state: s, httpExited: true}
	c.raw = &originalServerTLSRawConn{Conn: raw, state: s}
	s.connections[c] = struct{}{}
	o := &OriginalServerTLS{state: s}
	if !errors.Is(c.Close(), injected) || !errors.Is(c.Close(), injected) || raw.calls.Load() != 1 {
		t.Fatal("first raw close was replayed or overwritten")
	}
	if !errors.Is(o.Join(context.Background()), injected) || !errors.Is(o.Close(), injected) || !o.Lifetime().CleanupUnknown || o.Lifetime().PhysicalComplete || p.releases.Load() != 0 {
		t.Fatal("unknown accepted socket close released issuer debt")
	}
}

type publicFirstCloseConn struct {
	net.Conn
	first error
	calls atomic.Int32
}

func (c *publicFirstCloseConn) Close() error {
	if c.calls.Add(1) == 1 {
		return c.first
	}
	return net.ErrClosed
}

type publicCloseBarrierConn struct {
	net.Conn
	entered, release chan struct{}
	once             sync.Once
}

func (c *publicCloseBarrierConn) Close() error {
	c.once.Do(func() { close(c.entered) })
	<-c.release
	return c.Conn.Close()
}
func TestOriginalServerTLSCloseMustFinishBeforeForget(t *testing.T) {
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	raw := &publicCloseBarrierConn{Conn: a, entered: make(chan struct{}), release: make(chan struct{})}
	var once sync.Once
	unblock := func() { once.Do(func() { close(raw.release) }) }
	defer unblock()
	p := &publicServerTLSBorrow{}
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	s := &originalServerTLSState{ctx: ctx, cancel: cancel, changed: make(chan struct{}), lease: p, borrowed: true, retired: true, serveStarted: true, serveExited: true, connections: make(map[*originalServerTLSConn]struct{})}
	c := &originalServerTLSConn{state: s, httpExited: true, calls: 1}
	c.raw = &originalServerTLSRawConn{Conn: raw, state: s}
	s.connections[c] = struct{}{}
	o := &OriginalServerTLS{state: s}
	done := make(chan error, 1)
	go func() { done <- c.Close() }()
	<-raw.entered
	c.end()
	if o.Lifetime().Connections != 1 {
		t.Fatal("hijacked/IO-ended connection forgotten before real close returned")
	}
	cleanup, cancelCleanup := context.WithCancel(context.Background())
	cancelCleanup()
	if !errors.Is(o.Join(cleanup), context.Canceled) || o.Lifetime().PhysicalComplete || p.releases.Load() != 0 {
		t.Fatal("blocked close was counted as physical drain")
	}
	unblock()
	if e := <-done; e != nil {
		t.Fatal(e)
	}
	if e := o.Join(context.Background()); e != nil {
		t.Fatal(e)
	}
	if e := o.Close(); e != nil || !o.Lifetime().PhysicalComplete || p.releases.Load() != 1 {
		t.Fatalf("actual close did not release exactly once: %v", e)
	}
}
