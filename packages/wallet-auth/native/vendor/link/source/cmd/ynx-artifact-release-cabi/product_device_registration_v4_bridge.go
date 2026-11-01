package main

/*
#include "product_device_registration_v4.h"
*/
import "C"

import (
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func productDeviceOutputs(request memoryRange, requestAlignment uintptr, buffer *C.uint8_t, capacity C.size_t,
	length *C.size_t, cleanup *C.uint32_t) ([]memoryRange, resultCode) {
	if buffer == nil || length == nil || cleanup == nil {
		return nil, resultInvalidArgument
	}
	if unsafe.Sizeof(uintptr(0)) != 8 || !request.valid() || request.start%requestAlignment != 0 ||
		uintptr(unsafe.Pointer(length))%unsafe.Alignof(*length) != 0 || uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return nil, resultBounds
	}
	if capacity != productDeviceMemberCapacity {
		return nil, resultCapacity
	}
	outputs := []memoryRange{{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)},
		{uintptr(unsafe.Pointer(length)), unsafe.Sizeof(*length)}, {uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)}}
	return outputs, checkMemoryLayout(request, nil, outputs)
}

func productDeviceSpans(request memoryRange, spans []C.YNXProductDeviceBytesV4, outputs []memoryRange) resultCode {
	// Entries are original(s), expected network/owner/full pair, borrowed private
	// A/B DER and supplied full pair. No content is read while checking ranges.
	if len(spans) != 9 && len(spans) != 10 {
		return resultInvalidArgument
	}
	originals := len(spans) - 8
	limits := [][2]uintptr{{32, 32}, {42, 42}, {ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize},
		{ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize}, {ynxbatch.PKCS8ASize, ynxbatch.PKCS8ASize},
		{ynxbatch.PKCS8BSize, ynxbatch.PKCS8BSize}, {ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize}}
	inputs := make([]memoryRange, len(spans))
	for i, span := range spans {
		minimum, maximum := uintptr(1), uintptr(productDeviceOriginalMaximum)
		if i >= originals {
			minimum, maximum = limits[i-originals][0], limits[i-originals][1]
		}
		if uintptr(span.length) < minimum || uintptr(span.length) > maximum {
			return resultBounds
		}
		inputs[i] = memoryRange{uintptr(unsafe.Pointer(span.bytes)), uintptr(span.length)}
	}
	return checkMemoryLayout(request, inputs, outputs)
}

func checkProductDeviceRegistrationRequest(req *C.YNXProductSessionDeviceRegistrationRequestV4, buffer *C.uint8_t, capacity C.size_t,
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
	return productDeviceSpans(request, []C.YNXProductDeviceBytesV4{req.registration_original, req.expected.network_id, req.expected.owner,
		req.expected.pk_a, req.expected.pk_b, req.pkcs8_a, req.pkcs8_b, req.pk_a, req.pk_b}, outputs)
}

func copyProductDevicePublic(span C.YNXProductDeviceBytesV4) []byte {
	return C.GoBytes(unsafe.Pointer(span.bytes), C.int(span.length))
}

func borrowProductDevice(span C.YNXProductDeviceBytesV4) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(span.bytes)), int(span.length))
}

func productDeviceExpected(in C.YNXProductDeviceExpectedV4) ynxbatch.ProductSessionDeviceV4Binding {
	return ynxbatch.ProductSessionDeviceV4Binding{NetworkID: copyProductDevicePublic(in.network_id), Owner: string(copyProductDevicePublic(in.owner)),
		PKA: copyProductDevicePublic(in.pk_a), PKB: copyProductDevicePublic(in.pk_b)}
}

//export YNXProductSessionDeviceRegistrationSignV4
func YNXProductSessionDeviceRegistrationSignV4(req *C.YNXProductSessionDeviceRegistrationRequestV4, buffer *C.uint8_t,
	capacity C.size_t, length *C.size_t, cleanup *C.uint32_t) (result C.int32_t) {
	if code := checkProductDeviceRegistrationRequest(req, buffer, capacity, length, cleanup); code != resultOK {
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
	plan, code := prepareProductDeviceRegistration(copyProductDevicePublic(req.registration_original), productDeviceExpected(req.expected), uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanupResult cleanupCode
	member, code, cleanupResult = signProductDevicePrepared(plan, ynxbatch.KeyMaterial{PKCS8A: borrowProductDevice(req.pkcs8_a),
		PKCS8B: borrowProductDevice(req.pkcs8_b), PKA: borrowProductDevice(req.pk_a), PKB: borrowProductDevice(req.pk_b)})
	// Preserve the actual original BEFORE reporting any late/cleanup result.
	written, final := retainDeviceHTTPOutcome(unsafe.Slice((*byte)(unsafe.Pointer(buffer)), int(capacity)), member, code, cleanupResult)
	*length, *cleanup = C.size_t(written), C.uint32_t(cleanupResult)
	return C.int32_t(final)
}
