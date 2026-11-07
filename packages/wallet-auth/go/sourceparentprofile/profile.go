//go:build cgo && (darwin || linux)

// Package sourceparentprofile is the private original-process code-profile
// dependency. It cannot construct SourceBIND, a Manager, or an account Source.
package sourceparentprofile

/*
#cgo CFLAGS: -I${SRCDIR}/../../native/source-parent
#cgo CXXFLAGS: -std=c++17 -Wall -Wextra -Werror -Wno-deprecated-declarations -I${SRCDIR}/../../native/source-parent
#cgo darwin LDFLAGS: -lc++
#cgo linux LDFLAGS: -lstdc++ -lcrypto -ldl
#include "SourceParentProfileCPrivate.h"
*/
import "C"
import (
 "fmt"
 "runtime"
 "sync"
)

type Failure struct { Present bool; Code, SystemError int32 }
func (f Failure) Error() string { return fmt.Sprintf("original SourceParent code profile: present=%t code=%d system=%d", f.Present, f.Code, f.SystemError) }
func errOf(f Failure) error { if f.Present { return f }; return nil }
func raw(f C.ynx_sourceparent_profile_failure_v1) Failure { return Failure{f.present!=0,int32(f.code),int32(f.system_error)} }
type Images [3][32]byte // parent, owned Core observer, fixed nested Native host
type Drain struct { Failure Failure; PhysicalDone bool }
type reply struct { failure Failure; images Images; drain Drain }
type command struct { kind uint8; result chan reply }
type Owner struct { mu sync.Mutex; commands chan command; stopped bool; final Drain; first Failure }

// The only acquisition choices are fixed original process roles, not strings,
// paths, hashes, public providers, launch capsules, or Manager addresses.
func AcquireOriginalParentProfile() (*Owner,error) { return acquire(1) }
func AcquireOriginalCoreProfile() (*Owner,error) { return acquire(2) }
func acquire(role uint8) (*Owner,error) {
 o:=&Owner{commands:make(chan command)}; started:=make(chan reply)
 go o.run(role,started)
 r:=<-started; o.first=r.failure
 return o,errOf(r.failure) // caller adopts nonnil owner before error, including code0
}
func (o *Owner) run(role uint8,started chan<- reply) {
 runtime.LockOSThread(); defer runtime.UnlockOSThread()
 var a C.ynx_sourceparent_profile_acquisition_v1
 if role==1 { a=C.ynx_sourceparent_profile_acquire_parent_original_v1() } else { a=C.ynx_sourceparent_profile_acquire_core_original_v1() }
 started<-reply{failure:raw(a.failure)}
 for c:=range o.commands {
  var r reply
  switch c.kind {
  case 1: r.failure=raw(C.ynx_sourceparent_profile_current_original_v1(a.owner))
  case 2:
   var v C.ynx_sourceparent_profile_images_v1;v.version=1;v.size=C.uint32_t(C.sizeof_ynx_sourceparent_profile_images_v1)
   r.failure=raw(C.ynx_sourceparent_profile_read_original_v1(a.owner,&v))
   if !r.failure.Present { for i:=0;i<3;i++ { for j:=0;j<32;j++ { r.images[i][j]=byte(v.images[i][j]) } } }
  case 3: C.ynx_sourceparent_profile_retire_original_v1(a.owner)
  case 4:
   d:=C.ynx_sourceparent_profile_close_original_v1(a.owner);r.drain=Drain{raw(d.failure),d.physical_done!=0}
   if r.drain.PhysicalDone { f:=raw(C.ynx_sourceparent_profile_release_closed_original_v1(a.owner));if f.Present {r.drain.PhysicalDone=false;if !r.drain.Failure.Present {r.drain.Failure=f}} }
   c.result<-r
   if r.drain.PhysicalDone {return};continue
  }
  c.result<-r
 }
}
func (o *Owner) call(kind uint8) reply {
 if o==nil {return reply{failure:Failure{Present:true,Code:1}}}
 o.mu.Lock();defer o.mu.Unlock()
 if o.stopped { if kind==4 {return reply{drain:o.final}};if kind==3{return reply{}};f:=o.first;if !f.Present {f=Failure{Present:true,Code:7}};return reply{failure:f} }
 c:=command{kind:kind,result:make(chan reply)};o.commands<-c;r:=<-c.result
 if r.failure.Present&&!o.first.Present {o.first=r.failure}
 if kind==4&&r.drain.PhysicalDone {o.stopped=true;o.final=r.drain;if !o.first.Present&&r.drain.Failure.Present{o.first=r.drain.Failure}}
 return r
}
// Current and Read perform physical code-original observations OUTSIDE product
// locks, serialized on the original private Native actor. Never a pure fence.
func(o *Owner) Current() error{return errOf(o.call(1).failure)}
func(o *Owner) ReadOriginalImagesDATA()(Images,error){r:=o.call(2);return r.images,errOf(r.failure)}
func(o *Owner) Retire(){o.call(3)}
// Actual drain is independent of first error. A completed close with a failure
// still releases only the same physically closed C owner; UNKNOWN keeps worker.
func(o *Owner) Close()Drain{return o.call(4).drain}
