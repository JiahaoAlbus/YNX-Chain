//go:build darwin && cgo && ynx_network_source_native

package networkresourcesource

/*
#cgo CFLAGS: -I${SRCDIR}/source
#cgo LDFLAGS: -lynx_network_resource_source -lcrypto -framework Foundation -framework Security -framework AppKit -framework LocalAuthentication -framework ServiceManagement -lbsm -lc++
#include "network_resource_native.h"
*/
import "C"
import (
	"fmt"
	"unsafe"
)

type darwinNative struct{}

func normalNative() native { return darwinNative{} }
func nativeErr(e C.ynx_network_error_v1) error {
	if e.error_present == 0 && e.code == 0 {
		return nil
	}
	return fmt.Errorf("NETWORK_RESOURCE_NATIVE_%d", int32(e.code))
}
func ptr(h handle) (*C.ynx_network_source_v1, *C.ynx_network_context_v1) {
	return (*C.ynx_network_source_v1)(unsafe.Pointer(h.source)), (*C.ynx_network_context_v1)(unsafe.Pointer(h.context))
}
func (darwinNative) acquire() (handle, error) {
	var s *C.ynx_network_source_v1
	var c *C.ynx_network_context_v1
	e := C.ynx_network_source_acquire_v1(&s, &c)
	return handle{uintptr(unsafe.Pointer(s)), uintptr(unsafe.Pointer(c))}, nativeErr(e)
}
func (darwinNative) current(h handle) error {
	s, c := ptr(h)
	return nativeErr(C.ynx_network_source_current_v1(s, c))
}
func (darwinNative) read(h handle, k uint32) ([]byte, error) {
	size := 393216
	if k == 3 {
		size = 4194304
	}
	b := make([]byte, size)
	var n C.size_t
	s, c := ptr(h)
	e := C.ynx_network_source_read_v1(s, c, C.uint32_t(k), (*C.uchar)(unsafe.Pointer(&b[0])), C.size_t(len(b)), &n)
	if err := nativeErr(e); err != nil {
		return nil, err
	}
	if uint64(n) > uint64(len(b)) {
		return nil, fmt.Errorf("NETWORK_RESOURCE_NATIVE_OUTPUT_OVERFLOW")
	}
	return b[:int(n)], nil
}
func (darwinNative) verify(h handle, k uint32, p, sig []byte) error {
	if len(p) == 0 || len(sig) == 0 {
		return fmt.Errorf("NETWORK_RESOURCE_NATIVE_EMPTY_ORIGINAL")
	}
	s, c := ptr(h)
	return nativeErr(C.ynx_network_source_verify_v1(s, c, C.uint32_t(k), (*C.uchar)(unsafe.Pointer(&p[0])), C.size_t(len(p)), (*C.uchar)(unsafe.Pointer(&sig[0])), C.size_t(len(sig))))
}
func (darwinNative) retire(h handle) error {
	s, _ := ptr(h)
	return nativeErr(C.ynx_network_source_retire_v1(s))
}
func (darwinNative) join(h handle) drain {
	s, _ := ptr(h)
	r := C.ynx_network_source_join_v1(s)
	return drain{r.physical_complete != 0, nativeErr(r.error)}
}
func (darwinNative) close(h handle) drain {
	s, _ := ptr(h)
	r := C.ynx_network_source_close_v1(s)
	return drain{r.physical_complete != 0, nativeErr(r.error)}
}
func (darwinNative) metadata(h handle, k uint32) ([]byte, error) {
	b := make([]byte, 16384)
	var n C.size_t
	s, c := ptr(h)
	var e C.ynx_network_error_v1
	switch k {
	case 1:
		e = C.ynx_network_source_input_ref_v1(s, c, (*C.uchar)(unsafe.Pointer(&b[0])), C.size_t(len(b)), &n)
	case 2:
		e = C.ynx_network_source_consumer_identity_v1(s, c, (*C.uchar)(unsafe.Pointer(&b[0])), C.size_t(len(b)), &n)
	case 3:
		e = C.ynx_network_source_current_ref_v1(s, c, (*C.uchar)(unsafe.Pointer(&b[0])), C.size_t(len(b)), &n)
	default:
		return nil, ErrNotSupplied
	}
	if err := nativeErr(e); err != nil {
		return nil, err
	}
	if uint64(n) > uint64(len(b)) {
		return nil, fmt.Errorf("NETWORK_RESOURCE_NATIVE_METADATA_OVERFLOW")
	}
	return b[:int(n)], nil
}
func (darwinNative) claim(h handle) (uintptr, error) {
	s, c := ptr(h)
	var out *C.ynx_network_claim_v1
	e := C.ynx_network_source_claim_once_v1(s, c, &out)
	return uintptr(unsafe.Pointer(out)), nativeErr(e)
}
func (darwinNative) claimCurrent(h uintptr) error {
	code := C.ynx_network_claim_current_no_io_v1((*C.ynx_network_claim_v1)(unsafe.Pointer(h)))
	if code != 0 {
		return fmt.Errorf("NETWORK_RESOURCE_NATIVE_CLAIM_%d", int32(code))
	}
	return nil
}
func (darwinNative) claimRead(h uintptr) ([]byte, error) {
	b := make([]byte, 65536)
	var n C.size_t
	e := C.ynx_network_claim_read_original_v1((*C.ynx_network_claim_v1)(unsafe.Pointer(h)), (*C.uchar)(unsafe.Pointer(&b[0])), C.size_t(len(b)), &n)
	if err := nativeErr(e); err != nil {
		return nil, err
	}
	if uint64(n) > uint64(len(b)) {
		return nil, fmt.Errorf("NETWORK_RESOURCE_NATIVE_CLAIM_OVERFLOW")
	}
	return b[:int(n)], nil
}
func (darwinNative) claimClose(h uintptr) drain {
	d := C.ynx_network_claim_close_v1((*C.ynx_network_claim_v1)(unsafe.Pointer(h)))
	return drain{d.physical_complete != 0, nativeErr(d.error)}
}
