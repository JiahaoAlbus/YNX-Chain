//go:build cgo && (darwin || linux)

package kernel

/*
#include "social_joint_profile_issuer_private.h"
*/
import "C"

//export ynx_auth_social_joint_capture_borrow_main_pair_route_v1
func ynx_auth_social_joint_capture_borrow_main_pair_route_v1(id C.uint64_t, out *C.uint32_t, status *C.ynx_social_joint_status_v1) {
	if out != nil {
		*out = 0
	}
	if status == nil {
		return
	}
	l := lookupOriginalSocialJointCaptureLoan(uint64(id), originalSocialJointCurrentThread())
	if l == nil || out == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	route, e := l.originalMainPairRoute()
	if route != 0 {
		*out = C.uint32_t(route)
	} // copied DATA retained before late status
	originalJointCaptureStatus(status, e, false)
}
