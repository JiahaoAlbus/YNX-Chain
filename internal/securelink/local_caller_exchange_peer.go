//go:build darwin || linux

package securelink

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net"
	"os"
	"sync"
	"syscall"

	"golang.org/x/sys/unix"
)

// This is an OS observation lease for the original client's actual connection.
// It does not acquire a Source, recognize an Auth reference or choose a target.
// In particular, expected values are never filled from these observations.
type originalLocalCallerPeer struct {
	mu            sync.Mutex
	expected      LocalCallerExpectedProcess
	ownerPID      int
	files         map[*originalLocalCallerPeerFD]struct{}
	active        int
	bindSelected  bool
	bound         bool
	conn          originalLocalCallerPeerConnection
	socket        originalLocalCallerSocketStamp
	closeSelected bool
	closeReturned bool
	physicalClose bool
	cleanupError  error
	platform      originalLocalCallerPeerPlatform
}

type originalLocalCallerPeerFD struct {
	fd       int
	label    string
	selected bool
	closed   bool
	err      error
}

type originalLocalCallerSocketStamp struct {
	device uint64
	inode  uint64
	kind   uint32
}

// Only private exchange state supplies the original concrete socket owner.
// This is not a public FD/provider port or a Source/current callback.
type originalLocalCallerPeerConnection interface {
	SyscallConn() (syscall.RawConn, error)
}

func originalLocalCallerPeerSocket(conn originalLocalCallerPeerConnection) bool {
	switch actual := conn.(type) {
	case *os.File:
		return actual != nil
	case *net.UnixConn:
		return actual != nil
	default:
		return false
	}
}

func prepareOriginalLocalCallerPeer(ctx context.Context, expected LocalCallerExpectedProcess) (*originalLocalCallerPeer, error) {
	p := &originalLocalCallerPeer{expected: expected, ownerPID: os.Getpid(), files: make(map[*originalLocalCallerPeerFD]struct{})}
	if ctx == nil {
		return p, ErrDenied
	}
	if err := validateLocalCallerExpectedProcess(expected); err != nil {
		return p, err
	}
	if err := ctx.Err(); err != nil {
		return p, err
	}
	p.active = 1
	err := p.preparePlatform(ctx)
	p.mu.Lock()
	p.active--
	p.mu.Unlock()
	return p, err // Nonnull owned partial, even after a failed open/hash/close.
}

