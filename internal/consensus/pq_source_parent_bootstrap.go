//go:build linux || darwin

package consensus

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/sys/unix"
)

// This private profile is supplied only by Core's original qualified build
// entry, independently of stdin. There is no public FD/JSON/profile setter.
type pqOriginalSourceProfile struct {
	images      [3]string
	codeProfile *pqSourceCodeProfile
}
type sourcePortStamp struct {
	fd            int
	device, inode uint64
}
type pqOriginalSourceLaunch struct {
	mu                             sync.Mutex
	generation                     uint64
	processes                      [3]pqSourceProcessIdentity
	profile                        pqOriginalSourceProfile
	current4, account, control     sourcePortStamp
	current4File, accountFile      *os.File
	controlFile                    *os.File
	sourceConn                     *net.UnixConn
	sourceContext                  *pqProtectedSourceParent
	sourceClaimed, accountConsumed bool
}

var sourceBootstrapOnce struct {
	sync.Mutex
	entered bool
}

func readSourceIdentity(r *bytes.Reader) (pqSourceProcessIdentity, error) {
	var p, uid uint32
	var a, b uint16
	var hash [32]byte
	for _, v := range []any{&p, &uid, &a, &b} {
		if binary.Read(r, binary.BigEndian, v) != nil {
			return pqSourceProcessIdentity{}, errSourceParent
		}
	}
	if p < 1 || p > 0x7fffffff || a < 1 || a > 160 || b < 1 || b > 4096 {
		return pqSourceProcessIdentity{}, errSourceParent
	}
	if _, err := io.ReadFull(r, hash[:]); err != nil {
		return pqSourceProcessIdentity{}, err
	}
	s := make([]byte, int(a)+int(b))
	if _, err := io.ReadFull(r, s); err != nil {
		return pqSourceProcessIdentity{}, err
	}
	v := pqSourceProcessIdentity{PID: int32(p), UID: uid, StartIdentity: string(s[:a]), ImagePath: string(s[a:]), ImageSHA256: hex.EncodeToString(hash[:])}
	if !sourceText(v.StartIdentity, 160) || !sourceText(v.ImagePath, 4096) || !filepath.IsAbs(v.ImagePath) || filepath.Clean(v.ImagePath) != v.ImagePath {
		return v, errSourceParent
	}
	return v, nil
}
func readSourcePort(r *bytes.Reader, purpose uint32) (sourcePortStamp, error) {
	var kind, fd uint32
	var device, inode uint64
	for _, v := range []any{&kind, &fd, &device, &inode} {
		if binary.Read(r, binary.BigEndian, v) != nil {
			return sourcePortStamp{}, errSourceParent
		}
	}
	if kind != purpose || fd < 3 || fd > 0x7fffffff || inode == 0 {
		return sourcePortStamp{}, errSourceParent
	}
	return sourcePortStamp{int(fd), device, inode}, nil
}
func (l *pqOriginalSourceLaunch) check(process context.Context) error {
	if l.profile.codeProfile == nil {
		return ErrPQOriginalSourceProfileNotSupplied
	}
	if err := l.profile.codeProfile.Current(); err != nil {
		return err
	}
	if process == nil {
		return errSourceParent
	}
	if err := process.Err(); err != nil {
		return err
	}
	if l.processes[0].PID != int32(os.Getppid()) || l.processes[1].PID != int32(os.Getpid()) {
		return errSourceParent
	}
	for i, v := range l.processes {
		if v.ImageSHA256 != l.profile.images[i] || v.UID != uint32(os.Geteuid()) {
			return errSourceParent
		}
		if err := checkPQSourceProcessIdentity(process, v); err != nil {
			return err
		}
		if i > 0 {
			p, err := sourceProcessParent(v.PID)
			if err != nil || p != l.processes[0].PID {
				return errSourceParent
			}
		}
	}
	if l.sourceConn != nil {
		return l.checkControl(process)
	}
	if err := checkSourceSocket(l.control, l.processes[0], l.processes[2]); err != nil {
		return err
	}
	return l.profile.codeProfile.Current()
}
func checkSourceSocket(p sourcePortStamp, creator, opposite pqSourceProcessIdentity) error {
	var st unix.Stat_t
	if unix.Fstat(p.fd, &st) != nil || st.Mode&unix.S_IFMT != unix.S_IFSOCK || uint64(st.Dev) != p.device || uint64(st.Ino) != p.inode {
		return errSourceParent
	}
	kind, err := unix.GetsockoptInt(p.fd, unix.SOL_SOCKET, unix.SO_TYPE)
	if err != nil || kind != unix.SOCK_STREAM {
		return errSourceParent
	}
	// Use the normal Core raw-address check. Linux's projected Name is "@"
	// for both an unnamed pair and an empty abstract address; only length two
	// is the original unnamed transport. Never relax this to Name == "@".
	if err := pqCurrent4UnnamedEndpoint(p.fd); err != nil {
		return errSourceParent
	}
	uid, pid, err := sourceKernelPeer(p.fd)
	if err != nil || uid != creator.UID || (pid != creator.PID && (pid != opposite.PID || uid != opposite.UID)) {
		return errSourceParent
	}
	return nil
}

