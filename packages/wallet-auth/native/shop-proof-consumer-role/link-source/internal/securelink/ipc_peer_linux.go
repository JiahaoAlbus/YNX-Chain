//go:build linux

package securelink

import "golang.org/x/sys/unix"

func localPeerCredentials(fd int) (uint32, int, error) {
	cred, err := unix.GetsockoptUcred(fd, unix.SOL_SOCKET, unix.SO_PEERCRED)
	if err != nil {
		return 0, 0, err
	}
	return cred.Uid, int(cred.Pid), nil
}
