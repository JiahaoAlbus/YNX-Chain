//go:build linux || darwin

package securelink

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

const taskReadContinuationService = "ynx-ai-original-task-read-v1"
const taskReadContinuationPrefix = "/internal/ai/original-task-read/"
const taskReadContinuationMaxDATA = 1 << 20

// This constructor alone declares the R/SCM protocol. The ordinary caller
// constructor never probes, guesses or falls back to a continuation protocol.
func NewOriginalTaskReadContinuationServer(cfg LocalCallerServerConfig) (*LocalCallerServer, error) {
	if cfg.Service != taskReadContinuationService || len(cfg.Routes) != 3 {
		return nil, ErrDenied
	}
	seen := make(map[string]bool)
	for _, r := range cfg.Routes {
		if r.Method != http.MethodPost || r.MaxBodyBytes < 1 || r.MaxBodyBytes > taskReadContinuationMaxDATA || seen[r.Path] {
			return nil, ErrDenied
		}
		if r.Path != taskReadContinuationPrefix+"input" && r.Path != taskReadContinuationPrefix+"execute" && r.Path != taskReadContinuationPrefix+"query" {
			return nil, ErrDenied
		}
		seen[r.Path] = true
	}
	s, err := NewLocalCallerServer(cfg)
	if err != nil {
		return nil, err
	}
	s.taskReadContinuations = make(map[*taskReadContinuationConn]struct{})
	return s, nil
}

// readMu serializes the HTTP reader only. mu protects flags/counters; no
// blocking fd operation or server callback occurs under mu. The serial token
// has one control reader/writer and is cancellable while waiting.
type taskReadContinuationConn struct {
	data                                                                                 *net.UnixConn
	server                                                                               *LocalCallerServer
	readMu                                                                               sync.Mutex
	mu                                                                                   sync.Mutex
	initial, reserved, retired, closeReturned, controlClosed, dataClosed, cleanupUnknown bool
	reads, calls                                                                         int
	first                                                                                error
	control                                                                              *net.UnixConn
	unknownRights                                                                        []int // retained diagnostic debt; never close a failed numeric fd again
	unknownConns                                                                         []net.Conn
	controlOnce, dataOnce                                                                sync.Once
	serial                                                                               chan struct{}
	changed                                                                              chan struct{}
	state                                                                                *taskReadContinuationState
}

type taskReadContinuationState struct {
	conn                  *taskReadContinuationConn
	parent                *localCallerState
	handle                *OriginalTaskReadContinuation
	digest                [32]byte
	sequence              int
	claimSelected, closed bool
}

func (p *taskReadContinuationConn) changeLocked() { close(p.changed); p.changed = make(chan struct{}) }
func (p *taskReadContinuationConn) rememberLocked(err error) {
	if err != nil && p.first == nil {
		p.first = err
	}
	p.changeLocked()
}
func (p *taskReadContinuationConn) notifyServer() {
	p.mu.Lock()
	done := p.dataClosed && p.reads == 0 && p.calls == 0 && p.closeReturned && p.controlClosed && !p.cleanupUnknown
	p.mu.Unlock()
	if done {
		p.server.mu.Lock()
		delete(p.server.taskReadContinuations, p)
		p.server.finishDrainLocked()
		p.server.mu.Unlock()
	}
}

func newTaskReadContinuationConn(c *net.UnixConn, s *LocalCallerServer) *taskReadContinuationConn {
	p := &taskReadContinuationConn{data: c, server: s, serial: make(chan struct{}, 1), changed: make(chan struct{})}
	p.serial <- struct{}{}
	return p
}

func (p *taskReadContinuationConn) rejectRights(rights []int) error {
	var first error
	for _, fd := range rights {
		if err := unix.Close(fd); err != nil {
			p.mu.Lock()
			p.unknownRights = append(p.unknownRights, fd)
			p.mu.Unlock()
			if first == nil {
				first = err
			}
		}
	}
	if first != nil {
		p.mu.Lock()
		p.cleanupUnknown = true
		p.rememberLocked(first)
		p.mu.Unlock()
	}
	return first
}

