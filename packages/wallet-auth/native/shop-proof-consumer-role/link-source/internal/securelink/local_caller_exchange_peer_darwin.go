//go:build darwin && cgo

package securelink

/*
#cgo LDFLAGS: -lbsm
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/ucred.h>
#include <sys/proc_info.h>
#include <libproc.h>
#include <mach/vm_prot.h>
#include <bsm/libbsm.h>

// Private static helpers only: no second copy of the original native C ABI,
// provider, connection or Source constructor is linked into this Go runtime.
static inline int ynx_lc_peer_start(int pid,uint64_t*a,uint64_t*b,uint32_t*uid) {
 struct proc_bsdinfo info;
 memset(&info,0,sizeof(info));
 if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))!=sizeof(info)||
    info.pbi_pid!=(uint32_t)pid||!info.pbi_start_tvsec||info.pbi_start_tvusec>=1000000){if(!errno)errno=ESRCH;return -1;}
 *a=info.pbi_start_tvsec;*b=info.pbi_start_tvusec;*uid=info.pbi_uid;return 0;
}
static inline int ynx_lc_peer_token(int fd,uint32_t*uid,int32_t*pid,uint32_t token[8]) {
 struct xucred cred;memset(&cred,0,sizeof(cred));socklen_t length=sizeof(cred);
 if(getsockopt(fd,SOL_LOCAL,LOCAL_PEERCRED,&cred,&length))return -1;
 if(length!=sizeof(cred)||cred.cr_version!=XUCRED_VERSION){errno=EPROTO;return -1;}
 length=sizeof(*pid);if(getsockopt(fd,SOL_LOCAL,LOCAL_PEERPID,pid,&length))return -1;
 if(length!=sizeof(*pid)){errno=EPROTO;return -1;}
 audit_token_t actual;memset(&actual,0,sizeof(actual));length=sizeof(actual);
 if(getsockopt(fd,SOL_LOCAL,LOCAL_PEERTOKEN,&actual,&length))return -1;
 if(length!=sizeof(actual)||audit_token_to_pid(actual)!=*pid){errno=EPROTO;return -1;}
 *uid=cred.cr_uid;memcpy(token,&actual,sizeof(actual));return 0;
}
static inline int ynx_lc_peer_audit_path(const uint32_t token[8],char*path,uint32_t capacity) {
 audit_token_t actual;memcpy(&actual,token,sizeof(actual));
 if(proc_pidpath_audittoken(&actual,path,capacity)<=0){if(!errno)errno=ESRCH;return -1;}return 0;
}
static inline int ynx_lc_peer_mapping(int pid,uint64_t original,int first,const char*path,uint64_t device,uint64_t inode,uint64_t bytes,uint64_t*out) {
 uint64_t address=first?0:original;
 for(unsigned i=0;i<(first?128U:1U);++i){
  struct proc_regionwithpathinfo info;memset(&info,0,sizeof(info));
  if(proc_pidinfo(pid,PROC_PIDREGIONPATHINFO,address,&info,sizeof(info))!=sizeof(info)){if(!errno)errno=ESRCH;return -1;}
  struct proc_regioninfo*map=&info.prp_prinfo;struct vinfo_stat*node=&info.prp_vip.vip_vi.vi_stat;
  if(!map->pri_size||map->pri_address>UINT64_MAX-map->pri_size||map->pri_address+map->pri_size<=address){errno=EIO;return -1;}
  if((map->pri_protection&VM_PROT_EXECUTE)&&strnlen(info.prp_vip.vip_path,sizeof(info.prp_vip.vip_path))<sizeof(info.prp_vip.vip_path)&&
     !strcmp(info.prp_vip.vip_path,path)&&node->vst_dev==(uint32_t)device&&node->vst_ino==inode&&node->vst_size==(int64_t)bytes){*out=map->pri_address;return 0;}
  address=map->pri_address+map->pri_size;
 }
 errno=ESRCH;return -1;
}
*/
import "C"

import (
	"context"
	"errors"
	"unsafe"

	"golang.org/x/sys/unix"
)

type originalLocalCallerPeerPlatform struct {
	image      *originalLocalCallerPeerFD
	imageStamp unix.Stat_t
	token      [8]uint32
	region     uint64
	mapped     bool
}