func (p *originalLocalCallerPeer) begin(ctx context.Context) error {
	if p == nil || ctx == nil || p.ownerPID != os.Getpid() {
		return ErrDenied
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closeSelected {
		return ErrDenied
	}
	if p.cleanupError != nil {
		return p.cleanupError
	}
	p.active++
	return nil
}
func (p *originalLocalCallerPeer) end() { p.mu.Lock(); p.active--; p.mu.Unlock() }

func (p *originalLocalCallerPeer) own(fd int, label string) *originalLocalCallerPeerFD {
	f := &originalLocalCallerPeerFD{fd: fd, label: label}
	p.mu.Lock()
	p.files[f] = struct{}{}
	p.mu.Unlock()
	return f
}

// Every actual close is selected once, including temporary stat/image files.
// EINTR and any other failure retain the original numeric debt; neither Close
// nor GC retries a possibly reused fd. There is deliberately no finalizer.
func (p *originalLocalCallerPeer) finish(f *originalLocalCallerPeerFD) error {
	if f == nil {
		return nil
	}
	p.mu.Lock()
	if f.selected {
		err := f.err
		p.mu.Unlock()
		return err
	}
	f.selected = true
	fd := f.fd
	p.mu.Unlock()
	err := unix.Close(fd)
	p.mu.Lock()
	defer p.mu.Unlock()
	if err == nil {
		f.closed = true
		f.fd = -1
		delete(p.files, f)
		return nil
	}
	f.err = fmt.Errorf("original peer %s close: %w", f.label, err)
	if p.cleanupError == nil {
		p.cleanupError = errors.Join(ErrOriginalLocalCallerCloseUnknown, f.err)
	}
	return f.err
}

func (p *originalLocalCallerPeer) close() error {
	if p == nil || p.ownerPID != os.Getpid() {
		return ErrDenied
	}
	p.mu.Lock()
	if p.active != 0 {
		p.mu.Unlock()
		return ErrLocalCallerDraining
	}
	if p.closeSelected {
		if !p.closeReturned {
			p.mu.Unlock()
			return ErrLocalCallerDraining
		}
		err := p.cleanupError
		p.mu.Unlock()
		return err
	}
	p.closeSelected = true
	files := make([]*originalLocalCallerPeerFD, 0, len(p.files))
	for f := range p.files {
		files = append(files, f)
	}
	p.mu.Unlock()
	for _, f := range files {
		_ = p.finish(f) // finish records every failure in the actual owner.
	}
	p.mu.Lock()
	p.physicalClose = len(p.files) == 0 && p.cleanupError == nil
	p.closeReturned = true
	err := p.cleanupError
	p.mu.Unlock()
	return err
}
func (p *originalLocalCallerPeer) closed() bool {
	if p == nil || p.ownerPID != os.Getpid() {
		return false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.physicalClose
}

func originalLocalCallerSocketIdentity(fd int) (originalLocalCallerSocketStamp, error) {
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil {
		return originalLocalCallerSocketStamp{}, err
	}
	if stat.Mode&unix.S_IFMT != unix.S_IFSOCK {
		return originalLocalCallerSocketStamp{}, ErrDenied
	}
	return originalLocalCallerSocketStamp{uint64(stat.Dev), stat.Ino, uint32(stat.Mode & unix.S_IFMT)}, nil
}

func (p *originalLocalCallerPeer) bind(ctx context.Context, conn originalLocalCallerPeerConnection) error {
	if err := p.begin(ctx); err != nil {
		return err
	}
	defer p.end()
	p.mu.Lock()
	if p.bindSelected || !originalLocalCallerPeerSocket(conn) {
		p.mu.Unlock()
		return ErrDenied
	}
	p.bindSelected = true
	p.mu.Unlock()
	raw, err := conn.SyscallConn()
	if err != nil {
		return err
	}
	var observed originalLocalCallerSocketStamp
	var failure error
	err = raw.Control(func(value uintptr) {
		fd := int(value)
		observed, failure = originalLocalCallerSocketIdentity(fd)
		if failure == nil {
			failure = p.bindPlatform(ctx, fd)
		}
	})
	if err != nil {
		return err
	}
	if failure != nil {
		return failure
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	p.mu.Lock()
	p.conn, p.socket, p.bound = conn, observed, true
	p.mu.Unlock()
	return nil
}

func (p *originalLocalCallerPeer) current(ctx context.Context, conn originalLocalCallerPeerConnection, allowTerminalEOF bool) (out LocalCallerPeerObservation, err error) {
	if err = p.begin(ctx); err != nil {
		return out, err
	}
	defer p.end()
	p.mu.Lock()
	valid := p.bound && originalLocalCallerPeerSocket(conn) && p.conn == conn
	socket := p.socket
	p.mu.Unlock()
	if !valid {
		return out, ErrDenied
	}
	raw, err := conn.SyscallConn()
	if err != nil {
		return out, err
	}
	var failure error
	err = raw.Control(func(value uintptr) {
		fd := int(value)
		observed, e := originalLocalCallerSocketIdentity(fd)
		if e != nil || observed != socket {
			failure = errors.Join(ErrDenied, e)
			return
		}
		out.SameOriginalConnection = true
		peerFresh, e := p.peerPlatform(fd, false)
		if e != nil && !(allowTerminalEOF && errors.Is(e, unix.ENOTCONN)) {
			failure = e
			return
		}
		if e = p.processPlatform(ctx); e != nil {
			failure = e
			return
		}
		out.ProcessIdentityAvailable = true
		// A process/hash observation is not a syscall-spanning execution lease.
		// Recheck this same socket's peer after all process and file IO.
		again, peerErr := p.peerPlatform(fd, false)
		if peerErr != nil && !(allowTerminalEOF && errors.Is(peerErr, unix.ENOTCONN)) {
			failure = peerErr
			return
		}
		out.PeerIdentityAvailable = peerFresh && again && peerErr == nil
		var byte [1]byte
		var n int
		var peekErr error
		for attempt := 0; attempt < 16; attempt++ {
			if failure = ctx.Err(); failure != nil {
				return
			}
			n, _, peekErr = unix.Recvfrom(fd, byte[:], unix.MSG_PEEK|unix.MSG_DONTWAIT)
			if peekErr != unix.EINTR {
				break
			}
		}
		eof := peekErr == nil && n == 0
		if peekErr != nil && peekErr != unix.EAGAIN && peekErr != unix.EWOULDBLOCK {
			failure = peekErr
			return
		}
		poll := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
		for attempt := 0; attempt < 16; attempt++ {
			if failure = ctx.Err(); failure != nil {
				return
			}
			_, e = unix.Poll(poll, 0)
			if e != unix.EINTR {
				break
			}
		}
		if e != nil {
			failure = e
			return
		}
		if poll[0].Revents&(unix.POLLERR|unix.POLLNVAL) != 0 {
			failure = ErrDenied
			return
		}
		if eof {
			out.TerminalEOFObserved = true
			if !allowTerminalEOF {
				failure = ErrDenied
			}
		} else if !out.PeerIdentityAvailable || poll[0].Revents&unix.POLLHUP != 0 {
			failure = ErrDenied
		} else {
			out.LivenessProved = !allowTerminalEOF
		}
	})
	if err != nil {
		return out, err
	}
	if failure != nil {
		return out, failure
	}
	return out, ctx.Err()
}

// Hash only owned public executable descriptors, preserving their offsets.
// Regular file IO has cooperative context checks, not a promise of a hard
// kernel timeout. The exchange retains its parent until these calls return.
func originalLocalCallerImageDigest(ctx context.Context, fd int, expected uint64) ([32]byte, unix.Stat_t, error) {
	var digest [32]byte
	var before, after unix.Stat_t
	if err := unix.Fstat(fd, &before); err != nil {
		return digest, before, err
	}
	if before.Mode&unix.S_IFMT != unix.S_IFREG || before.Size <= 0 || uint64(before.Size) != expected || expected > 128<<20 {
		return digest, before, ErrDenied
	}
	hash := sha256.New()
	var buffer [16 << 10]byte
	for offset := int64(0); uint64(offset) < expected; {
		if err := ctx.Err(); err != nil {
			return digest, before, err
		}
		count := int64(len(buffer))
		if int64(expected)-offset < count {
			count = int64(expected) - offset
		}
		n, err := unix.Pread(fd, buffer[:count], offset)
		if err == unix.EINTR {
			continue
		}
		if err != nil || n <= 0 {
			return digest, before, errors.Join(ErrDenied, err)
		}
		_, _ = hash.Write(buffer[:n])
		offset += int64(n)
	}
	var extra [1]byte
	n, err := unix.Pread(fd, extra[:], int64(expected))
	if err != nil || n != 0 {
		return digest, before, errors.Join(ErrDenied, err)
	}
	if err = unix.Fstat(fd, &after); err != nil || !originalLocalCallerSameImage(before, after) {
		return digest, before, errors.Join(ErrDenied, err)
	}
	copy(digest[:], hash.Sum(nil))
	return digest, before, ctx.Err()
}