// Capture only Core's original stdin once; no caller-selected stream or FD.
// Every port is checked against independently expected actual processes before
// adoption. The tuple arrives LATER from the real Native Source-only producer.
func captureOriginalSourceLaunch(process context.Context, profile pqOriginalSourceProfile) (*pqOriginalSourceLaunch, error) {
	return captureOriginalSourceLaunchWithReadContext(process, process, profile)
}

// Only initial optional capture reads use readCtx. Independently observed
// processes and subsequent Source lifetime always use the real process.
func captureOriginalSourceLaunchWithReadContext(process, readCtx context.Context, profile pqOriginalSourceProfile) (*pqOriginalSourceLaunch, error) {
	l, _, err := captureOriginalSourceLaunchVersions(process, readCtx, profile, 3)
	return l, err
}

// The normal entry reads original stdin once, accepting only existing v3/v4.
// Neither received DATA nor a v4 appendix can supply the CODE profile.
func captureOriginalSourceLaunchVersions(process, readCtx context.Context, profile pqOriginalSourceProfile, expected uint16) (*pqOriginalSourceLaunch, *pqOriginalFreshBrokerLaunch, error) {
	sourceBootstrapOnce.Lock()
	if sourceBootstrapOnce.entered {
		sourceBootstrapOnce.Unlock()
		return nil, nil, errSourceParent
	}
	sourceBootstrapOnce.entered = true
	sourceBootstrapOnce.Unlock()
	if process == nil || readCtx == nil {
		return nil, nil, errSourceParent
	}
	for _, s := range profile.images {
		h, e := hex.DecodeString(s)
		if e != nil || len(h) != 32 || hex.EncodeToString(h) != s {
			return nil, nil, errSourceParent
		}
	}
	if err := profile.codeProfile.Current(); err != nil {
		return nil, nil, err
	}
	info, err := os.Stdin.Stat()
	if err != nil || info.Mode()&os.ModeNamedPipe == 0 {
		return nil, nil, errSourceParent
	}
	stopInput := context.AfterFunc(readCtx, func() { _ = os.Stdin.Close() })
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 13329))
	stopInput()
	if readCtx.Err() != nil {
		return nil, nil, readCtx.Err()
	}
	if process.Err() != nil {
		return nil, nil, process.Err()
	}
	if err != nil {
		return nil, nil, err
	}
	l, fresh, err := decodeOriginalSourceLaunch(raw, profile, expected)
	if err != nil {
		return nil, nil, err
	}
	ports := []sourcePortStamp{l.current4, l.account, l.control}
	if fresh != nil {
		ports = append(ports, fresh.broker)
	}
	if err = l.check(process); err != nil {
		return nil, nil, err
	}
	for _, p := range ports {
		if err = checkSourceSocket(p, l.processes[0], l.processes[2]); err != nil {
			return nil, nil, err
		}
		flags, e := unix.FcntlInt(uintptr(p.fd), unix.F_GETFD, 0)
		if e != nil {
			return nil, nil, e
		}
		if _, e = unix.FcntlInt(uintptr(p.fd), unix.F_SETFD, flags|unix.FD_CLOEXEC); e != nil {
			return nil, nil, e
		}
	}
	if fresh != nil {
		fresh.brokerFile = os.NewFile(uintptr(fresh.broker.fd), "original Core fresh Scope broker")
	}
	l.current4File = os.NewFile(uintptr(l.current4.fd), "original Current4 Core endpoint")
	l.accountFile = os.NewFile(uintptr(l.account.fd), "original account Core endpoint")
	control := os.NewFile(uintptr(l.control.fd), "original Source parent Core endpoint")
	l.controlFile = control
	conn, err := net.FileConn(control)
	if err != nil {
		return l, fresh, err
	}
	if err = control.Close(); err != nil {
		_ = conn.Close()
		return l, fresh, err
	}
	l.controlFile = nil
	u, ok := conn.(*net.UnixConn)
	if !ok {
		_ = conn.Close()
		return l, fresh, errSourceParent
	}
	l.sourceConn = u
	// net.FileConn duplicates the socket; track its actual held original object
	// through SyscallConn rather than using the now-closed inherited number.
	return l, fresh, nil
}
func (l *pqOriginalSourceLaunch) claimSourceParent(ctx context.Context) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.sourceClaimed || l.sourceConn == nil {
		return errSourceParent
	}
	l.sourceClaimed = true
	return l.check(ctx)
}

