//go:build darwin || linux

// Package authservertls is a PRIVATE independent Auth leaf. It acquires only
// reviewed transport credential/listener resources; it grants no Principal or
// V4 business permission. No securelink/developerauthority import or provider.
package authservertls

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
)

var ErrNotSupplied = errors.New("AUTH_REVIEWED_SERVER_TLS_NOT_SUPPLIED")
var ErrDenied = errors.New("AUTH_REVIEWED_SERVER_TLS_DENIED")
var ErrPending = errors.New("AUTH_REVIEWED_SERVER_TLS_CHILDREN_PENDING")
var ErrUnknown = errors.New("AUTH_REVIEWED_SERVER_TLS_CLEANUP_UNKNOWN")

type identity struct{ Device, Inode, UID, GID, Mode, Nlink, Bytes uint64 }
type reviewedFile struct {
	Path     string
	Identity identity
	SHA256   string
	Private  bool
}
type reviewedServerRelease struct {
	SourceID, InstanceID, IssuerRef, CredentialRef, CredentialEpoch string
	ServerName, PeerSAN, ListenAddress                              string
	NotBeforeMS, ExpiresMS                                          int64
	// Root independently selects exact original issuer/current/registration
	// public resources. These are not a caller JSON approval/new signature domain.
	IssuerOriginal, SourceOriginal, CurrentOriginal, Certificate, PrivateKey, CA reviewedFile
	TargetOrigin, CertificateSHA256, SPKISHA256                                  string
}

func reviewedServerReleases() []reviewedServerRelease { return nil }

// Owned public DATA and borrowed FDs only. The caller must retain SAME borrow
// through SSL_CTX/active connection drain. No private bytes leave this owner.
type ServerTLSOriginals struct {
	SourceID, InstanceID, IssuerRef, CredentialRef, CredentialEpoch string
	ServerName, PeerSAN, ListenAddress                              string
	NotBeforeMS, ExpiresMS                                          int64
	CertificateFD, PrivateKeyFD, CAFD                               int
	TargetOrigin, CertificateSHA256, SPKISHA256                     string
}
type heldFile struct {
	pin                      reviewedFile
	file                     *os.File
	info                     os.FileInfo
	parents                  []heldParent
	closeSelected, ambiguous bool
}
type heldParent struct {
	path                     string
	file                     *os.File
	info                     os.FileInfo
	closeSelected, ambiguous bool
}
type leaseState struct {
	mu                                     sync.Mutex
	row                                    reviewedServerRelease
	files                                  []*heldFile
	listener                               net.Listener
	borrows                                uint64
	retired, closed, listenerCloseSelected bool
	listenerCloseError                     error
	first                                  error
	wallFloor                              int64
	deadline                               time.Time
	changed                                chan struct{}
}
type ReviewedServerTLSLease struct{ state *leaseState }
type borrowState struct {
	owner    *leaseState
	released bool
	listener *originalListener
}
type ServerTLSBorrow struct{ state *borrowState }
type originalListener struct{ borrow *borrowState }

func OpenOriginalServerTLSLease(ctx context.Context) (*ReviewedServerTLSLease, error) {
	return openReviewedServerTLS(ctx, reviewedServerReleases(), 0)
}

