//go:build linux || darwin

package consensus

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"net"
	"os"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"golang.org/x/sys/unix"
)

// Private Current4 DATA grammar, SDK header 1197965ac26958a3. This is not a
// public FD setter, a Source factory, a policy qualifier or a new C ABI. The
// purpose-closed launcher must supply its original endpoint and independently
// established OS peer. Neither these selectors nor OS credentials grant Root,
// Native CURRENT, Source, a principal, signing or independent BFT finality.
const (
	pqCurrent4Header    = 24
	pqCurrent4PolicyMax = 8 << 20
	pqCurrent4Capture   = 1
	pqCurrent4Read      = 2
	pqCurrent4Current   = 3
	pqCurrent4Retire    = 4
	pqCurrent4Join      = 5
	pqCurrent4Close     = 6
)

var (
	errPQCurrent4Frame    = errors.New("Current4 original frame or sequence is invalid")
	errPQCurrent4Retired  = errors.New("Current4 DATA child is retired")
	errPQCurrent4Peer     = errors.New("Current4 inherited endpoint or independent OS peer differs")
	errPQCurrent4Binding  = errors.New("Current4 original owner or network differs")
	errPQCurrent4Capacity = errors.New("Current4 complete policy exceeds supplied capacity")
)

type pqCurrent4Peer struct {
	uid uint32
	pid int32
}

// One fixed worker, one original Source borrow, no per-read goroutine or queue.
// The control connection may carry JOIN/CLOSE after the captured DATA child is
// drained. A physical-complete reply covers this child's read/context debt;
// P09 still owns its process/control-endpoint stop/join and delivery evidence.
type pqCurrent4Wire struct {
	source     *PQWalletPolicyLiveSource
	parent     context.Context
	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.Mutex
	conn       *net.UnixConn
	file       *os.File
	retired    bool
	firstCause error
	done       chan struct{}
	setupDone  chan struct{}
	sequence   uint64
	owner      string
	network    [32]byte
	captured   bool
}

// attachPQCurrent4Wire is intentionally package-private. It is not reachable
// from a request, environment variable, JSON, arbitrary callback or public FD
// registration. The normal purpose-closed launcher binding is a separate owner
// obligation. After installation every nonnil partial MUST be adopted, even
// with an error; this function owns endpoint from that point on. A failed or
// completed child permanently consumes this Source slot; no UNKNOWN replacement.
func attachPQCurrent4Wire(parent context.Context, s *PQWalletPolicyLiveSource, endpoint *os.File, expected pqCurrent4Peer) (*pqCurrent4Wire, error) {
	if parent == nil || s == nil || endpoint == nil {
		return nil, errPQCurrent4Peer
	}
	if s.app == nil {
		return nil, ErrPQWalletPolicyLiveRetired
	}
	original, err := s.app.WalletPolicyLiveSource()
	if err != nil || original != s {
		return nil, ErrPQWalletPolicyLiveRetired
	}
	ctx, cancel := context.WithCancel(parent)
	w := &pqCurrent4Wire{source: s, parent: parent, ctx: ctx, cancel: cancel, file: endpoint, done: make(chan struct{}), setupDone: make(chan struct{})}
	s.mu.Lock()
	if s.retired || s.node == nil || s.app == nil || s.view == nil || s.node.IsRunning() || s.current4 != nil {
		s.mu.Unlock()
		cancel()
		return nil, ErrPQWalletPolicyLiveRetired
	}
	s.current4 = w // publish the partial BEFORE transport inspection/acquisition
	s.mu.Unlock()
	defer close(w.setupDone)
	fail := func(err error) (*pqCurrent4Wire, error) {
		w.record(err)
		w.retire()
		_ = endpoint.Close()
		w.file = nil
		close(w.done)
		return w, err
	}
	if err := parent.Err(); err != nil {
		return fail(err)
	}
	if err := pqCurrent4CheckEndpoint(endpoint, expected); err != nil {
		return fail(err)
	}
	c, err := net.FileConn(endpoint) // owning duplicate, original is closed below
	if err != nil {
		return fail(err)
	}
	u, ok := c.(*net.UnixConn)
	if !ok {
		_ = c.Close()
		return fail(errPQCurrent4Peer)
	}
	if err = endpoint.Close(); err != nil {
		_ = u.Close()
		return fail(err)
	}
	w.file = nil
	w.mu.Lock()
	w.conn = u
	w.mu.Unlock()
	if err = w.ctx.Err(); err != nil {
		_ = u.Close()
		return fail(err)
	}
	go w.serve()
	return w, nil
}

