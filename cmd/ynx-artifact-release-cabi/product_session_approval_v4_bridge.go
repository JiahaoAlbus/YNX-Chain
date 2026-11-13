package main

/*
#include "product_session_approval_v4.h"
*/
import "C"

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"unsafe"
)

func checkProductApprovalV4Request(req *C.YNXProductSessionApprovalRequestV4, buffer *C.uint8_t, capacity C.size_t, length *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	outputs, code := productDeviceOutputs(request, unsafe.Alignof(*req), buffer, capacity, length, cleanup)
	if code != resultOK {
		return code
	}
	if req.version != 4 || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	spans := []C.YNXProductSessionApprovalBytesV4{req.e5_original, req.expected.network_id, req.expected.owner, req.expected.pk_a, req.expected.pk_b, req.expected.key_revision,
		req.pkcs8_a, req.pkcs8_b, req.pk_a, req.pk_b}
	limits := [][2]uintptr{{1, 16384}, {32, 32}, {42, 42}, {2592, 2592}, {64, 64}, {1, 20}, {54, 54}, {150, 150}, {2592, 2592}, {64, 64}}
	public := []memoryRange{request}
	private := make([]memoryRange, 0, 2)
	for i, s := range spans {
		if uintptr(s.length) < limits[i][0] || uintptr(s.length) > limits[i][1] {
			return resultBounds
		}
		r := memoryRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
		if i == 6 || i == 7 {
			private = append(private, r)
		} else {
			public = append(public, r)
		}
	}
	return checkMigrationAuthorizationLayout(request, public, private, outputs)
}
func approvalV4Public(s C.YNXProductSessionApprovalBytesV4) []byte {
	return C.GoBytes(unsafe.Pointer(s.bytes), C.int(s.length))
}
func approvalV4Borrow(s C.YNXProductSessionApprovalBytesV4) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
}

//export YNXProductSessionApprovalSignV4
func YNXProductSessionApprovalSignV4(req *C.YNXProductSessionApprovalRequestV4, buffer *C.uint8_t, capacity C.size_t, length *C.size_t, cleanup *C.uint32_t) (result C.int32_t) {
	if code := checkProductApprovalV4Request(req, buffer, capacity, length, cleanup); code != resultOK {
		return C.int32_t(code)
	}
	*length, *cleanup = 0, C.uint32_t(cleanupNotRequired)
	var member []byte
	defer func() {
		if recover() != nil {
			result, *cleanup = C.int32_t(resultInternal), C.uint32_t(cleanupUnknown)
		}
		clear(member)
	}()
	e := ynxbatch.ProductSessionApprovalV4Binding{NetworkID: approvalV4Public(req.expected.network_id), Owner: string(approvalV4Public(req.expected.owner)),
		PKA: approvalV4Public(req.expected.pk_a), PKB: approvalV4Public(req.expected.pk_b), KeyRevision: string(approvalV4Public(req.expected.key_revision))}
	p, code := prepareProductApprovalV4(approvalV4Public(req.e5_original), e, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var clean cleanupCode
	member, code, clean = signProductApprovalV4(p, ynxbatch.KeyMaterial{PKCS8A: approvalV4Borrow(req.pkcs8_a), PKCS8B: approvalV4Borrow(req.pkcs8_b), PKA: approvalV4Borrow(req.pk_a), PKB: approvalV4Borrow(req.pk_b)})
	written, final := retainDeviceHTTPOutcome(unsafe.Slice((*byte)(unsafe.Pointer(buffer)), int(capacity)), member, code, clean)
	*length, *cleanup = C.size_t(written), C.uint32_t(clean)
	return C.int32_t(final)
}
