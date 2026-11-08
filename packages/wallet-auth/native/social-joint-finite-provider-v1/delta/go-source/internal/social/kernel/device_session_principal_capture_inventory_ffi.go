//go:build cgo && (darwin || linux)

package kernel

/*
#include <pthread.h>
#include "social_joint_profile_issuer_private.h"
static uintptr_t ynx_joint_actor_thread_data(void) { return (uintptr_t)pthread_self(); }
*/
import "C"
import (
	"context"
	"unsafe"
)

func originalSocialJointCurrentThread() uint64 { return uint64(C.ynx_joint_actor_thread_data()) }
func originalJointCaptureStatus(out *C.ynx_social_joint_status_v1, e error, done bool) {
	if out == nil {
		return
	}
	*out = C.ynx_social_joint_status_v1{version: 1, size: C.uint32_t(C.sizeof_ynx_social_joint_status_v1)}
	if e != nil {
		out.error_present = 1
		out.original_first = -9541
		if coded, ok := e.(interface{ originalSocialJointCode() int32 }); ok {
			out.original_first = C.int32_t(coded.originalSocialJointCode())
		}
		if e == errJointIssuerPending {
			out.unknown = 1
		}
	}
	if done {
		out.physical_done = 1
	}
}
func originalJointInputBytes(in C.ynx_social_joint_bytes_v1) ([]byte, error) {
	if in.data == nil || in.size == 0 || in.size > 65536 {
		return nil, errSocialSessionPrincipalRequired
	}
	return C.GoBytes(unsafe.Pointer(in.data), C.int(in.size)), nil
}

//export ynx_auth_social_joint_capture_borrow_acquire_v1
func ynx_auth_social_joint_capture_borrow_acquire_v1(ref C.uint64_t, in *C.ynx_social_joint_source_input_v1, out *C.uint64_t, status *C.ynx_social_joint_status_v1) {
	if out != nil {
		*out = 0
	}
	if status == nil {
		return
	}
	fail := func(e error) { originalJointCaptureStatus(status, e, false) }
	if in == nil || out == nil || in.version != 2 || in.size != C.uint32_t(C.sizeof_ynx_social_joint_source_input_v1) || ref == 0 || in.same_process_capture_reference != ref {
		fail(errSocialSessionPrincipalRequired)
		return
	}
	var originals socialJointCapturedPublicOriginals
	var e error
	if originals.Registration, e = originalJointInputBytes(in.registration); e != nil {
		fail(e)
		return
	}
	if originals.Issuer, e = originalJointInputBytes(in.issuer_credential); e != nil {
		fail(e)
		return
	}
	if originals.Anchor, e = originalJointInputBytes(in.anchor_credential); e != nil {
		fail(e)
		return
	}
	if originals.History, e = originalJointInputBytes(in.history_envelope); e != nil {
		fail(e)
		return
	}
	var resource [32]byte
	copy(resource[:], unsafe.Slice((*byte)(unsafe.Pointer(&in.registered_source_resource[0])), 32))
	loan, e := acquireOriginalSocialJointCaptureLoan(uint64(ref), originalSocialJointCurrentThread(), resource, originals)
	if loan != nil {
		*out = C.uint64_t(loan.id)
	} // partial before status
	originalJointCaptureStatus(status, e, false)
}

//export ynx_auth_social_joint_capture_borrow_current_v1
func ynx_auth_social_joint_capture_borrow_current_v1(id C.uint64_t, status *C.ynx_social_joint_status_v1) {
	if status == nil {
		return
	}
	l := lookupOriginalSocialJointCaptureLoan(uint64(id), originalSocialJointCurrentThread())
	if l == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	originalJointCaptureStatus(status, l.current(), false)
}

//export ynx_auth_social_joint_capture_borrow_retire_v1
func ynx_auth_social_joint_capture_borrow_retire_v1(id C.uint64_t, status *C.ynx_social_joint_status_v1) {
	if status == nil {
		return
	}
	l := lookupOriginalSocialJointCaptureLoan(uint64(id), originalSocialJointCurrentThread())
	if l == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	l.retire()
	originalJointCaptureStatus(status, nil, false)
}

//export ynx_auth_social_joint_capture_borrow_join_v1
func ynx_auth_social_joint_capture_borrow_join_v1(id C.uint64_t, status *C.ynx_social_joint_status_v1) {
	if status == nil {
		return
	}
	l := lookupOriginalSocialJointCaptureLoan(uint64(id), originalSocialJointCurrentThread())
	if l == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	originalJointCaptureStatus(status, l.join(), false)
}

//export ynx_auth_social_joint_capture_borrow_close_v1
func ynx_auth_social_joint_capture_borrow_close_v1(id *C.uint64_t, status *C.ynx_social_joint_status_v1) {
	if status == nil {
		return
	}
	if id == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	l := lookupOriginalSocialJointCaptureLoan(uint64(*id), originalSocialJointCurrentThread())
	if l == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	done, e := l.close()
	if done {
		*id = 0
	}
	originalJointCaptureStatus(status, e, done)
}

// Pure Go actor uses the same OS-thread identity as callbacks during Native
// source construction. Context is never supplied through the C/token boundary.
func registerOriginalSocialJointActorCapture(ctx context.Context, b *originalSocialJointIssuerCaptureBorrow, id [32]byte) (*socialJointCaptureReference, error) {
	r, e := registerOriginalSocialJointCapture(ctx, b, id, originalSocialJointCurrentThread())
	if e == nil {
		e = retainOriginalMainPairRoute(r, originalMainPairLocalRoute)
	}
	return r, e
}

//export ynx_auth_social_joint_capture_borrow_window_v1
func ynx_auth_social_joint_capture_borrow_window_v1(id C.uint64_t, out *C.ynx_social_joint_source_window_v1, status *C.ynx_social_joint_status_v1) {
	if out != nil {
		*out = C.ynx_social_joint_source_window_v1{}
	}
	if status == nil {
		return
	}
	if out == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	l := lookupOriginalSocialJointCaptureLoan(uint64(id), originalSocialJointCurrentThread())
	if l == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	nb, end, e := l.windowOriginalDATA()
	if end > nb {
		*out = C.ynx_social_joint_source_window_v1{version: 1, size: C.uint32_t(C.sizeof_ynx_social_joint_source_window_v1), not_before_ms: C.int64_t(nb), expires_ms: C.int64_t(end)}
	}
	originalJointCaptureStatus(status, e, false)
}
