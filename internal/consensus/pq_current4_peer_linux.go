package consensus

import (
	"unsafe"

	"golang.org/x/sys/unix"
)

func pqCurrent4UnnamedEndpoint(fd int) error {
	// x/sys's SockaddrUnix projection drops the kernel sockaddr length and
	// displays both an unnamed endpoint and an empty abstract name as "@".
	// Only AF_UNIX with no bytes of sun_path is unnamed. In particular, a
	// length of three includes a NUL abstract name and must remain forbidden.
	for _, call := range []uintptr{unix.SYS_GETSOCKNAME, unix.SYS_GETPEERNAME} {
		var address unix.RawSockaddrUnix
		length := uint32(unsafe.Sizeof(address))
		_, _, errno := unix.Syscall(call, uintptr(fd), uintptr(unsafe.Pointer(&address)), uintptr(unsafe.Pointer(&length)))
		if errno != 0 || address.Family != unix.AF_UNIX || length != uint32(unsafe.Offsetof(address.Path)) {
			return errPQCurrent4Peer
		}
	}
	return nil
}

func pqCurrent4OSPeer(fd int) (pqCurrent4Peer, error) {
	c, err := unix.GetsockoptUcred(fd, unix.SOL_SOCKET, unix.SO_PEERCRED)
	if err != nil {
		return pqCurrent4Peer{}, err
	}
	return pqCurrent4Peer{uid: c.Uid, pid: c.Pid}, nil
}
