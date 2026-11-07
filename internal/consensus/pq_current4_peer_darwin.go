package consensus

import "golang.org/x/sys/unix"

func pqCurrent4OSPeer(fd int) (pqCurrent4Peer, error) {
	c, err := unix.GetsockoptXucred(fd, unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	if err != nil {
		return pqCurrent4Peer{}, err
	}
	p, err := unix.GetsockoptInt(fd, unix.SOL_LOCAL, unix.LOCAL_PEERPID)
	if err != nil || p <= 0 {
		return pqCurrent4Peer{}, errPQCurrent4Peer
	}
	return pqCurrent4Peer{uid: c.Uid, pid: int32(p)}, nil
}
