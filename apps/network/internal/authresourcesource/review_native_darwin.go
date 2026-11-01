//go:build darwin && cgo && ynx_network_source_native

package networkresourcesource

/*
#cgo CFLAGS: -I${SRCDIR}/source
#include "network_review_private.h"
// Opaque foreign handles stay integers until the original C registry checks
// them. Forming an invalid Go pointer first would abort under checkptr before
// the actual Native rejection can run. These shims add no exported authority.
static inline ynx_network_error_v1 p09_review_current(uintptr_t h) {
 return ynx_network_review_current_v1((ynx_network_review_v1*)h);
}
static inline ynx_network_error_v1 p09_review_original(uintptr_t h,unsigned char* b,size_t cap,size_t* n) {
 return ynx_network_review_read_original_v1((ynx_network_review_v1*)h,b,cap,n);
}
static inline ynx_network_error_v1 p09_review_retire(uintptr_t h) {
 return ynx_network_review_retire_v1((ynx_network_review_v1*)h);
}
static inline ynx_network_drain_v1 p09_review_join(uintptr_t h) {
 return ynx_network_review_join_v1((ynx_network_review_v1*)h);
}
static inline ynx_network_drain_v1 p09_review_close(uintptr_t h) {
 return ynx_network_review_close_v1((ynx_network_review_v1*)h);
}
*/
import "C"
import (
	"fmt"
	"unsafe"
)

func (darwinNative) prepareReview(h handle) (uintptr, error) {
	s, c := ptr(h)
	var out *C.ynx_network_review_v1
	e := C.ynx_network_review_prepare_v1(s, c, &out)
	return uintptr(unsafe.Pointer(out)), nativeErr(e)
}
func (darwinNative) reviewCurrent(h uintptr) error {
	return nativeErr(C.p09_review_current(C.uintptr_t(h)))
}
func (darwinNative) reviewOriginal(h uintptr) ([]byte, error) {
	b := make([]byte, 49152)
	var n C.size_t
	e := C.p09_review_original(C.uintptr_t(h), (*C.uchar)(unsafe.Pointer(&b[0])), C.size_t(len(b)), &n)
	if e := nativeErr(e); e != nil {
		return nil, e
	}
	if uint64(n) > uint64(len(b)) {
		return nil, fmt.Errorf("NETWORK_REVIEW_NATIVE_OUTPUT_OVERFLOW")
	}
	return b[:int(n)], nil
}
func (darwinNative) reviewRetire(h uintptr) error {
	return nativeErr(C.p09_review_retire(C.uintptr_t(h)))
}
func (darwinNative) reviewJoin(h uintptr) drain {
	d := C.p09_review_join(C.uintptr_t(h))
	return drain{d.physical_complete != 0, nativeErr(d.error)}
}
func (darwinNative) reviewClose(h uintptr) drain {
	d := C.p09_review_close(C.uintptr_t(h))
	return drain{d.physical_complete != 0, nativeErr(d.error)}
}