func pqCurrent4CheckEndpoint(f *os.File, expected pqCurrent4Peer) error {
	if expected.pid <= 0 {
		return errPQCurrent4Peer
	}
	fd := int(f.Fd())
	kind, err := unix.GetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_TYPE)
	if err != nil || kind != unix.SOCK_STREAM {
		return errPQCurrent4Peer
	}
	local, err := unix.Getsockname(fd)
	if err != nil {
		return errPQCurrent4Peer
	}
	peer, err := unix.Getpeername(fd)
	if err != nil {
		return errPQCurrent4Peer
	}
	l, ok1 := local.(*unix.SockaddrUnix)
	p, ok2 := peer.(*unix.SockaddrUnix)
	// The fixed transport is an unnamed inherited socketpair, not a connectable
	// pathname listener. It cannot be replaced with a same-UID public endpoint.
	if !ok1 || !ok2 || l.Name != "" || p.Name != "" {
		return errPQCurrent4Peer
	}
	actual, err := pqCurrent4OSPeer(fd)
	if err != nil || actual != expected {
		return errPQCurrent4Peer
	}
	return nil
}

func (w *pqCurrent4Wire) record(err error) {
	if err == nil {
		return
	}
	w.mu.Lock()
	if w.firstCause == nil {
		w.firstCause = err
	}
	w.mu.Unlock()
}
func (w *pqCurrent4Wire) cause() error { w.mu.Lock(); defer w.mu.Unlock(); return w.firstCause }
func (w *pqCurrent4Wire) retire() {
	w.mu.Lock()
	w.retired = true
	w.mu.Unlock()
	w.cancel()
}
func (w *pqCurrent4Wire) unavailable() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.firstCause != nil {
		return w.firstCause
	}
	if w.retired {
		return errPQCurrent4Retired
	}
	return w.ctx.Err()
}

// Called by the original Source owner before engine stores close. Cancellation
// interrupts the SAME read and transport; done is closed only after the worker
// and admitted synchronous Read really return. EOF never supplies a remote ACK.
func (w *pqCurrent4Wire) closeWalletPolicyCurrent4Child() error {
	if w == nil {
		return nil
	}
	select {
	case <-w.done:
		return w.cause()
	default:
	}
	w.record(errPQCurrent4Retired)
	w.retire()
	<-w.setupDone
	w.mu.Lock()
	c := w.conn
	f := w.file
	w.mu.Unlock()
	if c != nil {
		_ = c.Close()
	}
	if f != nil {
		_ = f.Close()
	}
	<-w.done
	return w.cause()
}

func (w *pqCurrent4Wire) serve() {
	// Parent cancellation interrupts blocked framing/output and propagates to
	// the existing synchronous source read. No replacement operation is started.
	callbackDone := make(chan struct{})
	stop := context.AfterFunc(w.parent, func() {
		defer close(callbackDone)
		w.record(w.parent.Err())
		w.retire()
		_ = w.conn.Close()
	})
	defer func() {
		if !stop() {
			<-callbackDone
		}
		w.retire()
		_ = w.conn.Close()
		close(w.done)
	}()
	for {
		op, seq, body, err := w.request()
		if err != nil {
			w.record(err)
			return
		}
		reply, closing := w.dispatch(op, body)
		// Observable trailing/pipelined input is not buffered into a future
		// operation. No second request is admitted while the first is active.
		if err = w.rejectPendingInput(); err != nil {
			w.record(err)
			return
		}
		if err = w.response(op, seq, reply); err != nil {
			w.record(err)
			return
		}
		if closing {
			return
		}
	}
}

