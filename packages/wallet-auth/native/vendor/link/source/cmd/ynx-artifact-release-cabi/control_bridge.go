package main

/*
#include "ynx_project_control.h"
*/
import "C"

import (
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func controlSpanRange(s C.YNXProjectControlBytesV1) memoryRange {
	return memoryRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
}

func controlSpanBounds(s C.YNXProjectControlBytesV1, minimum, maximum uintptr) bool {
	return uintptr(s.length) >= minimum && uintptr(s.length) <= maximum
}

// These copies contain public DATA only. Bounds are checked before C.GoBytes.
func copyControlPublic(s C.YNXProjectControlBytesV1) []byte {
	return C.GoBytes(unsafe.Pointer(s.bytes), C.int(s.length))
}

// Read-only C borrowControl. It is neither retained nor returned; signControlPrepared makes
// owned copies only after complete public preflight. No provider internals are
// reached with unsafe; it is used only for this explicit C memory boundary.
func borrowControl(s C.YNXProjectControlBytesV1) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
}

func checkControlRequest(req *C.YNXProjectControlRequestV1, buffer *C.uint8_t, capacity C.size_t,
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
	// Valid allocation/lifetime is a caller precondition, not a checked fact.
	if req.abi_version != controlABIVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != controlMemberCapacity {
		return resultCapacity
	}
	spans := []struct {
		value        C.YNXProjectControlBytesV1
		minimum, max uintptr
	}{
		{req.principal_original, 1, principalMaximum}, {req.command_original, 1, commandMaximum}, {req.decision_original, 1, decisionMaximum},
		{req.expected.network_id, 32, 32}, {req.expected.owner, 42, 42},
		{req.expected.key_version, 1, 20}, {req.expected.execution_height, 1, 20},
		{req.expected.caller_identity, 1, 256}, {req.expected.source_current_ref, 1, 256},
		{req.expected.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize},
		{req.expected.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
		{req.pkcs8_a, ynxbatch.PKCS8ASize, ynxbatch.PKCS8ASize}, {req.pkcs8_b, ynxbatch.PKCS8BSize, ynxbatch.PKCS8BSize},
		{req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
	}
	inputs := make([]memoryRange, len(spans))
	for i, span := range spans {
		if !controlSpanBounds(span.value, span.minimum, span.max) {
			return resultBounds
		}
		inputs[i] = controlSpanRange(span.value)
	}
	outputs := []memoryRange{
		{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)},
		{uintptr(unsafe.Pointer(outLength)), unsafe.Sizeof(*outLength)},
		{uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)},
	}
	return checkMemoryLayout(request, inputs, outputs)
}

//export YNXProjectControlSignV1
func YNXProjectControlSignV1(req *C.YNXProjectControlRequestV1, callerBuffer *C.uint8_t,
	capacity C.size_t, outLength *C.size_t, cleanupStatus *C.uint32_t) (result C.int32_t) {
	// Pointer/overlap rejection cannot write even a failure scalar: it might
	// alias KEY7. Main initializes the scalars and discards output on failure.
	if code := checkControlRequest(req, callerBuffer, capacity, outLength, cleanupStatus); code != resultOK {
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
	in := controlInputs{principal: copyControlPublic(req.principal_original), command: copyControlPublic(req.command_original), decision: copyControlPublic(req.decision_original),
		atMS: uint64(req.observed_at_ms), expected: ynxbatch.ProjectControlBinding{
			NetworkID: copyControlPublic(req.expected.network_id), Owner: string(copyControlPublic(req.expected.owner)),
			KeyVersion: string(copyControlPublic(req.expected.key_version)), ExecutionHeight: string(copyControlPublic(req.expected.execution_height)),
			CallerIdentity: string(copyControlPublic(req.expected.caller_identity)), SourceCurrentRef: string(copyControlPublic(req.expected.source_current_ref)),
			PKA: copyControlPublic(req.expected.pk_a), PKB: copyControlPublic(req.expected.pk_b),
		}}
	plan, code := prepareControl(in, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanup cleanupCode
	member, code, cleanup = signControlPrepared(plan, ynxbatch.KeyMaterial{
		PKCS8A: borrowControl(req.pkcs8_a), PKCS8B: borrowControl(req.pkcs8_b), PKA: borrowControl(req.pk_a), PKB: borrowControl(req.pk_b)})
	*cleanupStatus = C.uint32_t(cleanup)
	if code != resultOK {
		return C.int32_t(code)
	}
	if cleanup != cleanupLogicalComplete || len(member) == 0 || len(member) > int(capacity) {
		*cleanupStatus = C.uint32_t(cleanupUnknown)
		return C.int32_t(resultCleanup)
	}
	// All input reads and logical key cleanup are complete before any signature
	// output reaches the caller's memory. No Go pointer is stored in C memory.
	copy(unsafe.Slice((*byte)(unsafe.Pointer(callerBuffer)), int(capacity)), member)
	*outLength = C.size_t(len(member))
	return C.int32_t(resultOK)
}
