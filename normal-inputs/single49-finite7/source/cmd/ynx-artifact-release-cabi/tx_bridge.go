package main

/*
#include "tx_batch.h"
*/
import "C"

import (
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func transactionSpanRange(s C.YNXTransactionBytesV1) memoryRange {
	return memoryRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
}

func copyTransactionPublic(s C.YNXTransactionBytesV1) []byte {
	return C.GoBytes(unsafe.Pointer(s.bytes), C.int(s.length))
}

func borrowTransaction(s C.YNXTransactionBytesV1) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
}

func checkTransactionRequest(req *C.YNXTransactionBatchRequestV1, buffer *C.uint8_t, capacity C.size_t,
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
	if req.abi_version != txABIVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != txMemberCapacity {
		return resultCapacity
	}
	spans := []struct {
		value        C.YNXTransactionBytesV1
		minimum, max uintptr
	}{
		{req.message_original, 1, txMessageMaximum}, {req.policy_original, 1, txPolicyMaximum},
		{req.expected.network_id, 32, 32}, {req.expected.owner, 42, 42},
		{req.expected.key_version, 1, 20}, {req.expected.execution_height, 1, 20},
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
		inputs[i] = transactionSpanRange(span.value)
	}
	outputs := []memoryRange{
		{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)},
		{uintptr(unsafe.Pointer(outLength)), unsafe.Sizeof(*outLength)},
		{uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)},
	}
	return checkMemoryLayout(request, inputs, outputs)
}

//export YNXTransactionBatchSignV1
func YNXTransactionBatchSignV1(req *C.YNXTransactionBatchRequestV1, callerBuffer *C.uint8_t,
	capacity C.size_t, outLength *C.size_t, cleanupStatus *C.uint32_t) (result C.int32_t) {
	// Do not even write failure scalars until all output/input overlap checks
	// pass: the caller's scalar could alias its original private-key borrow.
	if code := checkTransactionRequest(req, callerBuffer, capacity, outLength, cleanupStatus); code != resultOK {
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
	in := txInputs{message: copyTransactionPublic(req.message_original), policy: copyTransactionPublic(req.policy_original),
		expected: txExpected{NetworkID: copyTransactionPublic(req.expected.network_id), Owner: string(copyTransactionPublic(req.expected.owner)),
			NativeChainID: uint64(req.expected.native_chain_id), KeyVersion: string(copyTransactionPublic(req.expected.key_version)),
			ExecutionHeight: string(copyTransactionPublic(req.expected.execution_height)),
			PKA:             copyTransactionPublic(req.expected.pk_a), PKB: copyTransactionPublic(req.expected.pk_b)}}
	plan, code := prepareTransaction(in, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanup cleanupCode
	member, code, cleanup = signTransactionPrepared(plan, ynxbatch.KeyMaterial{
		PKCS8A: borrowTransaction(req.pkcs8_a), PKCS8B: borrowTransaction(req.pkcs8_b),
		PKA: borrowTransaction(req.pk_a), PKB: borrowTransaction(req.pk_b)})
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
