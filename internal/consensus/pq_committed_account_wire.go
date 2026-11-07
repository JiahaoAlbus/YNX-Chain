//go:build linux || darwin

package consensus

import (
	"context"
	"crypto/rand"
	"errors"
	"io"
	"net"
	"os"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// At most two original channels per owning Source. Each has one synchronous
// worker, at most one bounded public View/output, and no request queue. Closed
// readers remain channel tombstones until the worker really exits. This set is
// lifecycle accounting of actual pointers, never an identity/Root lookup map.
const pqAccountWireActiveMax = 2

type pqAccountWirePeer struct {
	uid uint32
	pid int32
}

type pqCommittedAccountWire struct {
	app    *Application
	source *PQWalletPolicyLiveSource
	owner  string
	ctx    context.Context
	// Only the private protected Source clock separates productive retirement
	// from same-reader SDK97 cleanup. Generic parent cancellation keeps its
	// original immediate transport-close semantics.
	protectedSource *pqProtectedSourceParent
	cancel          context.CancelFunc
	mu              sync.Mutex
	conn            *net.UnixConn
	firstCause      error
	setupDone, done chan struct{}
	// Below are owned only by the single serving worker until done closes.
	handler                             *PQCommittedAccountHandler
	reader                              [32]byte
	next                                uint64
	selected, terminal, retired, closed bool
}

// Private host BODY for the account purpose ONLY. The normal launcher must
// supply its actual owning App and independently selected canonical owner,
// original context, own endpoint, and independently established peer. No public
// FD setter, callback, environment/JSON selector, engine-reference lookup, C ABI
// or Root boolean is exposed. OS peer credentials do NOT prove image, Root or
// Source selection. That protected normal P09 caller is a separate requirement.
//
// A nonnil partial owns endpoint and MUST be adopted before checking err. A nil
// return has not adopted endpoint. The old Current4 slot/channel is untouched.
func attachPQCommittedAccountWire(parent context.Context, app *Application, boundOwner string, endpoint *os.File, expected pqAccountWirePeer) (*pqCommittedAccountWire, error) {
	if parent == nil || app == nil || endpoint == nil || !accountaddress.IsCanonical(boundOwner) {
		return nil, errPQAccountWireFrame
	}
	source, err := app.WalletPolicyLiveSource()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	w := &pqCommittedAccountWire{app: app, source: source, owner: boundOwner, ctx: ctx, cancel: cancel, setupDone: make(chan struct{}), done: make(chan struct{}), next: 1}
	if p, ok := parent.(*pqProtectedSourceParent); ok && p.ownsOriginalCapture() {
		w.protectedSource = p
	}
	source.mu.Lock()
	if source.retired || source.app != app || source.view == nil || source.node == nil {
		source.mu.Unlock()
		cancel()
		return nil, ErrPQWalletPolicyLiveRetired
	}
	if len(source.accountProof) >= pqAccountWireActiveMax {
		source.mu.Unlock()
		cancel()
		return nil, errPQAccountWireCapacity
	}
	if source.accountProof == nil {
		source.accountProof = make(map[pqWalletPolicyAccountProofChild]struct{})
	}
	source.accountProof[w] = struct{}{} // partial/debt published before endpoint acquisition
	source.mu.Unlock()
	defer close(w.setupDone)
	fail := func(e error) (*pqCommittedAccountWire, error) {
		w.retainProtectedSourceCause()
		w.record(e)
		cancel()
		_ = endpoint.Close()
		w.complete()
		return w, e
	}
	if err = ctx.Err(); err != nil {
		return fail(err)
	}
	// Reuse the existing OS-only socketpair checker, including Linux raw sockaddr
	// length rejection of named/empty-abstract sockets. This does not borrow a
	// resource Current4 endpoint, slot, token, frame or policy selector.
	if err = pqCurrent4CheckEndpoint(endpoint, pqCurrent4Peer{uid: expected.uid, pid: expected.pid}); err != nil {
		return fail(err)
	}
	c, err := net.FileConn(endpoint)
	if err != nil {
		return fail(err)
	}
	u, ok := c.(*net.UnixConn)
	if !ok {
		_ = c.Close()
		return fail(errPQAccountWireFrame)
	}
	if err = endpoint.Close(); err != nil {
		_ = u.Close()
		return fail(err)
	}
	w.mu.Lock()
	w.conn = u
	w.mu.Unlock()
	if err = ctx.Err(); err != nil {
		_ = u.Close()
		return fail(err)
	}
	go w.serve()
	return w, nil
}

func (w *pqCommittedAccountWire) record(e error) {
	if e == nil {
		return
	}
	w.mu.Lock()
	if w.firstCause == nil {
		w.firstCause = e
	}
	w.mu.Unlock()
}
func (w *pqCommittedAccountWire) cause() error { w.mu.Lock(); defer w.mu.Unlock(); return w.firstCause }

// Preserve the original terminal Source result even when the caller goes
// straight from OPEN to cleanup. A context error alone loses present=true,
// code=0, and cleanup must not depend on a failed productive READ to record it.
// This only samples the sealed private capture, never a caller context value.
func (w *pqCommittedAccountWire) retainProtectedSourceCause() {
	if p := w.protectedSource; p != nil {
		if err := p.Err(); err != nil {
			if cause := p.cause(); cause != nil {
				w.record(cause)
			} else {
				w.record(err)
			}
		}
	}
}
func (w *pqCommittedAccountWire) complete() {
	w.source.mu.Lock()
	close(w.done)
	delete(w.source.accountProof, w)
	w.source.mu.Unlock()
}
func (w *pqCommittedAccountWire) retireWalletPolicyAccountProofChild() { w.cancel() }
func (w *pqCommittedAccountWire) closeWalletPolicyAccountProofChild() error {
	w.cancel()
	<-w.setupDone
	w.mu.Lock()
	c := w.conn
	w.mu.Unlock()
	if c != nil {
		_ = c.Close()
	}
	<-w.done // includes the whole Capture/read, late partial, handler.Close and worker
	return w.cause()
}

func (w *pqCommittedAccountWire) serve() {
	callbackDone := make(chan struct{})
	stop := context.AfterFunc(w.ctx, func() {
		defer close(callbackDone)
		w.retainProtectedSourceCause()
		if w.protectedSource == nil || !w.protectedSource.cleanupOnly() {
			_ = w.conn.Close()
		}
	})
	var stopProcess func() bool
	processDone := make(chan struct{})
	if w.protectedSource != nil {
		stopProcess = context.AfterFunc(w.protectedSource.process, func() {
			defer close(processDone)
			w.retainProtectedSourceCause()
			w.record(w.protectedSource.process.Err())
			_ = w.conn.Close()
		})
	}
	defer func() {
		if recover() != nil {
			w.record(errors.New("original account proof wire worker failed"))
		}
		w.cancel()
		_ = w.conn.Close()
		if w.handler != nil {
			w.record(w.handler.Close())
			if !w.handler.IsClosed() {
				w.record(errors.New("original account handler physical close incomplete"))
			}
		}
		if !stop() {
			<-callbackDone
		}
		if stopProcess != nil && !stopProcess() {
			<-processDone
		}
		w.complete() // only now may Source remove this actual child
	}()
	for {
		request, err := readPQAccountWireRequest(w.conn)
		if err != nil {
			w.retainProtectedSourceCause()
			if !w.closed || !errors.Is(err, io.EOF) {
				w.record(err)
			}
			return
		}
		if err = w.sequence(request); err != nil {
			w.record(err)
			return
		}
		response := w.execute(request)
		header, err := response.header()
		if err != nil {
			w.retainProtectedSourceCause()
			w.record(err)
			return
		}
		if err = writePQAccountWire(w.conn, header[:]); err != nil {
			w.retainProtectedSourceCause()
			w.record(err)
			return
		}
		if err = writePQAccountWire(w.conn, response.payload); err != nil {
			w.retainProtectedSourceCause()
			w.record(err)
			return
		}
		w.next++
	}
}
func writePQAccountWire(w io.Writer, b []byte) error {
	for len(b) > 0 {
		n, e := w.Write(b)
		if e != nil {
			return e
		}
		if n <= 0 {
			return io.ErrShortWrite
		}
		b = b[n:]
	}
	return nil
}
func (w *pqCommittedAccountWire) sequence(f pqAccountWireFrame) error {
	if f.sequence != w.next {
		return errPQAccountWireFrame
	}
	if !w.selected {
		if f.op != pqAccountWireOpen {
			return errPQAccountWireFrame
		}
	} else if f.op == pqAccountWireOpen || f.reader != w.reader {
		return errPQAccountWireFrame
	}
	if (w.terminal || w.retired || w.closed) && f.op < pqAccountWireRetire {
		return errPQAccountWireFrame
	}
	return nil
}
func (w *pqCommittedAccountWire) failed(f pqAccountWireFrame, err error) pqAccountWireFrame {
	w.retainProtectedSourceCause()
	w.record(err)
	w.terminal = true
	if w.handler != nil {
		_ = w.handler.Retire()
	}
	f.reader = w.reader
	f.status = pqAccountWireFailed
	f.failure = true
	f.code = 0
	f.payload = nil
	return f
}
func (w *pqCommittedAccountWire) execute(f pqAccountWireFrame) pqAccountWireFrame {
	f.status = pqAccountWireOK
	f.reader = w.reader
	w.retainProtectedSourceCause()
	switch f.op {
	case pqAccountWireOpen:
		w.selected = true // select before any factory/capture; never resend/re-open
		h, err := NewPQCommittedAccountHandler(w.ctx, w.app)
		w.mu.Lock()
		w.handler = h // adopt before checking paired failure
		w.mu.Unlock()
		if h != nil {
			if _, e := rand.Read(w.reader[:]); e != nil {
				return w.failed(f, e)
			}
			if w.reader == [32]byte{} {
				return w.failed(f, errors.New("original reader token unavailable"))
			}
		}
		f.reader = w.reader
		if err != nil {
			return w.failed(f, err)
		}
		if h == nil {
			return w.failed(f, errors.New("original account handler absent"))
		}
		_, err = h.Capture(w.owner)
		if err != nil && err != ErrPQCommittedAccountNotReady {
			return w.failed(f, err)
		}
		// OPEN has no ready payload and no NotReady status. Capture remains fixed;
		// explicit later READ/CURRENT is the only readiness query.
		return f
	case pqAccountWireRead, pqAccountWireCurrent:
		var p *PQCommittedAccountProof
		var err error
		if f.op == pqAccountWireRead {
			p, err = w.handler.Read()
		} else {
			p, err = w.handler.Current()
		}
		if err == ErrPQCommittedAccountNotReady {
			f.status = pqAccountWireNotReady
			f.failure = true
			return f
		}
		if err != nil {
			return w.failed(f, err)
		}
		origin, err := p.Origin()
		if err == nil {
			err = origin.OwnedBy(w.app)
		}
		if err != nil {
			return w.failed(f, err)
		}
		v, err := p.View()
		if err != nil {
			return w.failed(f, err)
		}
		if v.HistoricalAccount.Owner != w.owner || v.CurrentAccount.Owner != w.owner {
			return w.failed(f, errPQAccountWireFrame)
		}
		f.payload, err = encodePQAccountWireView(v)
		if err != nil {
			return w.failed(f, err)
		}
		// Recheck original context/source after detached encoding, before output.
		if err = origin.OwnedBy(w.app); err != nil {
			return w.failed(f, err)
		}
		return f
	case pqAccountWireRetire:
		w.retired = true
		if err := w.handler.Retire(); err != nil {
			return w.failed(f, err)
		}
	case pqAccountWireJoin:
		if err := w.handler.Join(); err != nil {
			return w.failed(f, err)
		}
	case pqAccountWireClose:
		w.retired = true
		err := w.handler.Close()
		w.record(err)
		if !w.handler.IsClosed() {
			return w.failed(f, errors.New("original account handler physical close incomplete"))
		}
		w.closed = true
		f.status = pqAccountWireClosed
	}
	// Source cancellation may have arrived during Retire/Join/Close. Sample it
	// synchronously before publishing the cleanup result, independent of the
	// asynchronous cancellation callback. Physical CLOSED and failure are separate.
	w.retainProtectedSourceCause()
	if f.op == pqAccountWireClose {
		f.failure = w.cause() != nil
	}
	if f.op != pqAccountWireClose && w.cause() != nil {
		return w.failed(f, w.cause())
	}
	return f
}
