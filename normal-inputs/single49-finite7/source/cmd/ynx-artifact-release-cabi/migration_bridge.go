package main

/*
#include "account_migration.h"
*/
import "C"

import (
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func migrationSpanRange(s C.YNXAccountMigrationBytesV1) memoryRange {
	return memoryRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
}

func copyMigrationPublic(s C.YNXAccountMigrationBytesV1) []byte {
	if s.length == 0 {
		return nil
	}
	return C.GoBytes(unsafe.Pointer(s.bytes), C.int(s.length))
}

func borrowMigration(s C.YNXAccountMigrationBytesV1) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
}

func checkMigrationRequest(req *C.YNXAccountMigrationRequestV1, buffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil || buffer == nil || outLength == nil || cleanup == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	if !request.valid() || request.start%unsafe.Alignof(*req) != 0 || uintptr(unsafe.Pointer(outLength))%unsafe.Alignof(*outLength) != 0 || uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return resultBounds
	}
	if req.abi_version != migrationABIVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != migrationWholeCapacity {
		return resultCapacity
	}
	spans := []struct {
		value            C.YNXAccountMigrationBytesV1
		minimum, maximum uintptr
		private          bool
	}{
		{req.message_original, 1, migrationMessageMaximum, false}, {req.policy_original, 1, txPolicyMaximum, false},
		{req.classic_public_key, 0, 33, false}, {req.classic_signature, 0, 72, false}, {req.current_pq_proof, 0, migrationProofMaximum, false},
		{req.expected.network_id, 32, 32, false}, {req.expected.owner, 42, 42, false},
		{req.expected.new_revision, 1, 20, false}, {req.expected.current_nonce, 1, 20, false}, {req.expected.execution_height, 1, 20, false},
		{req.expected.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize, false}, {req.expected.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize, false},
		{req.pkcs8_a, ynxbatch.PKCS8ASize, ynxbatch.PKCS8ASize, true}, {req.pkcs8_b, ynxbatch.PKCS8BSize, ynxbatch.PKCS8BSize, true},
		{req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize, false}, {req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize, false},
	}
	inputs := make([]memoryRange, 0, len(spans))
	publicInputs, privateInputs := make([]memoryRange, 0, len(spans)-2), make([]memoryRange, 0, 2)
	for _, span := range spans {
		if uintptr(span.value.length) < span.minimum || uintptr(span.value.length) > span.maximum {
			return resultBounds
		}
		if span.value.length != 0 {
			r := migrationSpanRange(span.value)
			inputs = append(inputs, r)
			if span.private {
				privateInputs = append(privateInputs, r)
			} else {
				publicInputs = append(publicInputs, r)
			}
		}
	}
	if code := checkMemoryLayout(request, inputs, []memoryRange{{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)}, {uintptr(unsafe.Pointer(outLength)), unsafe.Sizeof(*outLength)}, {uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)}}); code != resultOK {
		return code
	}
	// Every extent is now valid and overflow-checked. Public inputs are copied
	// before private import; none may cover even one byte of either PKCS8 span,
	// otherwise C.GoBytes/string conversion would retain private bytes as DATA.
	// Public/public and private/private aliases keep their original contract.
	for _, public := range publicInputs {
		for _, private := range privateInputs {
			if overlaps(public, private) {
				return resultOverlap
			}
		}
	}
	return resultOK
}

//export YNXAccountMigrationPossessionSignV1
func YNXAccountMigrationPossessionSignV1(req *C.YNXAccountMigrationRequestV1, callerBuffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanupStatus *C.uint32_t) (result C.int32_t) {
	if code := checkMigrationRequest(req, callerBuffer, capacity, outLength, cleanupStatus); code != resultOK {
		return C.int32_t(code)
	}
	*outLength = 0
	*cleanupStatus = C.uint32_t(cleanupNotRequired)
	var whole []byte
	defer func() {
		if recover() != nil {
			result = C.int32_t(resultInternal)
			*outLength = 0
			*cleanupStatus = C.uint32_t(cleanupUnknown)
		}
		clear(whole)
	}()
	in := migrationInputs{message: copyMigrationPublic(req.message_original), policy: copyMigrationPublic(req.policy_original),
		classicPublicKey: copyMigrationPublic(req.classic_public_key), classicSignature: copyMigrationPublic(req.classic_signature), currentPQProof: copyMigrationPublic(req.current_pq_proof),
		signingPKA: copyMigrationPublic(req.pk_a), signingPKB: copyMigrationPublic(req.pk_b),
		expected: migrationExpected{NetworkID: copyMigrationPublic(req.expected.network_id), Owner: string(copyMigrationPublic(req.expected.owner)),
			NewRevision: string(copyMigrationPublic(req.expected.new_revision)), CurrentNonce: string(copyMigrationPublic(req.expected.current_nonce)),
			ExecutionHeight: string(copyMigrationPublic(req.expected.execution_height)), PKA: copyMigrationPublic(req.expected.pk_a), PKB: copyMigrationPublic(req.expected.pk_b)}}
	plan, code := prepareMigration(in, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanup cleanupCode
	whole, code, cleanup = signMigrationPrepared(plan, ynxbatch.KeyMaterial{PKCS8A: borrowMigration(req.pkcs8_a), PKCS8B: borrowMigration(req.pkcs8_b), PKA: borrowMigration(req.pk_a), PKB: borrowMigration(req.pk_b)})
	*cleanupStatus = C.uint32_t(cleanup)
	if code != resultOK {
		return C.int32_t(code)
	}
	if cleanup != cleanupLogicalComplete || len(whole) == 0 || len(whole) > int(capacity) {
		*cleanupStatus = C.uint32_t(cleanupUnknown)
		return C.int32_t(resultCleanup)
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(callerBuffer)), int(capacity)), whole)
	*outLength = C.size_t(len(whole))
	return C.int32_t(resultOK)
}