func (w *pqCurrent4Wire) request() (byte, uint64, []byte, error) {
	h := make([]byte, pqCurrent4Header)
	if err := w.readExact(h); err != nil {
		return 0, 0, nil, err
	}
	op, seq, n := h[7], binary.BigEndian.Uint64(h[8:16]), binary.BigEndian.Uint32(h[16:20])
	if !bytes.Equal(h[:4], []byte("YNC4")) || binary.BigEndian.Uint16(h[4:6]) != 1 || h[6] != 1 || binary.BigEndian.Uint32(h[20:]) != 0 || w.sequence == math.MaxUint64 || seq != w.sequence+1 || seq == 0 {
		return 0, 0, nil, errPQCurrent4Frame
	}
	need := uint32(0)
	switch op {
	case pqCurrent4Capture:
		need = 74
	case pqCurrent4Read:
		need = 8
	case pqCurrent4Current, pqCurrent4Retire, pqCurrent4Join, pqCurrent4Close:
	default:
		return 0, 0, nil, errPQCurrent4Frame
	}
	if n != need || (seq == 1 && op != pqCurrent4Capture) || (seq != 1 && op == pqCurrent4Capture) {
		return 0, 0, nil, errPQCurrent4Frame
	}
	body := make([]byte, n)
	if err := w.readExact(body); err != nil {
		return 0, 0, nil, err
	}
	if err := w.rejectPendingInput(); err != nil {
		return 0, 0, nil, err
	}
	w.sequence = seq // consumed before any actual Source read, never retry
	return op, seq, body, nil
}

// ReadMsgUnix allows refusal of SCM_RIGHTS rather than silently accepting
// descriptors with a byte frame. Close any rights already installed by recvmsg
// even on malformed/truncated ancillary input; never retain or use them.
func (w *pqCurrent4Wire) readExact(dst []byte) error {
	for len(dst) > 0 {
		oob := make([]byte, unix.CmsgSpace(4*256))
		n, on, flags, _, err := w.conn.ReadMsgUnix(dst, oob)
		if on > 0 {
			msgs, _ := unix.ParseSocketControlMessage(oob[:on])
			for _, m := range msgs {
				if m.Header.Level == unix.SOL_SOCKET && m.Header.Type == unix.SCM_RIGHTS {
					fds, _ := unix.ParseUnixRights(&m)
					for _, fd := range fds {
						_ = unix.Close(fd)
					}
				}
			}
		}
		if on != 0 || flags&(unix.MSG_CTRUNC|unix.MSG_TRUNC) != 0 {
			return errPQCurrent4Frame
		}
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrUnexpectedEOF
		}
		dst = dst[n:]
	}
	return nil
}

func (w *pqCurrent4Wire) rejectPendingInput() error {
	raw, err := w.conn.SyscallConn()
	if err != nil {
		return err
	}
	var e error
	if err = raw.Control(func(fd uintptr) {
		fds := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
		n, pe := unix.Poll(fds, 0)
		if pe != nil {
			e = pe
		} else if n != 0 {
			e = errPQCurrent4Frame
		}
	}); err != nil {
		return err
	}
	return e
}

func (w *pqCurrent4Wire) response(op byte, seq uint64, body []byte) error {
	h := make([]byte, pqCurrent4Header)
	copy(h, "YNC4")
	binary.BigEndian.PutUint16(h[4:6], 1)
	h[6] = 2
	h[7] = op
	binary.BigEndian.PutUint64(h[8:16], seq)
	binary.BigEndian.PutUint32(h[16:20], uint32(len(body)))
	for _, p := range [][]byte{h, body} {
		for len(p) > 0 {
			n, err := w.conn.Write(p)
			if err != nil {
				return err
			}
			if n == 0 {
				return io.ErrShortWrite
			}
			p = p[n:]
		}
	}
	return nil
}

