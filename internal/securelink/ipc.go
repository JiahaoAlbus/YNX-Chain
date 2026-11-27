//go:build linux || darwin

package securelink

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

func privateParent(path string, uid uint32) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return ErrDenied
	}
	info, err := os.Lstat(filepath.Dir(path))
	if err != nil {
		return err
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 || uint32(st.Uid) != uid {
		return ErrDenied
	}
	return nil
}

// ListenPrivate creates an edge-dedicated socket in an existing private
// directory. It never deletes a pre-existing socket or changes another owner's
// permissions. UID is an OS service principal, not a header or request field.
func ListenPrivate(path string, callerUID uint32) (net.Listener, error) {
	return listenPrivate(path, callerUID, false)
}

// ListenPrivateWithCloseWitness retains the original listener and the result
// of its first physical Close. Every caller must retain this returned object;
// an unknown first close is never retried or treated as confirmed.
func ListenPrivateWithCloseWitness(path string, callerUID uint32) (net.Listener, error) {
	return listenPrivate(path, callerUID, true)
}

func listenPrivate(path string, callerUID uint32, witnessed bool) (net.Listener, error) {
	if err := privateParent(path, uint32(os.Geteuid())); err != nil {
		return nil, err
	}
	l, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return nil, err
	}
	// Do not unlink after shutdown: preserve the original endpoint identity for
	// the service operator to reconcile, rather than deleting a replacement.
	l.SetUnlinkOnClose(false)
	private := &privateListener{Listener: l, uid: callerUID}
	if witnessed {
		private.closeState = &privateListenerCloseState{}
	}
	return finishPrivateListenerSetup(private, path, witnessed, os.Chmod)
}

func finishPrivateListenerSetup(private *privateListener, path string, witnessed bool, chmod func(string, os.FileMode) error) (net.Listener, error) {
	if err := chmod(path, 0600); err != nil {
		closeErr := private.Close()
		if !witnessed {
			return nil, err
		}
		if witnessed && closeErr != nil {
			return private, errors.Join(err, closeErr)
		}
		return nil, errors.Join(err, closeErr)
	}
	return private, nil
}

type privateListener struct {
	net.Listener
	uid        uint32
	closeState *privateListenerCloseState
}

type privateListenerCloseState struct {
	mu                sync.Mutex
	started, returned bool
	err               error
}

// A failed first physical close must keep its original object alive even if
// every product and server reference is later dropped.
var originalPrivateListenerCustody = struct {
	sync.Mutex
	live map[*privateListener]struct{}
}{live: make(map[*privateListener]struct{})}

func (l *privateListener) Close() error {
	if l.closeState == nil {
		return l.Listener.Close()
	}
	s := l.closeState
	s.mu.Lock()
	if s.started {
		if !s.returned {
			s.mu.Unlock()
			return ErrLocalCallerDraining
		}
		err := s.err
		s.mu.Unlock()
		return err
	}
	s.started = true
	originalPrivateListenerCustody.Lock()
	originalPrivateListenerCustody.live[l] = struct{}{}
	originalPrivateListenerCustody.Unlock()
	s.mu.Unlock()

	err := closeOriginalPrivateListener(l.Listener)
	if err != nil {
		err = errors.Join(ErrOriginalPrivateListenerCloseUnknown, err)
	}
	s.mu.Lock()
	s.returned, s.err = true, err
	s.mu.Unlock()
	if err == nil {
		originalPrivateListenerCustody.Lock()
		delete(originalPrivateListenerCustody.live, l)
		originalPrivateListenerCustody.Unlock()
	}
	return err
}

func closeOriginalPrivateListener(l net.Listener) (err error) {
	returned := false
	defer func() {
		if !returned {
			_ = recover()
			err = ErrOriginalPrivateListenerCloseUnknown
		}
	}()
	err = l.Close()
	returned = true
	return err
}

// InspectOriginalPrivateListener reports the same listener's first close. It
// cannot witness accepted connection drain, product authority, or admission.
func InspectOriginalPrivateListener(listener net.Listener) (OriginalPrivateListenerStatus, error) {
	l, ok := listener.(*privateListener)
	if !ok || l == nil || l.closeState == nil {
		return OriginalPrivateListenerStatus{}, ErrDenied
	}
	s := l.closeState
	s.mu.Lock()
	defer s.mu.Unlock()
	return OriginalPrivateListenerStatus{CloseStarted: s.started, CloseReturned: s.returned,
		CloseConfirmed: s.returned && s.err == nil, FirstError: s.err}, nil
}

// A witnessed listener selected for closure, including an UNKNOWN partial,
// is never accepted as a fresh service listener.
func (l *privateListener) permitsServe() bool {
	if l.closeState == nil {
		return true
	}
	l.closeState.mu.Lock()
	defer l.closeState.mu.Unlock()
	return !l.closeState.started
}

func (l *privateListener) Accept() (net.Conn, error) {
	for {
		c, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		if err = checkPeerUID(c, l.uid); err == nil {
			return c, nil
		}
		_ = c.Close()
	}
}

func DialPrivate(ctx context.Context, path string, peerUID uint32) (net.Conn, error) {
	if err := privateParent(path, peerUID); err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || info.Mode()&os.ModeSocket == 0 || info.Mode().Perm()&0077 != 0 || uint32(st.Uid) != peerUID {
		return nil, ErrDenied
	}
	c, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", path)
	if err != nil {
		return nil, err
	}
	if err = checkPeerUID(c, peerUID); err != nil {
		_ = c.Close()
		return nil, err
	}
	return c, nil
}

// NewIPCBackend is a fixed local destination for ingress. The private socket
// belongs to one service edge; it is not a generic proxy or a fast-path channel.
func NewIPCBackend(path string, peerUID uint32) (*http.Transport, error) {
	if err := privateParent(path, peerUID); err != nil {
		return nil, err
	}
	return &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		return DialPrivate(ctx, path, peerUID)
	}, MaxConnsPerHost: 16, MaxIdleConnsPerHost: 16, IdleConnTimeout: time.Minute, ResponseHeaderTimeout: 30 * time.Second, DisableCompression: true, DisableKeepAlives: true, MaxResponseHeaderBytes: 64 << 10}, nil
}
