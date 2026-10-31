//go:build darwin

package securelink

import "golang.org/x/sys/unix"

func localPeerCredentials(fd int) (uint32, int, error) {
	cred, err := unix.GetsockoptXucred(fd, unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	if err != nil {
		return 0, 0, err
	}
	pid, err := unix.GetsockoptInt(fd, unix.SOL_LOCAL, unix.LOCAL_PEERPID)
	return cred.Uid, pid, err
}