func (p *taskReadContinuationConn) recv(b []byte) (int, []int, error) {
	oob := make([]byte, unix.CmsgSpace(16*4))
	n, oobn, flags, _, err := p.data.ReadMsgUnix(b, oob)
	var rights []int
	messages, parseErr := unix.ParseSocketControlMessage(oob[:oobn])
	for _, m := range messages {
		fds, e := unix.ParseUnixRights(&m)
		if e != nil {
			parseErr = e
		} else {
			rights = append(rights, fds...)
		}
	}
	if flags&(unix.MSG_CTRUNC|unix.MSG_TRUNC) != 0 || parseErr != nil {
		_ = p.rejectRights(rights)
		return n, nil, ErrDenied
	}
	return n, rights, err
}

func (p *taskReadContinuationConn) read(b []byte) (n int, err error) {
	if len(b) == 0 {
		return 0, nil
	}
	p.readMu.Lock()
	defer p.readMu.Unlock()
	p.mu.Lock()
	if p.dataClosed {
		p.mu.Unlock()
		return 0, net.ErrClosed
	}
	p.reads++
	first := !p.initial
	p.initial = true
	p.mu.Unlock()
	defer func() { p.mu.Lock(); p.reads--; p.changeLocked(); p.mu.Unlock(); p.notifyServer() }()
	if first {
		var marker [1]byte
		n, fds, e := p.recv(marker[:])
		if e != nil || n != 1 {
			_ = p.rejectRights(fds)
			if e != nil {
				return 0, e
			}
			return 0, ErrDenied
		}
		if marker[0] == 'P' && len(fds) == 0 {
			b[0] = 'P'
			return 1, nil
		}
		if marker[0] != 'R' || len(fds) != 1 {
			_ = p.rejectRights(fds)
			return 0, ErrDenied
		}
		unix.CloseOnExec(fds[0])
		file := os.NewFile(uintptr(fds[0]), "LINK-original-task-control")
		converted, e := net.FileConn(file)
		closeErr := file.Close() // FileConn owns its new dup; original is closed once.
		if closeErr != nil {
			p.mu.Lock()
			p.cleanupUnknown = true
			p.rememberLocked(closeErr)
			p.mu.Unlock()
		}
		if e != nil {
			return 0, e
		}
		control, ok := converted.(*net.UnixConn)
		if !ok {
			if closeErr := converted.Close(); closeErr != nil {
				p.mu.Lock()
				p.cleanupUnknown = true
				p.unknownConns = append(p.unknownConns, converted)
				p.rememberLocked(closeErr)
				p.mu.Unlock()
			}
			return 0, ErrDenied
		}
		kindErr := error(nil)
		raw, e := control.SyscallConn()
		if e == nil {
			e = raw.Control(func(fd uintptr) {
				kind, x := unix.GetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_TYPE)
				if x != nil {
					kindErr = x
				} else if kind != unix.SOCK_STREAM {
					kindErr = ErrDenied
				}
			})
		}
		if e == nil {
			e = kindErr
		}
		if e == nil {
			e = localPeer(control, p.server.cfg.PeerUID, p.server.cfg.PeerPID)
		}
		p.mu.Lock()
		p.control = control
		p.reserved = true
		retired := p.retired
		if e != nil {
			p.rememberLocked(e)
		}
		p.mu.Unlock()
		if e != nil || retired || closeErr != nil {
			_ = p.retire()
			if e != nil {
				return 0, e
			}
			return 0, ErrDenied
		}
	}
	n, fds, err := p.recv(b)
	if len(fds) != 0 {
		_ = p.rejectRights(fds)
		return 0, ErrDenied
	}
	return n, err
}

func (p *taskReadContinuationConn) retire() error {
	p.mu.Lock()
	p.retired = true
	control := p.control
	p.changeLocked()
	p.mu.Unlock()
	if control != nil {
		p.controlOnce.Do(func() {
			err := control.Close()
			p.mu.Lock()
			p.closeReturned = true
			p.controlClosed = err == nil
			if err != nil {
				p.cleanupUnknown = true
				p.rememberLocked(err)
			}
			p.changeLocked()
			p.mu.Unlock()
		})
	} else {
		p.mu.Lock()
		p.closeReturned = true
		p.controlClosed = true
		p.changeLocked()
		p.mu.Unlock()
	}
	p.notifyServer()
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.first
}

