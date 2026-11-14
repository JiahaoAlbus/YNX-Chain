//go:build linux || darwin

package consensus

import (
	"encoding/binary"
	"errors"
	"io"
	"net"
	"syscall"

	"golang.org/x/sys/unix"
)

var errFreshScopeBroker = errors.New("original fresh Scope broker unavailable; retain same scope UNKNOWN")

type pqFreshBrokerFrame struct {
	kind  byte
	body  []byte
	files []int
}

// Read one fixed frame and adopt every received descriptor even on error.
// The nonblocking recvmsg callback holds ForkLock only during the actual
// syscall+CloseOnExec, never while waiting for socket readability.
func readPQFreshFrame(c *net.UnixConn) (f pqFreshBrokerFrame, err error) {
	var header [16]byte
	raw, err := c.SyscallConn()
	if err != nil {
		return f, err
	}
	first := true
	read := func(dst []byte) error {
		for len(dst) > 0 {
			var n, flags, oobn int
			var callErr error
			oob := make([]byte, unix.CmsgSpace(4*8))
			e := raw.Read(func(fd uintptr) bool {
				syscall.ForkLock.RLock()
				n, oobn, flags, _, callErr = unix.Recvmsg(int(fd), dst, oob, unix.MSG_DONTWAIT)
				if callErr == nil && oobn > 0 {
					messages, parseErr := unix.ParseSocketControlMessage(oob[:oobn])
					if parseErr != nil {
						callErr = errors.Join(callErr, parseErr)
					}
					for _, m := range messages {
						if m.Header.Level != unix.SOL_SOCKET || m.Header.Type != unix.SCM_RIGHTS {
							callErr = errFreshScopeBroker
							continue
						}
						rights, re := unix.ParseUnixRights(&m)
						if re != nil {
							callErr = errors.Join(callErr, re)
							continue
						}
						for _, r := range rights {
							unix.CloseOnExec(r)
							f.files = append(f.files, r)
						}
					}
				}
				syscall.ForkLock.RUnlock()
				return !errors.Is(callErr, unix.EAGAIN) && !errors.Is(callErr, unix.EWOULDBLOCK) && !errors.Is(callErr, unix.EINTR)
			})
			if e != nil {
				return e
			}
			if callErr != nil {
				return callErr
			}
			if flags&(unix.MSG_CTRUNC|unix.MSG_TRUNC) != 0 || !first && oobn != 0 {
				return errFreshScopeBroker
			}
			first = false
			if n <= 0 {
				return io.ErrUnexpectedEOF
			}
			dst = dst[n:]
		}
		return nil
	}
	if err = read(header[:]); err != nil {
		return f, err
	}
	size := binary.BigEndian.Uint32(header[12:16])
	if string(header[:8]) != "YNXSBKR1" || binary.BigEndian.Uint16(header[8:10]) != 1 || header[11] != 0 || size > 112 {
		return f, errFreshScopeBroker
	}
	f.kind = header[10]
	if f.kind == 1 && size != 48 || f.kind == 3 && size != 16 || f.kind != 1 && f.kind != 3 {
		return f, errFreshScopeBroker
	}
	f.body = make([]byte, int(size))
	if err = read(f.body); err != nil {
		return f, err
	}
	if f.kind == 1 && len(f.files) != 2 || f.kind == 3 && len(f.files) != 0 {
		return f, errFreshScopeBroker
	}
	return f, nil
}
func encodePQFreshResult(generation, scope uint64, status uint32, failure sourceParentFailure, reason uint32) ([]byte, error) {
	if generation == 0 || scope == 0 || status < 1 || status > 5 || reason > 10 || !failure.present && failure.code != 0 {
		return nil, errFreshScopeBroker
	}
	frame := make([]byte, 48)
	copy(frame, "YNXSBKR1")
	binary.BigEndian.PutUint16(frame[8:10], 1)
	frame[10] = 2
	binary.BigEndian.PutUint32(frame[12:16], 32)
	binary.BigEndian.PutUint64(frame[16:24], generation)
	binary.BigEndian.PutUint64(frame[24:32], scope)
	binary.BigEndian.PutUint32(frame[32:36], status)
	if failure.present {
		binary.BigEndian.PutUint32(frame[36:40], 1)
	}
	binary.BigEndian.PutUint32(frame[40:44], uint32(failure.code))
	binary.BigEndian.PutUint32(frame[44:48], reason)
	return frame, nil
}

func writePQFreshResult(c *net.UnixConn, generation, scope uint64, status uint32, failure sourceParentFailure, reason uint32) error {
	frame, err := encodePQFreshResult(generation, scope, status, failure, reason)
	if err != nil {
		return err
	}
	for len(frame) > 0 {
		n, e := c.Write(frame)
		if n > 0 {
			frame = frame[n:]
		}
		if e != nil {
			return e
		}
		if n == 0 {
			return io.ErrShortWrite
		}
	}
	return nil
}
func closePQFreshReceived(fds []int) {
	for _, fd := range fds {
		if fd >= 0 {
			_ = unix.Close(fd)
		}
	}
}
