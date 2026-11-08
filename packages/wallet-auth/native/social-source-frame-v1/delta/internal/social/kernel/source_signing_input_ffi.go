//go:build cgo && (darwin || linux)

package kernel

/*
#include <stdint.h>
#include <stddef.h>
*/
import "C"
import "unsafe"

//export ynx_auth_social_source_frame_prepare_v1
func ynx_auth_social_source_frame_prepare_v1(role *C.uint8_t, roleLength C.size_t, body *C.uint8_t, bodyLength C.size_t, out *C.uint8_t, capacity C.size_t, written *C.size_t) C.int32_t {
	if written == nil {
		return 1
	}
	*written = 0
	// Bound before all pointer reads, Go int conversion or allocation. Valid
	// original roles fit 20 bytes; no strlen or implicit terminating NUL.
	if role == nil || body == nil || out == nil || roleLength == 0 || roleLength > 20 || bodyLength == 0 || bodyLength > 32768 {
		return 1
	}
	roleOriginal := C.GoBytes(unsafe.Pointer(role), C.int(roleLength))
	bodyOriginal := C.GoBytes(unsafe.Pointer(body), C.int(bodyLength))
	frame, err := PrepareOriginalSourceSigningInputDATA(string(roleOriginal), bodyOriginal)
	if err != nil {
		return 2
	}
	if len(frame) > 49152 {
		return 2
	}
	if capacity < C.size_t(len(frame)) {
		return 3
	}
	// Limit the foreign slice to actual frame length, never unchecked capacity.
	copy(unsafe.Slice((*byte)(unsafe.Pointer(out)), len(frame)), frame)
	*written = C.size_t(len(frame))
	return 0
}
