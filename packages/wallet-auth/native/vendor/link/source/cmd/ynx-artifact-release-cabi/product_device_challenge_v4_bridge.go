package main

/*
#include "product_device_challenge_v4.h"
*/
import "C"

import (
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func checkProductDeviceChallengeRequest(req *C.YNXProductSessionDeviceChallengeRequestV4, buffer *C.uint8_t, capacity C.size_t,
	length *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	outputs, code := productDeviceOutputs(request, unsafe.Alignof(*req), buffer, capacity, length, cleanup)
	if code != resultOK {
		return code
	}
	if req.version != productDeviceVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	return productDeviceSpans(request, []C.YNXProductDeviceBytesV4{req.registration_original, req.challenge_original,
		req.expected.network_id, req.expected.owner, req.expected.pk_a, req.expected.pk_b, req.pkcs8_a, req.pkcs8_b, req.pk_a, req.pk_b}, outputs)
}

//export YNXProductSessionDeviceChallengeSignV4
func YNXProductSessionDeviceChallengeSignV4(req *C.YNXProductSessionDeviceChallengeRequestV4, buffer *C.uint8_t,
	capacity C.size_t, length *C.size_t, cleanup *C.uint32_t) (result C.int32_t) {
	if code := checkProductDeviceChallengeRequest(req, buffer, capacity, length, cleanup); code != resultOK {
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
	plan, code := prepareProductDeviceChallenge(copyProductDevicePublic(req.challenge_original), copyProductDevicePublic(req.registration_original),
		productDeviceExpected(req.expected), uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanupResult cleanupCode
	member, code, cleanupResult = signProductDevicePrepared(plan, ynxbatch.KeyMaterial{PKCS8A: borrowProductDevice(req.pkcs8_a),
		PKCS8B: borrowProductDevice(req.pkcs8_b), PKA: borrowProductDevice(req.pk_a), PKB: borrowProductDevice(req.pk_b)})
	written, final := retainDeviceHTTPOutcome(unsafe.Slice((*byte)(unsafe.Pointer(buffer)), int(capacity)), member, code, cleanupResult)
	*length, *cleanup = C.size_t(written), C.uint32_t(cleanupResult)
	return C.int32_t(final)
}
