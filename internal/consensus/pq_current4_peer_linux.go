package consensus

import "golang.org/x/sys/unix"

func pqCurrent4OSPeer(fd int) (pqCurrent4Peer, error) {
	c, err := unix.GetsockoptUcred(fd, unix.SOL_SOCKET, unix.SO_PEERCRED)
	if err != nil {
		return pqCurrent4Peer{}, err
	}
	return pqCurrent4Peer{uid: c.Uid, pid: c.Pid}, nil
}
