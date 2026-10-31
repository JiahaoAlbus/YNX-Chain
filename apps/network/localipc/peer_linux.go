//go:build linux

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
	raw, err := c.SyscallConn()
	if err != nil {
		return Peer{}, err
	}
	var cred *unix.Ucred
	var inner error
	err = raw.Control(func(fd uintptr) { cred, inner = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED) })
	if err != nil {
		return Peer{}, err
	}
	if inner != nil {
		return Peer{}, inner
	}
	if cred == nil || cred.Pid <= 0 {
		return Peer{}, ErrPeerDenied
	}
	return Peer{uid: cred.Uid, gid: cred.Gid, pid: cred.Pid, pidAvailable: true, verified: true, source: "linux-SO_PEERCRED"}, nil
}

func stamp(info os.FileInfo) (fileStamp, error) {
	raw, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return fileStamp{}, ErrUnsupported
	}
	return fileStamp{Device: fmt.Sprint(raw.Dev), Inode: fmt.Sprint(raw.Ino), UID: raw.Uid, Mode: uint32(info.Mode()), Changed: fmt.Sprintf("%d:%d", raw.Ctim.Sec, raw.Ctim.Nsec)}, nil
}
