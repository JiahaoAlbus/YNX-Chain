//go:build darwin

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
		cred, e := unix.GetsockoptXucred(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
		if e != nil || cred == nil || cred.Version != 0 || cred.Ngroups < 1 || int(cred.Ngroups) > len(cred.Groups) || cred.Uid != uid {
			inner = ErrSynchronization
			return
		}
		actual, e := unix.GetsockoptInt(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERPID)
		if e != nil || actual <= 0 || actual != pid {
			inner = ErrSynchronization
		}
	})
	if err != nil {
		return err
	}
	return inner
}
