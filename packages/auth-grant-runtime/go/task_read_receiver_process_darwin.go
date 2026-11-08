//go:build darwin && cgo

package grantruntime

/*
#cgo LDFLAGS: -lproc
#include <libproc.h>
#include <sys/proc_info.h>
#include <stdint.h>
static int ynx_receiver_process_original(int pid,char* path,uint32_t* uid,uint32_t* gid,uint64_t* sec,uint64_t* usec){
 struct proc_bsdinfo b;int n=proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&b,sizeof(b));
 if(n!=sizeof(b)||proc_pidpath(pid,path,PROC_PIDPATHINFO_MAXSIZE)<=0)return 0;
 *uid=b.pbi_uid;*gid=b.pbi_gid;*sec=b.pbi_start_tvsec;*usec=b.pbi_start_tvusec;return 1;
}
*/
import "C"
import (
	"fmt"
)

func observeReceiverProcess(pid int) (receiverProcessObservation, error) {
	if pid <= 0 {
		return receiverProcessObservation{}, ErrProof
	}
	var path [C.PROC_PIDPATHINFO_MAXSIZE]C.char
	var uid, gid C.uint32_t
	var sec, usec C.uint64_t
	if C.ynx_receiver_process_original(C.int(pid), &path[0], &uid, &gid, &sec, &usec) != 1 {
		return receiverProcessObservation{}, ErrCurrent
	}
	return receiverProcessObservation{Path: C.GoString(&path[0]), UID: uint32(uid), GID: uint32(gid), Start: fmt.Sprintf("darwin:%d:%d", uint64(sec), uint64(usec))}, nil
}
