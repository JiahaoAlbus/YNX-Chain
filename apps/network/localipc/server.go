package localipc

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/localstore"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Config struct {
	Directory string
	Handler   Handler
}
type peerKey struct{}
type Server struct {
	directory, path, lockPath, recordPath     string
	uid                                       uint32
	dirInfo, socketInfo, lockInfo, recordInfo os.FileInfo
	madeDir                                   bool
	lease                                     *localstore.Lock
	listener                                  *net.UnixListener
	http                                      *http.Server
	cancel                                    context.CancelFunc
	mu                                        sync.Mutex
	closing                                   bool
	handlers                                  sync.WaitGroup
	closeOnce                                 sync.Once
	closeDone                                 chan struct{}
	closeErr                                  error
	handler                                   Handler
}

type peerConn struct {
	*net.UnixConn
	peer    Peer
	release func()
	once    sync.Once
}

func (c *peerConn) Close() error { err := c.UnixConn.Close(); c.once.Do(c.release); return err }

type guardedListener struct {
	*net.UnixListener
	owner uint32
	slots chan struct{}
}

func (l *guardedListener) Accept() (net.Conn, error) {
	for {
		c, err := l.AcceptUnix()
		if err != nil {
			return nil, err
		}
		peer, err := kernelPeer(c)
		if err != nil || !peer.Verified() || SameUID(l.owner, peer.UID()) != nil {
			_ = c.Close()
			continue
		}
		select {
		case l.slots <- struct{}{}:
			return &peerConn{UnixConn: c, peer: peer, release: func() { <-l.slots }}, nil
		default:
			_ = c.Close()
		}
	}
}