func (p *taskReadContinuationConn) closeData() error {
	_ = p.retire()
	p.dataOnce.Do(func() {
		err := p.data.Close()
		p.mu.Lock()
		p.dataClosed = err == nil
		if err != nil {
			p.cleanupUnknown = true
			p.rememberLocked(err)
		}
		p.changeLocked()
		p.mu.Unlock()
	})
	p.notifyServer()
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.dataClosed {
		return p.first
	}
	return nil
}

func (s *localCallerState) originalTaskReadContinuation(ctx context.Context) (*OriginalTaskReadContinuation, error) {
	if s.continuation == nil {
		return nil, ErrDenied
	}
	if err := s.currentOriginalCaller(s.request); err != nil {
		return nil, err
	}
	if ctx == nil || ctx.Value(localCallerKey{}) != s.handle || ctx.Err() != nil {
		return nil, ErrDenied
	}
	return s.continuation.handle, nil
}

func (p *taskReadContinuationConn) bind(s *localCallerState) error {
	p.mu.Lock()
	reserved, control := p.reserved, p.control
	p.mu.Unlock()
	execute := s.material.Path == taskReadContinuationPrefix+"execute"
	if reserved != execute || s.material.ContentLength < 1 || s.material.ContentLength != int64(len(s.material.RequestBody)) || s.material.ContentType != "application/json" || len(s.request.TransferEncoding) != 0 {
		return ErrDenied
	}
	if !execute {
		return nil
	}
	if err := localPeer(control, p.server.cfg.PeerUID, p.server.cfg.PeerPID); err != nil {
		return err
	}
	st := &taskReadContinuationState{conn: p, parent: s, digest: sha256.Sum256(s.material.RequestBody)}
	st.handle = &OriginalTaskReadContinuation{state: st}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.retired || p.state != nil {
		return ErrDenied
	}
	p.state = st
	s.continuation = st
	return nil
}

