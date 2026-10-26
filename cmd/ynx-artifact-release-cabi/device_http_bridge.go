package main

/*
#include "product_session_http.h"
*/
import "C"

import (
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func deviceHTTPSpanRange(s C.YNXProductSessionHTTPBytesV4) memoryRange {
	return memoryRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
}

func copyDeviceHTTPPublic(s C.YNXProductSessionHTTPBytesV4) []byte {
	return C.GoBytes(unsafe.Pointer(s.bytes), C.int(s.length))
}

func borrowDeviceHTTP(s C.YNXProductSessionHTTPBytesV4) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
}

func checkDeviceHTTPRequest(req *C.YNXProductSessionHTTPRequestV4, buffer *C.uint8_t, capacity C.size_t,
	outLength *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil || buffer == nil || outLength == nil || cleanup == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	if !request.valid() || request.start%unsafe.Alignof(*req) != 0 ||
		uintptr(unsafe.Pointer(outLength))%unsafe.Alignof(*outLength) != 0 ||
		uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return resultBounds
	}
	if req.version != deviceHTTPVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != deviceHTTPMemberCapacity {
		return resultCapacity
	}
	spans := []struct {
		value        C.YNXProductSessionHTTPBytesV4
		minimum, max uintptr
	}{
		{req.unsigned_original, 1, deviceHTTPMessageMaximum},
		{req.expected.network_id, 32, 32}, {req.expected.owner, 42, 42},
		{req.expected.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize},
		{req.expected.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
		{req.pkcs8_a, ynxbatch.PKCS8ASize, ynxbatch.PKCS8ASize}, {req.pkcs8_b, ynxbatch.PKCS8BSize, ynxbatch.PKCS8BSize},
		{req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
	}
	inputs := make([]memoryRange, len(spans))
	for i, span := range spans {
		if uintptr(span.value.length) < span.minimum || uintptr(span.value.length) > span.max {
			return resultBounds
		}
		inputs[i] = deviceHTTPSpanRange(span.value)
	}
	outputs := []memoryRange{
		{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)},
		{uintptr(unsafe.Pointer(outLength)), unsafe.Sizeof(*outLength)},
		{uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)},
	}
	return checkMemoryLayout(request, inputs, outputs)
}

//export YNXProductSessionHTTPProofSignV4
func YNXProductSessionHTTPProofSignV4(req *C.YNXProductSessionHTTPRequestV4, callerBuffer *C.uint8_t,
	capacity C.size_t, outLength *C.size_t, cleanupStatus *C.uint32_t) (result C.int32_t) {
	if code := checkDeviceHTTPRequest(req, callerBuffer, capacity, outLength, cleanupStatus); code != resultOK {
		return C.int32_t(code)
	}
	*outLength = 0
	*cleanupStatus = C.uint32_t(cleanupNotRequired)
	var member []byte
	defer func() {
		if recover() != nil {
			result = C.int32_t(resultInternal)
			*cleanupStatus = C.uint32_t(cleanupUnknown)
		}
		clear(member)
	}()
	in := deviceHTTPInputs{unsigned: copyDeviceHTTPPublic(req.unsigned_original), expected: ynxbatch.ProductSessionHTTPBinding{
		NetworkID: copyDeviceHTTPPublic(req.expected.network_id), Owner: string(copyDeviceHTTPPublic(req.expected.owner)),
		PKA: copyDeviceHTTPPublic(req.expected.pk_a), PKB: copyDeviceHTTPPublic(req.expected.pk_b)}}
	plan, code := prepareDeviceHTTP(in, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanup cleanupCode
	member, code, cleanup = signDeviceHTTPPrepared(plan, ynxbatch.KeyMaterial{
		PKCS8A: borrowDeviceHTTP(req.pkcs8_a), PKCS8B: borrowDeviceHTTP(req.pkcs8_b),
		PKA: borrowDeviceHTTP(req.pk_a), PKB: borrowDeviceHTTP(req.pk_b)})
	// Preserve the actual bounded public original BEFORE reporting rc/cleanup.
	// A failed/UNKNOWN result is not a valid proof and cannot authorize HTTP.
	written, final := retainDeviceHTTPOutcome(unsafe.Slice((*byte)(unsafe.Pointer(callerBuffer)), int(capacity)), member, code, cleanup)
	*outLength = C.size_t(written)
	*cleanupStatus = C.uint32_t(cleanup)
	return C.int32_t(final)
}
