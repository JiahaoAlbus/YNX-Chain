//go:build linux

package securelink

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

type originalLocalCallerPeerPlatform struct {
	procRoot, directory, stat, image *originalLocalCallerPeerFD
	imageStamp                       unix.Stat_t
}

func originalLocalCallerSameImage(a, b unix.Stat_t) bool {
	return a.Dev == b.Dev && a.Ino == b.Ino && a.Size == b.Size && a.Mode&unix.S_IFMT == unix.S_IFREG && b.Mode&unix.S_IFMT == unix.S_IFREG && a.Mtim == b.Mtim && a.Ctim == b.Ctim
}

func (p *originalLocalCallerPeer) openLinux(path string, flags int, label string) (*originalLocalCallerPeerFD, error) {
	fd, err := unix.Open(path, flags, 0)
	if err != nil {
		return nil, err
	}
	return p.own(fd, label), nil
}
func (p *originalLocalCallerPeer) openLinuxAt(directory int, path string, flags int, label string) (*originalLocalCallerPeerFD, error) {
	fd, err := unix.Openat(directory, path, flags, 0)
	if err != nil {
		return nil, err
	}
	return p.own(fd, label), nil
}

func (p *originalLocalCallerPeer) preparePlatform(ctx context.Context) (err error) {
	if p.expected.StartKind != LocalCallerLinuxProcessStart || len(p.expected.ImagePath) > 4095 {
		return ErrDenied
	}
	s := &p.platform
	// This procfs anchor and PID directory precede Dial. Later PID reuse cannot
	// redirect openat to a replacement process through a freshly resolved /proc.
	s.procRoot, err = p.openLinux("/proc", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, "proc-root")
	if err != nil {
		return err
	}
	var fs unix.Statfs_t
	if err = unix.Fstatfs(s.procRoot.fd, &fs); err != nil || fs.Type != unix.PROC_SUPER_MAGIC {
		return errors.Join(ErrDenied, err)
	}
	s.directory, err = p.openLinuxAt(s.procRoot.fd, strconv.Itoa(p.expected.PID), unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, "proc-pid-directory")
	if err != nil {
		return err
	}
	var directory unix.Stat_t
	if err = unix.Fstat(s.directory.fd, &directory); err != nil || directory.Uid != p.expected.UID {
		return errors.Join(ErrDenied, err)
	}
	s.stat, err = p.openLinuxAt(s.directory.fd, "stat", unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, "proc-stat")
	if err != nil {
		return err
	}
	if err = p.linuxStart(ctx); err != nil {
		return err
	}
	// "exe" is the held proc directory's kernel magic link. O_NOFOLLOW here
	// would inspect the link instead of the actual executable and is incorrect.
	s.image, err = p.openLinuxAt(s.directory.fd, "exe", unix.O_RDONLY|unix.O_CLOEXEC, "held-executable")
	if err != nil {
		return err
	}
	digest, stamp, err := originalLocalCallerImageDigest(ctx, s.image.fd, p.expected.ImageBytes)
	if err != nil || digest != p.expected.ImageSHA256 {
		return errors.Join(ErrDenied, err)
	}
	s.imageStamp = stamp
	return p.processPlatform(ctx)
}

func originalLocalCallerLinuxStart(raw []byte, pid int) (uint64, error) {
	text := string(raw)
	left, right := strings.IndexByte(text, '('), strings.LastIndexByte(text, ')')
	if left < 1 || right <= left || right+2 >= len(text) || text[right+1] != ' ' {
		return 0, ErrDenied
	}
	actualPID, err := strconv.Atoi(strings.TrimSpace(text[:left]))
	if err != nil || actualPID != pid {
		return 0, ErrDenied
	}
	fields := strings.Fields(text[right+2:])
	if len(fields) < 20 {
		return 0, ErrDenied
	}
	start, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil || start == 0 {
		return 0, ErrDenied
	}
	return start, nil
}
func (p *originalLocalCallerPeer) linuxStart(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if p.platform.stat == nil {
		return ErrDenied
	}
	var raw [8193]byte
	n, err := unix.Pread(p.platform.stat.fd, raw[:], 0)
	if err != nil || n <= 0 || n >= len(raw) {
		return errors.Join(ErrDenied, err)
	}
	start, err := originalLocalCallerLinuxStart(raw[:n], p.expected.PID)
	if err != nil || start != p.expected.StartA {
		return errors.Join(ErrDenied, err)
	}
	return ctx.Err()
}

func (p *originalLocalCallerPeer) peerPlatform(fd int, _ bool) (bool, error) {
	cred, err := unix.GetsockoptUcred(fd, unix.SOL_SOCKET, unix.SO_PEERCRED)
	if err != nil {
		return false, err
	}
	if cred.Uid != p.expected.UID || int(cred.Pid) != p.expected.PID {
		return false, ErrDenied
	}
	return true, nil
}
func (p *originalLocalCallerPeer) bindPlatform(ctx context.Context, fd int) error {
	if _, err := p.peerPlatform(fd, true); err != nil {
		return err
	}
	if err := p.processPlatform(ctx); err != nil {
		return err
	}
	_, err := p.peerPlatform(fd, false)
	return err
}

func (p *originalLocalCallerPeer) processPlatform(ctx context.Context) (err error) {
	s := &p.platform
	if s.directory == nil || s.image == nil {
		return ErrDenied
	}
	if err = p.linuxStart(ctx); err != nil {
		return err
	}
	var raw [4096]byte
	n, err := unix.Readlinkat(s.directory.fd, "exe", raw[:])
	if err != nil || n <= 0 || n >= len(raw) || string(raw[:n]) != p.expected.ImagePath {
		return errors.Join(ErrDenied, err)
	}
	actual, err := p.openLinuxAt(s.directory.fd, "exe", unix.O_RDONLY|unix.O_CLOEXEC, "current-executable")
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, p.finish(actual)) }()
	// Also reject replacement of the separately registered executable pathname,
	// even if the process is still executing an older unlinked inode.
	named, err := p.openLinux(p.expected.ImagePath, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, "named-executable")
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, p.finish(named)) }()
	var held, namedStamp unix.Stat_t
	if err = unix.Fstat(s.image.fd, &held); err != nil || !originalLocalCallerSameImage(held, s.imageStamp) {
		return errors.Join(ErrDenied, err)
	}
	if err = unix.Fstat(named.fd, &namedStamp); err != nil || !originalLocalCallerSameImage(namedStamp, s.imageStamp) {
		return errors.Join(ErrDenied, err)
	}
	digest, stamp, err := originalLocalCallerImageDigest(ctx, actual.fd, p.expected.ImageBytes)
	if err != nil || !originalLocalCallerSameImage(stamp, s.imageStamp) || digest != p.expected.ImageSHA256 {
		return errors.Join(ErrDenied, err)
	}
	return p.linuxStart(ctx)
}