func (w *pqCurrent4Wire) status(extra int) []byte {
	b := make([]byte, 8+extra)
	// There is intentionally no invented Go-to-Native numerical namespace.
	// Present=1/code=0 is an independent denial bit; original Go cause stays held.
	if w.cause() != nil {
		binary.BigEndian.PutUint32(b[4:8], 1)
	}
	return b
}

func (w *pqCurrent4Wire) policy(capacity uint64) (PQWalletPolicyAtCheckpointView, error) {
	if err := w.unavailable(); err != nil {
		return PQWalletPolicyAtCheckpointView{}, err
	}
	if capacity == 0 || capacity > pqCurrent4PolicyMax {
		return PQWalletPolicyAtCheckpointView{}, errPQCurrent4Capacity
	}
	sealed, err := w.source.Read(w.ctx, w.owner)
	if err != nil {
		return PQWalletPolicyAtCheckpointView{}, err
	}
	v, err := sealed.OwnerPolicy()
	if err != nil {
		return PQWalletPolicyAtCheckpointView{}, err
	}
	if v.Owner != w.owner || v.NetworkID != w.network {
		return PQWalletPolicyAtCheckpointView{}, errPQCurrent4Binding
	}
	if v.ExecutionHeight == 0 || len(v.PolicyOriginal) == 0 || uint64(len(v.PolicyOriginal)) > capacity {
		return PQWalletPolicyAtCheckpointView{}, errPQCurrent4Capacity
	}
	if err = w.unavailable(); err != nil {
		return PQWalletPolicyAtCheckpointView{}, err
	}
	return v, nil
}

func (w *pqCurrent4Wire) dispatch(op byte, body []byte) ([]byte, bool) {
	if op == pqCurrent4Capture {
		copy(w.network[:], body[:32])
		w.owner = string(body[32:])
		w.captured = true // partial owner before any late read or binding failure
		if !accountaddress.IsCanonical(w.owner) {
			w.record(errPQCurrent4Binding)
			w.retire()
		} else if _, err := w.policy(pqCurrent4PolicyMax); err != nil {
			w.record(err)
			w.retire()
		}
		b := w.status(4)
		binary.BigEndian.PutUint32(b[8:], 1)
		return b, false
	}
	if !w.captured {
		w.record(errPQCurrent4Binding)
		w.retire()
		return w.status(map[bool]int{true: 4}[op >= pqCurrent4Join]), op == pqCurrent4Close
	}
	switch op {
	case pqCurrent4Read, pqCurrent4Current:
		cap := uint64(pqCurrent4PolicyMax)
		if op == pqCurrent4Read {
			cap = binary.BigEndian.Uint64(body)
		}
		v, err := w.policy(cap)
		if err != nil {
			w.record(err)
			w.retire()
			return w.status(0), false
		}
		if op == pqCurrent4Current {
			return w.status(0), false
		}
		b := w.status(58 + len(v.PolicyOriginal))
		binary.BigEndian.PutUint64(b[8:16], v.ExecutionHeight)
		binary.BigEndian.PutUint64(b[16:24], uint64(len(v.PolicyOriginal)))
		copy(b[24:66], w.owner)
		copy(b[66:], v.PolicyOriginal)
		return b, false
	case pqCurrent4Retire:
		w.retire()
		return w.status(0), false
	case pqCurrent4Join, pqCurrent4Close:
		w.retire() // no concurrent/queued read; this worker completed all earlier reads
		b := w.status(4)
		binary.BigEndian.PutUint32(b[8:], 1)
		return b, op == pqCurrent4Close
	}
	panic("validated Current4 operation escaped closed switch")
}