// Context checks after net.FileConn use the actual same socket via its held
// object; original inherited FD numbers are never re-adopted after close/reuse.
func (l *pqOriginalSourceLaunch) checkControl(ctx context.Context) error {
	if err := l.checkPeers(ctx); err != nil {
		return err
	}
	if err := l.checkControlSocket(); err != nil {
		return err
	}
	return l.profile.codeProfile.Current()
}

// An original negative CANCEL cannot grant productive permission. It must keep
// the unchanged physical process/image/socket checks, but a revoked CODE record
// must not prevent same-reader cleanup from receiving that negative result.
func (l *pqOriginalSourceLaunch) checkControlIdentity(ctx context.Context) error {
	if err := l.checkPeerIdentities(ctx); err != nil {
		return err
	}
	return l.checkControlSocket()
}
func (l *pqOriginalSourceLaunch) checkControlSocket() error {
	if l == nil || l.sourceConn == nil {
		return errSourceParent
	}
	raw, err := l.sourceConn.SyscallConn()
	if err != nil {
		return err
	}
	var result error
	if err = raw.Control(func(fd uintptr) {
		s := l.control
		s.fd = int(fd)
		result = checkSourceSocket(s, l.processes[0], l.processes[2])
	}); err != nil {
		return err
	}
	return result
}
func (l *pqOriginalSourceLaunch) checkPeers(ctx context.Context) error {
	if l.profile.codeProfile == nil {
		return ErrPQOriginalSourceProfileNotSupplied
	}
	if err := l.profile.codeProfile.Current(); err != nil {
		return err
	}
	if err := l.checkPeerIdentities(ctx); err != nil {
		return err
	}
	return l.profile.codeProfile.Current()
}
func (l *pqOriginalSourceLaunch) checkPeerIdentities(ctx context.Context) error {
	if ctx == nil || l.processes[0].PID != int32(os.Getppid()) || l.processes[1].PID != int32(os.Getpid()) {
		return errSourceParent
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	for i, v := range l.processes {
		if v.ImageSHA256 != l.profile.images[i] {
			return errSourceParent
		}
		if err := checkPQSourceProcessIdentity(ctx, v); err != nil {
			return err
		}
		if i > 0 {
			p, e := sourceProcessParent(v.PID)
			if e != nil || p != l.processes[0].PID {
				return errSourceParent
			}
		}
	}
	return nil
}
func (l *pqOriginalSourceLaunch) closeUnused() error {
	var err error
	if l.controlFile != nil {
		err = l.controlFile.Close()
		l.controlFile = nil
	}
	if l.sourceConn != nil {
		err = l.sourceConn.Close()
	}
	if l.accountFile != nil {
		err = errors.Join(err, l.accountFile.Close())
		l.accountFile = nil
	}
	if l.current4File != nil {
		err = errors.Join(err, l.current4File.Close())
		l.current4File = nil
	}
	return err
}