func originalLocalCallerDarwinStart(pid int) (a, b uint64, uid uint32, err error) {
	var first, second C.uint64_t
	var user C.uint32_t
	result, failure := C.ynx_lc_peer_start(C.int(pid), &first, &second, &user)
	if result != 0 {
		if failure == nil {
			failure = unix.EIO
		}
		return 0, 0, 0, failure
	}
	return uint64(first), uint64(second), uint32(user), nil
}
func (p *originalLocalCallerPeer) darwinStart(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	a, b, uid, err := originalLocalCallerDarwinStart(p.expected.PID)
	if err != nil || a != p.expected.StartA || b != p.expected.StartB || uid != p.expected.UID {
		return errors.Join(ErrDenied, err)
	}
	return nil
}

func (p *originalLocalCallerPeer) preparePlatform(ctx context.Context) error {
	if p.expected.StartKind != LocalCallerDarwinProcessStart || len(p.expected.ImagePath) > 4095 {
		return ErrDenied
	}
	if err := p.darwinStart(ctx); err != nil {
		return err
	}
	fd, err := unix.Open(p.expected.ImagePath, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	p.platform.image = p.own(fd, "held-executable")
	digest, stamp, err := originalLocalCallerImageDigest(ctx, fd, p.expected.ImageBytes)
	if err != nil || digest != p.expected.ImageSHA256 {
		return errors.Join(ErrDenied, err)
	}
	p.platform.imageStamp = stamp
	return p.darwinStart(ctx)
}

func (p *originalLocalCallerPeer) peerPlatform(fd int, first bool) (bool, error) {
	var uid C.uint32_t
	var pid C.int32_t
	var token [8]C.uint32_t
	result, err := C.ynx_lc_peer_token(C.int(fd), &uid, &pid, &token[0])
	if result != 0 {
		if err == nil {
			err = unix.EIO
		}
		return false, err
	}
	if uint32(uid) != p.expected.UID || int(pid) != p.expected.PID {
		return false, ErrDenied
	}
	var actual [8]uint32
	for i, value := range token {
		actual[i] = uint32(value)
	}
	if first {
		p.platform.token = actual
	} else if p.platform.token != actual {
		return false, ErrDenied
	}
	return true, nil
}

func (p *originalLocalCallerPeer) bindPlatform(ctx context.Context, fd int) error {
	if _, err := p.peerPlatform(fd, true); err != nil {
		return err
	}
	if err := p.darwinProcess(ctx, true); err != nil {
		return err
	}
	_, err := p.peerPlatform(fd, false)
	return err
}
func (p *originalLocalCallerPeer) processPlatform(ctx context.Context) error {
	if !p.platform.mapped {
		return ErrDenied
	}
	return p.darwinProcess(ctx, false)
}

func (p *originalLocalCallerPeer) darwinProcess(ctx context.Context, first bool) (err error) {
	s := &p.platform
	if s.image == nil {
		return ErrDenied
	}
	if err = p.darwinStart(ctx); err != nil {
		return err
	}
	var token [8]C.uint32_t
	for i, value := range s.token {
		token[i] = C.uint32_t(value)
	}
	var actualPath [4096]C.char
	result, failure := C.ynx_lc_peer_audit_path(&token[0], &actualPath[0], C.uint32_t(len(actualPath)))
	if result != 0 || C.GoString(&actualPath[0]) != p.expected.ImagePath {
		return errors.Join(ErrDenied, failure)
	}
	namedFD, err := unix.Open(p.expected.ImagePath, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	named := p.own(namedFD, "named-executable")
	defer func() { err = errors.Join(err, p.finish(named)) }()
	var held unix.Stat_t
	if err = unix.Fstat(s.image.fd, &held); err != nil || !originalLocalCallerSameImage(held, s.imageStamp) {
		return errors.Join(ErrDenied, err)
	}
	digest, stamp, err := originalLocalCallerImageDigest(ctx, named.fd, p.expected.ImageBytes)
	if err != nil || !originalLocalCallerSameImage(stamp, s.imageStamp) || digest != p.expected.ImageSHA256 {
		return errors.Join(ErrDenied, err)
	}
	name := C.CString(p.expected.ImagePath)
	defer C.free(unsafe.Pointer(name))
	var region C.uint64_t
	initial := C.int(0)
	if first {
		initial = 1
	}
	result, failure = C.ynx_lc_peer_mapping(C.int(p.expected.PID), C.uint64_t(s.region), initial, name, C.uint64_t(uint32(stamp.Dev)), C.uint64_t(stamp.Ino), C.uint64_t(stamp.Size), &region)
	if result != 0 {
		return errors.Join(ErrDenied, failure)
	}
	if first {
		s.region, s.mapped = uint64(region), true
	}
	return p.darwinStart(ctx)
}