// Private test seam passes PUBLIC identity UID/resources. There is no exported
// setter or constructor accepting rows, credentials, listener, callback or URL.
func openReviewedServerTLS(ctx context.Context, rows []reviewedServerRelease, rootUID uint32) (*ReviewedServerTLSLease, error) {
	s := &leaseState{changed: make(chan struct{})}
	out := &ReviewedServerTLSLease{s}
	fail := func(e error) (*ReviewedServerTLSLease, error) { s.first = e; s.retired = true; return out, e }
	if ctx == nil || ctx.Err() != nil {
		return fail(ErrDenied)
	}
	if len(rows) != 1 {
		return fail(ErrNotSupplied)
	}
	s.row = rows[0]
	r := s.row
	epoch, e := strconv.ParseUint(r.CredentialEpoch, 10, 64)
	host, port, pe := net.SplitHostPort(r.ListenAddress)
	n, ne := strconv.ParseUint(port, 10, 16)
	now := time.Now()
	u, ue := url.Parse(r.TargetOrigin)
	validDigest := func(s string) bool {
		b, e := hex.DecodeString(s)
		return e == nil && len(b) == 32 && hex.EncodeToString(b) == s
	}
	if ue != nil || u.Scheme != "https" || u.User != nil || u.Host == "" || u.Hostname() != r.ServerName || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.String() != r.TargetOrigin || !validDigest(r.CertificateSHA256) || !validDigest(r.SPKISHA256) {
		return fail(ErrDenied)
	}
	if r.SourceID == "" || r.InstanceID == "" || r.IssuerRef == "" || r.CredentialRef == "" || e != nil || epoch == 0 || strconv.FormatUint(epoch, 10) != r.CredentialEpoch || r.ServerName == "" || r.PeerSAN == "" || pe != nil || net.ParseIP(host) == nil || ne != nil || n == 0 || r.NotBeforeMS <= 0 || r.ExpiresMS <= r.NotBeforeMS || now.UnixMilli() < r.NotBeforeMS || now.UnixMilli() >= r.ExpiresMS || r.ExpiresMS-now.UnixMilli() > int64((365*24*time.Hour)/time.Millisecond) {
		return fail(ErrDenied)
	}
	s.wallFloor = now.UnixMilli()
	s.deadline = now.Add(time.Duration(r.ExpiresMS-s.wallFloor) * time.Millisecond)
	pins := []reviewedFile{r.IssuerOriginal, r.SourceOriginal, r.CurrentOriginal, r.Certificate, r.PrivateKey, r.CA}
	for i, p := range pins {
		if i != 4 && (p.Private || p.Path == r.PrivateKey.Path) {
			return fail(ErrDenied)
		}
		if i == 4 && (!p.Private || p.SHA256 != "") {
			return fail(ErrDenied)
		}
	}
	for _, p := range pins {
		h, e := holdReviewedFile(p, rootUID)
		if h != nil {
			s.files = append(s.files, h)
		}
		if e != nil {
			return fail(e)
		}
	}
	if e = s.currentLocked(ctx); e != nil {
		return fail(e)
	}
	// This is the one actual reviewed listener, not a substitute supplied later
	// to Serve. Default release is empty, so no real socket is opened here.
	listener, e := (&net.ListenConfig{}).Listen(ctx, "tcp", r.ListenAddress)
	if listener != nil {
		s.listener = listener
	}
	if e != nil {
		return fail(e)
	}
	if e = s.currentLocked(ctx); e != nil {
		s.retireLocked(e)
		return out, e
	}
	return out, nil
}
func id(info os.FileInfo) (identity, bool) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return identity{}, false
	}
	return identity{uint64(st.Dev), uint64(st.Ino), uint64(st.Uid), uint64(st.Gid), uint64(st.Mode), uint64(st.Nlink), uint64(st.Size)}, true
}
func stable(a, b os.FileInfo) bool {
	x, xok := id(a)
	y, yok := id(b)
	if !xok || !yok || !os.SameFile(a, b) || a.Mode() != b.Mode() {
		return false
	}
	if a.IsDir() {
		return x.Device == y.Device && x.Inode == y.Inode && x.UID == y.UID && x.GID == y.GID && x.Mode == y.Mode
	}
	return x == y && a.ModTime() == b.ModTime() && sameChangeTime(a, b)
}
func rootDirectory(p string, uid uint32) (os.FileInfo, error) {
	if !filepath.IsAbs(p) || filepath.Clean(p) != p {
		return nil, ErrDenied
	}
	i, e := os.Lstat(p)
	if e != nil {
		return nil, e
	}
	v, ok := id(i)
	if !ok || !i.IsDir() || i.Mode()&os.ModeSymlink != 0 || (v.UID != 0 && v.UID != uint64(uid)) || i.Mode().Perm()&0022 != 0 {
		return nil, ErrDenied
	}
	return i, nil
}
func holdReviewedFile(pin reviewedFile, uid uint32) (*heldFile, error) {
	h := &heldFile{pin: pin}
	if !filepath.IsAbs(pin.Path) || filepath.Clean(pin.Path) != pin.Path || pin.Identity.UID != uint64(uid) || pin.Identity.Nlink != 1 || pin.Identity.Bytes == 0 || pin.Identity.Bytes > 1048576 || pin.Identity.Mode&0022 != 0 {
		return h, ErrDenied
	}
	canonical, e := filepath.EvalSymlinks(pin.Path)
	if e != nil || canonical != pin.Path {
		return h, ErrDenied
	}
	var parents []string
	for p := filepath.Dir(pin.Path); ; p = filepath.Dir(p) {
		parents = append(parents, p)
		if p == "/" {
			break
		}
	}
	for j := len(parents) - 1; j >= 0; j-- {
		p := parents[j]
		before, e := rootDirectory(p, uid)
		if e != nil {
			return h, e
		}
		f, e := openParent(p)
		if f != nil {
			h.parents = append(h.parents, heldParent{path: p, file: f, info: before})
		}
		if e != nil {
			return h, e
		}
		after, e := f.Stat()
		if e != nil || !stable(before, after) {
			return h, ErrDenied
		}
	}
	before, e := os.Lstat(pin.Path)
	if e != nil {
		return h, e
	}
	v, ok := id(before)
	if !ok || !before.Mode().IsRegular() || before.Mode()&os.ModeSymlink != 0 || v != pin.Identity || pin.Private && before.Mode().Perm()&0007 != 0 {
		return h, ErrDenied
	}
	fd, e := syscall.Open(pin.Path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC|syscall.O_NONBLOCK, 0)
	if e != nil {
		return h, e
	}
	h.file = os.NewFile(uintptr(fd), pin.Path)
	h.info = before
	if e = h.current(); e != nil {
		return h, e
	}
	return h, nil
}
func (h *heldFile) current() error {
	if h == nil || h.file == nil || h.info == nil || h.closeSelected || h.ambiguous {
		return ErrDenied
	}
	held, e := h.file.Stat()
	if e != nil || !stable(h.info, held) {
		return ErrDenied
	}
	named, e := os.Lstat(h.pin.Path)
	if e != nil || !stable(held, named) || named.Mode()&os.ModeSymlink != 0 {
		return ErrDenied
	}
	for _, p := range h.parents {
		if p.file == nil || p.closeSelected || p.ambiguous {
			return ErrDenied
		}
		a, e := p.file.Stat()
		if e != nil || !stable(p.info, a) {
			return ErrDenied
		}
		b, e := os.Lstat(p.path)
		if e != nil || !stable(a, b) {
			return ErrDenied
		}
	}
	// Never read/hash private-key bytes. Native OpenSSL alone consumes that FD.
	if !h.pin.Private {
		raw, e := io.ReadAll(io.NewSectionReader(h.file, 0, int64(h.pin.Identity.Bytes)+1))
		if e != nil || uint64(len(raw)) != h.pin.Identity.Bytes {
			return ErrDenied
		}
		sum := sha256.Sum256(raw)
		if len(h.pin.SHA256) != 64 || hex.EncodeToString(sum[:]) != h.pin.SHA256 {
			return ErrDenied
		}
	}
	after, e := h.file.Stat()
	post, e2 := os.Lstat(h.pin.Path)
	if e != nil || e2 != nil || !stable(held, after) || !stable(after, post) {
		return ErrDenied
	}
	for _, p := range h.parents {
		a, e := p.file.Stat()
		b, e2 := os.Lstat(p.path)
		if e != nil || e2 != nil || !stable(p.info, a) || !stable(a, b) {
			return ErrDenied
		}
	}
	return nil
}
func (s *leaseState) wake() { close(s.changed); s.changed = make(chan struct{}) }
func (s *leaseState) retireLocked(e error) {
	s.retired = true
	if e != nil && s.first == nil {
		s.first = e
	}
	if s.listener != nil && !s.listenerCloseSelected {
		s.listenerCloseSelected = true
		s.listenerCloseError = s.listener.Close()
		if s.listenerCloseError != nil && s.first == nil {
			s.first = s.listenerCloseError
		}
	}
	s.wake()
}
func (s *leaseState) currentLocked(ctx context.Context) error {
	if s.retired || s.closed || ctx == nil || ctx.Err() != nil {
		return ErrDenied
	}
	before := time.Now()
	if before.UnixMilli() < s.wallFloor || before.UnixMilli() >= s.row.ExpiresMS || !before.Before(s.deadline) {
		s.retireLocked(ErrDenied)
		return ErrDenied
	}
	for _, f := range s.files {
		if e := f.current(); e != nil {
			s.retireLocked(e)
			return e
		}
	}
	after := time.Now()
	if after.Before(before) || after.UnixMilli() >= s.row.ExpiresMS || !after.Before(s.deadline) {
		s.retireLocked(ErrDenied)
		return ErrDenied
	}
	// A single request's cancellation is not issuer revocation. Refuse only
	// this observation; genuine FD/window changes above remain sticky.
	if e := ctx.Err(); e != nil {
		return e
	}
	s.wallFloor = after.UnixMilli()
	return nil
}
func (l *ReviewedServerTLSLease) Current(ctx context.Context) error {
	if l == nil || l.state == nil {
		return ErrDenied
	}
	s := l.state
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.currentLocked(ctx)
}
func (l *ReviewedServerTLSLease) BorrowOriginal(ctx context.Context) (*ServerTLSBorrow, error) {
	if l == nil || l.state == nil {
		return nil, ErrDenied
	}
	s := l.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := s.currentLocked(ctx); e != nil {
		return nil, e
	}
	if s.borrows == ^uint64(0) {
		return nil, ErrDenied
	}
	s.borrows++
	b := &ServerTLSBorrow{&borrowState{owner: s}}
	b.state.listener = &originalListener{b.state}
	return b, nil
}
func (b *ServerTLSBorrow) Current(ctx context.Context) error {
	if b == nil || b.state == nil || b.state.owner == nil {
		return ErrDenied
	}
	s := b.state.owner
	s.mu.Lock()
	defer s.mu.Unlock()
	if b.state.released {
		return ErrDenied
	}
	return s.currentLocked(ctx)
}
func (b *ServerTLSBorrow) OriginalCredentials(ctx context.Context) (ServerTLSOriginals, error) {
	var zero ServerTLSOriginals
	if b == nil || b.state == nil || b.state.owner == nil {
		return zero, ErrDenied
	}
	s := b.state.owner
	s.mu.Lock()
	defer s.mu.Unlock()
	if b.state.released {
		return zero, ErrDenied
	}
	if e := s.currentLocked(ctx); e != nil {
		return zero, e
	}
	if len(s.files) != 6 {
		return zero, ErrDenied
	}
	r := s.row
	v := ServerTLSOriginals{r.SourceID, r.InstanceID, r.IssuerRef, r.CredentialRef, r.CredentialEpoch, r.ServerName, r.PeerSAN, r.ListenAddress, r.NotBeforeMS, r.ExpiresMS, int(s.files[3].file.Fd()), int(s.files[4].file.Fd()), int(s.files[5].file.Fd()), r.TargetOrigin, r.CertificateSHA256, r.SPKISHA256}
	if e := s.currentLocked(ctx); e != nil {
		return zero, e
	}
	return v, nil
}
func (b *ServerTLSBorrow) OriginalListener(ctx context.Context) (net.Listener, error) {
	if e := b.Current(ctx); e != nil {
		return nil, e
	}
	if b.state.owner.listener == nil {
		return nil, ErrDenied
	}
	return b.state.listener, nil
}
func (b *ServerTLSBorrow) Release() (bool, error) {
	if b == nil || b.state == nil || b.state.owner == nil {
		return false, ErrDenied
	}
	s := b.state.owner
	s.mu.Lock()
	defer s.mu.Unlock()
	if b.state.released {
		return true, nil
	}
	if s.borrows == 0 {
		return false, ErrUnknown
	}
	b.state.released = true
	s.borrows--
	s.wake()
	return true, nil
}
func (l *ReviewedServerTLSLease) Retire() {
	if l != nil && l.state != nil {
		s := l.state
		s.mu.Lock()
		s.retireLocked(nil)
		s.mu.Unlock()
	}
}
func (l *ReviewedServerTLSLease) Join(ctx context.Context) error {
	if l == nil || l.state == nil {
		return nil
	}
	if ctx == nil {
		return ErrDenied
	}
	s := l.state
	for {
		s.mu.Lock()
		if s.retired && s.borrows == 0 {
			s.mu.Unlock()
			return nil
		}
		changed := s.changed
		s.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
		}
	}
}
func (l *ReviewedServerTLSLease) Close() (bool, error) {
	if l == nil || l.state == nil {
		return true, nil
	}
	s := l.state
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retireLocked(nil)
	if s.closed {
		return true, s.first
	}
	if s.borrows != 0 {
		return false, ErrPending
	}
	if s.listenerCloseError != nil {
		return false, ErrUnknown
	}
	for i := len(s.files) - 1; i >= 0; i-- {
		if e := s.files[i].closeOriginal(); e != nil {
			if s.first == nil {
				s.first = e
			}
			return false, e
		}
	}
	s.closed = true
	s.wake()
	return true, s.first
}
func (h *heldFile) closeOriginal() error {
	if h.ambiguous {
		return ErrUnknown
	}
	if h.file != nil {
		if h.closeSelected {
			return ErrUnknown
		}
		h.closeSelected = true
		if e := h.file.Close(); e != nil {
			h.ambiguous = true
			return e
		}
		h.file = nil
	}
	for i := len(h.parents) - 1; i >= 0; i-- {
		p := &h.parents[i]
		if p.ambiguous {
			return ErrUnknown
		}
		if p.file != nil {
			if p.closeSelected {
				return ErrUnknown
			}
			p.closeSelected = true
			if e := p.file.Close(); e != nil {
				p.ambiguous = true
				return e
			}
			p.file = nil
		}
	}
	return nil
}
func (l *originalListener) Accept() (net.Conn, error) {
	if l == nil || l.borrow == nil {
		return nil, net.ErrClosed
	}
	b := &ServerTLSBorrow{l.borrow}
	if e := b.Current(context.Background()); e != nil {
		return nil, e
	}
	c, e := l.borrow.owner.listener.Accept()
	if e != nil {
		return c, e
	}
	if e = b.Current(context.Background()); e != nil {
		_ = c.Close()
		return nil, e
	}
	return c, nil
}
func (l *originalListener) Addr() net.Addr {
	if l == nil || l.borrow == nil || l.borrow.owner.listener == nil {
		return nil
	}
	return l.borrow.owner.listener.Addr()
}
func (l *originalListener) Close() error {
	if l == nil || l.borrow == nil || l.borrow.owner == nil {
		return nil
	}
	s := l.borrow.owner
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retireLocked(nil)
	return s.listenerCloseError
}

var _ net.Listener = (*originalListener)(nil)
