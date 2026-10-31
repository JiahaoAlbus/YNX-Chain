//go:build linux

package securelink

import (
	"net"
	"syscall"

	"golang.org/x/sys/unix"
)

func checkPeerUID(c net.Conn, want uint32) error {
	sc, ok := c.(syscall.Conn)
	if !ok {
		return ErrDenied
	}
	raw, err := sc.SyscallConn()
	if err != nil {
		return err
	}
	var check error
	err = raw.Control(func(fd uintptr) {
		cred, e := unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
		if e != nil {
			check = e
			return
		}
		if cred.Uid != want {
			check = ErrDenied
		}
	})
	if err != nil {
		return err
	}
	return check
}
