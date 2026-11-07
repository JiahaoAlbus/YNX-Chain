package main

/*
#include "account_initial.h"
*/
import "C"

import (
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func initialSpanRange(s C.YNXAccountInitialBytesV1) memoryRange {
	return memoryRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
}
func copyInitialPublic(s C.YNXAccountInitialBytesV1) []byte {
	return C.GoBytes(unsafe.Pointer(s.bytes), C.int(s.length))
}
func borrowInitial(s C.YNXAccountInitialBytesV1) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
}
func checkInitialRequest(req *C.YNXAccountInitialRequestV1, buffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil || buffer == nil || outLength == nil || cleanup == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	if !request.valid() || request.start%unsafe.Alignof(*req) != 0 || uintptr(unsafe.Pointer(outLength))%unsafe.Alignof(*outLength) != 0 || uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return resultBounds
	}
	if req.abi_version != initialABIVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != initialMemberCapacity {
		return resultCapacity
	}
	spans := []struct {
		value        C.YNXAccountInitialBytesV1
		minimum, max uintptr
	}{
		{req.message_original, 1, initialMessageMaximum}, {req.genesis_original, 1, initialGenesisMaximum},
		{req.expected.genesis_sha256, 32, 32}, {req.expected.network_id, 32, 32}, {req.expected.owner, 42, 42}, {req.expected.execution_height, 1, 20},
		{req.expected.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.expected.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
		{req.pkcs8_a, ynxbatch.PKCS8ASize, ynxbatch.PKCS8ASize}, {req.pkcs8_b, ynxbatch.PKCS8BSize, ynxbatch.PKCS8BSize},
		{req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
	}
	inputs := make([]memoryRange, len(spans))
	for i, s := range spans {
		if uintptr(s.value.length) < s.minimum || uintptr(s.value.length) > s.max {
			return resultBounds
		}
		inputs[i] = initialSpanRange(s.value)
	}
	outputs := []memoryRange{{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)}, {uintptr(unsafe.Pointer(outLength)), unsafe.Sizeof(*outLength)}, {uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)}}
	return checkMemoryLayout(request, inputs, outputs)
}

//export YNXAccountInitialSignV1
func YNXAccountInitialSignV1(req *C.YNXAccountInitialRequestV1, callerBuffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanupStatus *C.uint32_t) (result C.int32_t) {
	if code := checkInitialRequest(req, callerBuffer, capacity, outLength, cleanupStatus); code != resultOK {
		return C.int32_t(code)
	}
	*outLength = 0
	*cleanupStatus = C.uint32_t(cleanupNotRequired)
	var member []byte
	defer func() {
		if recover() != nil {
			result = C.int32_t(resultInternal)
			*outLength = 0
			*cleanupStatus = C.uint32_t(cleanupUnknown)
		}
		clear(member)
	}()
	in := initialInputs{message: copyInitialPublic(req.message_original), genesis: copyInitialPublic(req.genesis_original),
		expected: initialExpected{GenesisSHA256: copyInitialPublic(req.expected.genesis_sha256), NetworkID: copyInitialPublic(req.expected.network_id), Owner: string(copyInitialPublic(req.expected.owner)),
			NativeChainID: uint64(req.expected.native_chain_id), ExecutionHeight: string(copyInitialPublic(req.expected.execution_height)), PKA: copyInitialPublic(req.expected.pk_a), PKB: copyInitialPublic(req.expected.pk_b)}}
	plan, code := prepareInitial(in, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanup cleanupCode
	member, code, cleanup = signInitialPrepared(plan, ynxbatch.KeyMaterial{PKCS8A: borrowInitial(req.pkcs8_a), PKCS8B: borrowInitial(req.pkcs8_b), PKA: borrowInitial(req.pk_a), PKB: borrowInitial(req.pk_b)})
	*cleanupStatus = C.uint32_t(cleanup)
	if code != resultOK {
		return C.int32_t(code)
	}
	if cleanup != cleanupLogicalComplete || len(member) == 0 || len(member) > int(capacity) {
		*cleanupStatus = C.uint32_t(cleanupUnknown)
		return C.int32_t(resultCleanup)
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(callerBuffer)), int(capacity)), member)
	*outLength = C.size_t(len(member))
	return C.int32_t(resultOK)
}
