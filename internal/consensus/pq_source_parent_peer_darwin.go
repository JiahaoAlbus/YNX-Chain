//go:build darwin && cgo

package consensus

/*
#cgo LDFLAGS: -lproc
#include <libproc.h>
#include <sys/proc_info.h>
static int source_ppid(int pid){struct proc_bsdinfo x;if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&x,sizeof x)!=sizeof x||x.pbi_pid!=pid)return -1;return x.pbi_ppid;}
*/
import "C"
import "golang.org/x/sys/unix"

func sourceProcessParent(pid int32) (int32, error) {
	p := C.source_ppid(C.int(pid))
	if p < 1 {
		return 0, errSourceParent
	}
	return int32(p), nil
}
func sourceKernelPeer(fd int) (uint32, int32, error) {
	c, e := unix.GetsockoptXucred(fd, unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	if e != nil {
		return 0, 0, e
	}
	p, e := unix.GetsockoptInt(fd, unix.SOL_LOCAL, unix.LOCAL_PEERPID)
	return c.Uid, int32(p), e
}
