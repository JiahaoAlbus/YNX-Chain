//go:build linux

package consensus

import (
	"golang.org/x/sys/unix"
	"os"
	"strconv"
	"strings"
)

func sourceProcessParent(pid int32) (int32, error) {
	b, e := os.ReadFile("/proc/" + strconv.FormatInt(int64(pid), 10) + "/stat")
	if e != nil {
		return 0, e
	}
	s := string(b)
	i := strings.LastIndexByte(s, ')')
	if i < 0 {
		return 0, errSourceParent
	}
	f := strings.Fields(s[i+1:])
	if len(f) < 2 {
		return 0, errSourceParent
	}
	p, e := strconv.ParseInt(f[1], 10, 32)
	return int32(p), e
}
func sourceKernelPeer(fd int) (uint32, int32, error) {
	c, e := unix.GetsockoptUcred(fd, unix.SOL_SOCKET, unix.SO_PEERCRED)
	if e != nil {
		return 0, 0, e
	}
	return c.Uid, c.Pid, nil
}
