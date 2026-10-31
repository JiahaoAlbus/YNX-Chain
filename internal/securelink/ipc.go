//go:build linux || darwin

package securelink

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
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
	if err = os.Chmod(path, 0600); err != nil {
		_ = l.Close()
		return nil, err
	}
	return &privateListener{Listener: l, uid: callerUID}, nil
}

type privateListener struct {
	net.Listener
	uid uint32
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
