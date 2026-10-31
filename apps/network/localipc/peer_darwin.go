//go:build darwin

package localipc

import (
	"fmt"
	"golang.org/x/sys/unix"
	"net"
	"os"
	"syscall"
)

func supported() bool { return true }
func fileOwner(info os.FileInfo) (uint32, error) {
	s, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, ErrUnsupported
	}
	return s.Uid, nil
}
func kernelPeer(c *net.UnixConn) (Peer, error) {
	var p Peer
	raw, err := c.SyscallConn()
	if err != nil {
		return p, err
	}
	var inner error
	err = raw.Control(func(fd uintptr) {
		var cred *unix.Xucred
		cred, inner = unix.GetsockoptXucred(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
		if inner != nil {
			return
		}
		if cred == nil || cred.Version != 0 || cred.Ngroups < 1 || int(cred.Ngroups) > len(cred.Groups) {
			inner = ErrPeerDenied
			return
		}
		p = Peer{uid: cred.Uid, gid: cred.Groups[0], verified: true, source: "darwin-LOCAL_PEERCRED-Xucred"}
		pid, pidErr := unix.GetsockoptInt(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERPID)
		if pidErr == nil && pid > 0 {
			p.pid = int32(pid)
			p.pidAvailable = true
		}
	})
	if err != nil {
		return Peer{}, err
	}
	if inner != nil {
		return Peer{}, inner
	}
	return p, nil
}

func stamp(info os.FileInfo) (fileStamp, error) {
	raw, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return fileStamp{}, ErrUnsupported
	}
	return fileStamp{Device: fmt.Sprint(raw.Dev), Inode: fmt.Sprint(raw.Ino), UID: raw.Uid, Mode: uint32(info.Mode()), Changed: fmt.Sprintf("%d:%d", raw.Ctimespec.Sec, raw.Ctimespec.Nsec)}, nil
}
