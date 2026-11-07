//go:build darwin && cgo

package consensus

/*
#cgo LDFLAGS: -lproc
#include <libproc.h>
#include <sys/proc_info.h>
#include <unistd.h>
static int resource_process(int pid, unsigned long long *sec, unsigned long long *usec, unsigned int *uid, char *path) {
 struct proc_bsdinfo info;
 if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))!=sizeof(info)||info.pbi_pid!=pid)return 0;
 if(proc_pidpath(pid,path,4096)<=0)return 0;
 *sec=info.pbi_start_tvsec;*usec=info.pbi_start_tvusec;*uid=info.pbi_uid;return 1;
}
*/
import "C"
import "fmt"

func observePQSourceProcessImage(pid int32) (pqSourceProcessImage, error) {
	var sec, usec C.ulonglong
	var uid C.uint
	var path [4096]C.char
	if C.resource_process(C.int(pid), &sec, &usec, &uid, &path[0]) != 1 {
		return pqSourceProcessImage{}, errPQSourceIdentity
	}
	name := C.GoString(&path[0])
	return pqSourceProcessImage{fmt.Sprintf("darwin:%d:%d", uint64(sec), uint64(usec)), name, name, uint32(uid)}, nil
}