func Start(ctx context.Context, cfg Config) (*Server, error) {
	if !supported() {
		return nil, ErrUnsupported
	}
	if ctx == nil || cfg.Handler == nil {
		return nil, errors.New("IPC context and structured handler required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	uid := os.Geteuid()
	if uid < 0 {
		return nil, ErrUnsupported
	}
	s := &Server{directory: cfg.Directory, uid: uint32(uid), handler: cfg.Handler, closeDone: make(chan struct{})}
	if err := validatePath(cfg.Directory, true); err != nil {
		return nil, err
	}
	if _, err := os.Lstat(cfg.Directory); errors.Is(err, os.ErrNotExist) {
		if err = os.Mkdir(cfg.Directory, 0o700); err != nil {
			return nil, err
		}
		s.madeDir = true
	} else if err != nil {
		return nil, err
	}
	var err error
	s.dirInfo, err = privateDirectory(cfg.Directory, s.uid)
	if err != nil {
		return nil, err
	}
	s.path = filepath.Join(cfg.Directory, SocketName)
	s.lockPath = filepath.Join(cfg.Directory, LockName)
	s.recordPath = filepath.Join(cfg.Directory, EndpointRecordName)
	// Darwin has the smallest supported sockaddr_un; keep this transport subset
	// portable and fail instead of silently truncating a filesystem address.
	if len(s.path) > 103 {
		_ = s.cleanup()
		return nil, errors.New("private Unix socket path exceeds supported bound")
	}
	s.lease, err = localstore.Acquire(s.lockPath)
	if err != nil {
		return nil, err
	}
	if err = s.recoverKnownEndpoint(); err != nil {
		_ = s.cleanup()
		return nil, err
	}
	s.listener, err = net.ListenUnix("unix", &net.UnixAddr{Name: s.path, Net: "unix"})
	if err != nil {
		_ = s.cleanup()
		return nil, err
	}
	s.listener.SetUnlinkOnClose(false)
	s.socketInfo, err = os.Lstat(s.path)
	if err != nil || s.socketInfo.Mode()&os.ModeSocket == 0 {
		_ = s.listener.Close()
		_ = s.cleanup()
		return nil, errors.New("new endpoint is not a Unix socket")
	}
	if err = os.Chmod(s.path, 0o600); err != nil {
		_ = s.listener.Close()
		_ = s.cleanup()
		return nil, err
	}
	current, err := os.Lstat(s.path)
	if err != nil || !os.SameFile(s.socketInfo, current) {
		_ = s.listener.Close()
		_ = s.cleanup()
		return nil, ErrEndpointChanged
	}
	s.socketInfo = current
	if err = s.publishEndpoint(); err != nil {
		_ = s.listener.Close()
		_ = s.cleanup()
		return nil, err
	}
	root, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.http = &http.Server{Handler: http.HandlerFunc(s.serve), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 3 * time.Second, MaxHeaderBytes: 4 << 10, BaseContext: func(net.Listener) context.Context { return root }, ConnContext: func(ctx context.Context, c net.Conn) context.Context {
		p, ok := c.(*peerConn)
		if !ok {
			return ctx
		}
		return context.WithValue(ctx, peerKey{}, p.peer)
	}}
	go func() {
		_ = s.http.Serve(&guardedListener{UnixListener: s.listener, owner: s.uid, slots: make(chan struct{}, 16)})
		s.beginClose()
	}()
	go func() { <-root.Done(); s.beginClose() }()
	return s, nil
}
func (s *Server) SocketPath() string { return s.path }
func (s *Server) Close(ctx context.Context) error {
	if ctx == nil {
		return errors.New("close context required")
	}
	s.beginClose()
	select {
	case <-s.closeDone:
		return s.closeErr
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (s *Server) beginClose() {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closing = true
		s.mu.Unlock()
		s.cancel()
		_ = s.http.Close()
		go func() { s.handlers.Wait(); s.closeErr = s.cleanup(); close(s.closeDone) }()
	})
}
func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		writeResponse(w, protocolError("CANCELLED", "", Peer{}))
		return
	}
	s.handlers.Add(1)
	s.mu.Unlock()
	defer s.handlers.Done()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	peer, ok := r.Context().Value(peerKey{}).(Peer)
	if !ok || !peer.Verified() || SameUID(s.uid, peer.UID()) != nil {
		writeResponse(w, protocolError("DENIED", "", Peer{}))
		return
	}
	if r.Method != http.MethodPost || r.URL.Path != "/v1/call" || r.URL.RawQuery != "" || r.Host != "localipc" || r.Header.Get("Content-Type") != "application/json" {
		writeResponse(w, protocolError("INVALID", "", peer))
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxMessageBytes))
	if err != nil {
		writeResponse(w, protocolError("INVALID", "", peer))
		return
	}
	request, err := decodeRequest(raw)
	if err != nil {
		writeResponse(w, protocolError("INVALID", "", peer))
		return
	}
	if s.directoryUnchanged() != nil || !samePath(s.path, s.socketInfo) || !samePath(s.lockPath, s.lockInfo) || !samePath(s.recordPath, s.recordInfo) || s.lease.Check() != nil {
		writeResponse(w, protocolError("ENDPOINT_CHANGED", request.ID, peer))
		return
	}
	result, err := s.dispatch(r.Context(), peer, request)
	if r.Context().Err() != nil {
		writeResponse(w, protocolError("CANCELLED", request.ID, peer))
		return
	}
	if err != nil {
		writeResponse(w, protocolError("DENIED", request.ID, peer))
		return
	}
	if validateResult(request.Operation, result) != nil {
		writeResponse(w, protocolError("INTERNAL", request.ID, peer))
		return
	}
	response := protocolError("OK", request.ID, peer)
	response.Result = &result
	writeResponse(w, response)
}
func (s *Server) dispatch(ctx context.Context, p Peer, r Request) (result Result, err error) {
	defer func() {
		if recover() != nil {
			result = Result{}
			err = errors.New("structured IPC handler failed")
		}
	}()
	return s.handler(ctx, p, r)
}
func writeResponse(w http.ResponseWriter, r Response) {
	raw, err := jsonMarshalResponse(r)
	if err != nil || len(raw) > MaxMessageBytes {
		raw = []byte(`{"version":"YNX-NETWORK-LOCAL-IPC/v1","id":"","code":"INTERNAL","peer":{"uid":0,"gid":0,"credentialSource":"","nativeIPCVerified":false,"browserIdentityVerified":false}}`)
	}
	_, _ = w.Write(raw)
}
func (s *Server) directoryUnchanged() error {
	info, err := privateDirectory(s.directory, s.uid)
	if err != nil || !os.SameFile(info, s.dirInfo) {
		return ErrEndpointChanged
	}
	return nil
}
func (s *Server) cleanup() (outErr error) {
	if s.lease == nil {
		return nil
	}
	defer func() {
		if err := s.lease.Close(); err != nil && outErr == nil {
			outErr = ErrEndpointChanged
		}
	}()
	if s.directoryUnchanged() != nil || s.lease.Check() != nil {
		return ErrEndpointChanged
	}
	changed := false
	if s.recordInfo != nil && !samePath(s.recordPath, s.recordInfo) {
		changed = true
	}
	if s.socketInfo != nil {
		if samePath(s.path, s.socketInfo) {
			if err := os.Remove(s.path); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		} else {
			changed = true
		}
	}
	// The versioned endpoint record and known lock marker stay private and
	// durable. Closing only releases our own kernel lease, including on crashes.
	if changed {
		return ErrEndpointChanged
	}
	return nil
}

func samePath(path string, original os.FileInfo) bool {
	if original == nil {
		return false
	}
	current, err := os.Lstat(path)
	return err == nil && current.Mode()&os.ModeSymlink == 0 && current.Mode().Type() == original.Mode().Type() && current.Mode().Perm() == original.Mode().Perm() && os.SameFile(original, current)
}
func validatePath(path string, allowMissingLeaf bool) error {
	if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path || strings.IndexByte(path, 0) >= 0 {
		return errors.New("canonical absolute private directory required")
	}
	parts := strings.Split(strings.TrimPrefix(path, string(filepath.Separator)), string(filepath.Separator))
	current := string(filepath.Separator)
	for i, part := range parts {
		if part == "" {
			continue
		}
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			if allowMissingLeaf && i == len(parts)-1 && errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return errors.New("symlink or non-directory IPC ancestor denied")
		}
	}
	return nil
}
func privateDirectory(path string, uid uint32) (os.FileInfo, error) {
	if err := validatePath(path, false); err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	owner, err := fileOwner(info)
	if err != nil || owner != uid || info.Mode().Perm() != 0o700 || info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return nil, errors.New("IPC directory must be owner-only 0700")
	}
	return info, nil
}
