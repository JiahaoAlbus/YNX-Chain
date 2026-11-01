package main

/*
#include "product_session_http_v5.h"
*/
import "C"

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"unsafe"
)

func deviceHTTPV5SpanRange(s C.YNXProductSessionHTTPBytesV5) memoryRange {
	return memoryRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
}
func copyDeviceHTTPV5Public(s C.YNXProductSessionHTTPBytesV5) []byte {
	return C.GoBytes(unsafe.Pointer(s.bytes), C.int(s.length))
}
func borrowDeviceHTTPV5(s C.YNXProductSessionHTTPBytesV5) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
}

func checkDeviceHTTPV5Request(req *C.YNXProductSessionHTTPRequestV5, buffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil || buffer == nil || outLength == nil || cleanup == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	if !request.valid() || request.start%unsafe.Alignof(*req) != 0 || uintptr(unsafe.Pointer(outLength))%unsafe.Alignof(*outLength) != 0 || uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return resultBounds
	}
	if req.version != deviceHTTPV5Version || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != deviceHTTPV5MemberCapacity {
		return resultCapacity
	}
	spans := []struct {
		value        C.YNXProductSessionHTTPBytesV5
		minimum, max uintptr
	}{
		{req.unsigned_original, 1, deviceHTTPV5MessageMaximum},
		{req.actual_body, 1, ynxbatch.MaxProductSessionHTTPV5BodyBytes},
		{req.actual_content_type, 1, ynxbatch.MaxProductSessionHTTPV5ContentTypeBytes},
		{req.expected.network_id, 32, 32}, {req.expected.owner, 42, 42},
		{req.expected.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.expected.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
		{req.pkcs8_a, ynxbatch.PKCS8ASize, ynxbatch.PKCS8ASize}, {req.pkcs8_b, ynxbatch.PKCS8BSize, ynxbatch.PKCS8BSize},
		{req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
	}
	inputs := make([]memoryRange, len(spans))
	for i, span := range spans {
		if uintptr(span.value.length) < span.minimum || uintptr(span.value.length) > span.max {
			return resultBounds
		}
		inputs[i] = deviceHTTPV5SpanRange(span.value)
	}
	outputs := []memoryRange{{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)}, {uintptr(unsafe.Pointer(outLength)), unsafe.Sizeof(*outLength)}, {uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)}}
	return checkMemoryLayout(request, inputs, outputs)
}

//export YNXProductSessionHTTPProofSignV5
func YNXProductSessionHTTPProofSignV5(req *C.YNXProductSessionHTTPRequestV5, callerBuffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanupStatus *C.uint32_t) (rc C.int32_t) {
	if code := checkDeviceHTTPV5Request(req, callerBuffer, capacity, outLength, cleanupStatus); code != resultOK {
		return C.int32_t(code)
	}
	*outLength = 0
	*cleanupStatus = C.uint32_t(cleanupNotRequired)
	var member []byte
	defer func() {
		if recover() != nil {
			rc = C.int32_t(resultInternal)
			*cleanupStatus = C.uint32_t(cleanupUnknown)
		}
		clear(member)
	}()
	in := deviceHTTPV5Inputs{unsigned: copyDeviceHTTPV5Public(req.unsigned_original), actualBody: copyDeviceHTTPV5Public(req.actual_body), actualContentType: string(copyDeviceHTTPV5Public(req.actual_content_type)),
		expected: ynxbatch.ProductSessionHTTPBinding{NetworkID: copyDeviceHTTPV5Public(req.expected.network_id), Owner: string(copyDeviceHTTPV5Public(req.expected.owner)), PKA: copyDeviceHTTPV5Public(req.expected.pk_a), PKB: copyDeviceHTTPV5Public(req.expected.pk_b)}}
	plan, code := prepareDeviceHTTPV5(in, uint64(capacity))
	// Body may contain private application data even though it is not key
	// material. Discard our detached copy before importing the borrowed keys.
	clear(in.actualBody)
	in.actualBody = nil
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanup cleanupCode
	member, code, cleanup = signDeviceHTTPV5Prepared(plan, ynxbatch.KeyMaterial{PKCS8A: borrowDeviceHTTPV5(req.pkcs8_a), PKCS8B: borrowDeviceHTTPV5(req.pkcs8_b), PKA: borrowDeviceHTTPV5(req.pk_a), PKB: borrowDeviceHTTPV5(req.pk_b)})
	written, final := retainDeviceHTTPOutcome(unsafe.Slice((*byte)(unsafe.Pointer(callerBuffer)), int(capacity)), member, code, cleanup)
	*outLength = C.size_t(written)
	*cleanupStatus = C.uint32_t(cleanup)
	return C.int32_t(final)
}