func (s *taskReadContinuationState) gate(ctx context.Context) error {
	if ctx == nil || ctx.Value(localCallerKey{}) != s.parent.handle {
		return ErrDenied
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.parent.currentOriginalCaller(s.parent.request); err != nil {
		return err
	}
	if err := localPeer(s.parent.conn.UnixConn, s.parent.material.PeerUID, s.parent.material.PeerPID); err != nil {
		return err
	}
	return localPeer(s.conn.control, s.parent.material.PeerUID, s.parent.material.PeerPID)
}

func (s *taskReadContinuationState) call(ctx context.Context, command byte) (data []byte, result error) {
	p := s.conn
	if ctx == nil || ctx.Value(localCallerKey{}) != s.parent.handle {
		return nil, ErrDenied
	}
	p.mu.Lock()
	if p.retired || s.closed || p.first != nil {
		err := p.first
		p.mu.Unlock()
		if err != nil {
			return nil, err
		}
		return nil, ErrDenied
	}
	p.mu.Unlock()
	if err := s.gate(ctx); err != nil {
		return nil, err
	}
	p.mu.Lock()
	if p.retired || s.closed || p.first != nil {
		err := p.first
		p.mu.Unlock()
		if err != nil {
			return nil, err
		}
		return nil, ErrDenied
	}
	if command == 'F' {
		if s.claimSelected {
			p.mu.Unlock()
			return nil, ErrDenied
		}
		s.claimSelected = true
	}
	p.calls++
	p.changeLocked()
	p.mu.Unlock()
	defer func() { p.mu.Lock(); p.calls--; p.changeLocked(); p.mu.Unlock(); p.notifyServer() }()
	if command == 'F' {
		// A resource-fence F must never wait for an unrelated asynchronous
		// C/D while its caller holds Store.mu. The once selection remains
		// consumed even when busy; no implicit Current or retry follows.
		select {
		case <-p.serial:
		default:
			return nil, ErrLocalCallerDraining
		}
	} else {
		select {
		case <-p.serial:
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-s.parent.ctx.Done():
			return nil, s.parent.ctx.Err()
		}
	}
	defer func() { p.serial <- struct{}{} }()
	p.mu.Lock()
	if p.retired || p.first != nil || s.sequence == 64 {
		err := p.first
		p.mu.Unlock()
		if err != nil {
			return nil, err
		}
		return nil, ErrDenied
	}
	s.sequence++
	sequence := uint32(s.sequence)
	p.mu.Unlock()
	if err := s.gate(ctx); err != nil {
		return nil, err
	}
	deadline := time.Now().Add(p.server.cfg.ReadTimeout)
	for _, scope := range []context.Context{ctx, s.parent.ctx} {
		if t, ok := scope.Deadline(); ok && t.Before(deadline) {
			deadline = t
		}
	}
	if err := p.control.SetDeadline(deadline); err != nil {
		return nil, err
	}
	stopDone := make(chan struct{})
	stop := context.AfterFunc(ctx, func() { _ = p.control.SetDeadline(time.Now()); close(stopDone) })
	defer func() {
		if !stop() {
			<-stopDone
		}
	}()
	var request [41]byte
	binary.BigEndian.PutUint32(request[:4], 37)
	request[4] = command
	binary.BigEndian.PutUint32(request[5:9], sequence)
	copy(request[9:], s.digest[:])
	// Once F is selected, every path (including lost ACK) remains consumed.
	defer func() {
		if result != nil {
			p.mu.Lock()
			p.rememberLocked(result)
			p.mu.Unlock()
			_ = p.retire()
		}
	}()
	if _, err := io.CopyN(p.control, bytes.NewReader(request[:]), int64(len(request))); err != nil {
		return nil, err
	}
	var length [4]byte
	if _, err := io.ReadFull(p.control, length[:]); err != nil {
		return nil, err
	}
	size := binary.BigEndian.Uint32(length[:])
	if size < 43 || size > 43+taskReadContinuationMaxDATA {
		return nil, ErrBounds
	}
	payload := make([]byte, int(size))
	if _, err := io.ReadFull(p.control, payload); err != nil {
		return nil, err
	}
	data = bytes.Clone(payload[43:])
	if payload[0] != command || binary.BigEndian.Uint32(payload[1:5]) != sequence || !bytes.Equal(payload[5:37], s.digest[:]) {
		return data, ErrDenied
	}
	present, kind, code := payload[37], payload[38], int32(binary.BigEndian.Uint32(payload[39:43]))
	if present > 1 || (present == 0 && (kind != 0 || code != 0)) || (present == 1 && (kind < 1 || kind > 2 || kind == 2 && code != 0)) || (command != 'D' && len(data) != 0) {
		return data, ErrDenied
	}
	if present == 1 {
		result = &OriginalTaskReadContinuationRemoteError{Kind: kind, Code: code}
	}
	if err := s.gate(ctx); err != nil {
		if result == nil {
			result = err
		}
		return data, result
	}
	if result != nil {
		return data, result
	}
	if command == 'D' && (len(data) == 0 || !utf8.Valid(data) || !json.Valid(data)) {
		return data, ErrDenied
	}
	return data, nil
}

func (s *taskReadContinuationState) retire() error { return s.conn.retire() }
func (s *taskReadContinuationState) join(ctx context.Context) error {
	if ctx == nil {
		return ErrDenied
	}
	p := s.conn
	for {
		p.mu.Lock()
		if !p.retired {
			p.mu.Unlock()
			return ErrDenied
		}
		done := p.calls == 0 && p.closeReturned && p.controlClosed && !p.cleanupUnknown
		ch, err := p.changed, p.first
		p.mu.Unlock()
		if done {
			return err
		}
		select {
		case <-ch:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
func (s *taskReadContinuationState) close() error {
	_ = s.retire()
	p := s.conn
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.calls != 0 || !p.closeReturned || !p.controlClosed || p.cleanupUnknown {
		if p.cleanupUnknown && p.first != nil {
			return p.first
		}
		return ErrLocalCallerDraining
	}
	s.closed = true
	return p.first
}
func (s *taskReadContinuationState) lifetime() OriginalTaskReadContinuationLifetime {
	p := s.conn
	p.mu.Lock()
	defer p.mu.Unlock()
	return OriginalTaskReadContinuationLifetime{Retired: p.retired, Joined: p.retired && p.calls == 0 && p.closeReturned && p.controlClosed && !p.cleanupUnknown, Closed: s.closed, ClaimSelected: s.claimSelected, CleanupUnknown: p.cleanupUnknown, Calls: p.calls, Sequence: s.sequence, FirstCause: p.first, DataOnly: true}
}
