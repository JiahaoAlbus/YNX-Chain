//go:build linux

package ownednode

import (
	"golang.org/x/sys/unix"
	"net"
)

func verifySynchronizationPeer(connection *net.UnixConn, uid uint32, pid int) error {
	if connection == nil || pid <= 0 {
		return ErrSynchronization
	}
	raw, err := connection.SyscallConn()
	if err != nil {
		return err
	}
	var inner error
	err = raw.Control(func(fd uintptr) {
		cred, e := unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
		if e != nil || cred == nil || cred.Uid != uid || int(cred.Pid) != pid {
			inner = ErrSynchronization
		}
	})
	if err != nil {
		return err
	}
	return inner
}
