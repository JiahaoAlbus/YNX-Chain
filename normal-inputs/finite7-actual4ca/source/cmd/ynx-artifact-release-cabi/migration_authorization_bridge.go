package main

/*
#include "account_migration_authorization.h"
*/
import "C"

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"unsafe"
)

func migrationAuthorizationRange(s C.YNXAccountMigrationAuthorizationBytesV1) memoryRange {
	return memoryRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
}
func copyMigrationAuthorizationPublic(s C.YNXAccountMigrationAuthorizationBytesV1) []byte {
	return C.GoBytes(unsafe.Pointer(s.bytes), C.int(s.length))
}
func borrowMigrationAuthorization(s C.YNXAccountMigrationAuthorizationBytesV1) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
}

func checkMigrationAuthorizationRequest(req *C.YNXAccountMigrationAuthorizationRequestV1, buffer *C.uint8_t, capacity C.size_t, length *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil || buffer == nil || length == nil || cleanup == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	if !request.valid() || request.start%unsafe.Alignof(*req) != 0 || uintptr(unsafe.Pointer(length))%unsafe.Alignof(*length) != 0 || uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return resultBounds
	}
	if req.abi_version != 1 || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != migrationAuthorizationCapacity {
		return resultCapacity
	}
	publicSpans := []struct {
		value            C.YNXAccountMigrationAuthorizationBytesV1
		minimum, maximum uintptr
	}{
		{req.message_original, 1, migrationMessageMaximum}, {req.policy_original, 1, txPolicyMaximum},
		{req.expected.network_id, 32, 32}, {req.expected.owner, 42, 42}, {req.expected.current_revision, 1, 20}, {req.expected.current_nonce, 1, 20}, {req.expected.execution_height, 1, 20},
		{req.expected.current_pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.expected.current_pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
		{req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
	}
	public := make([]memoryRange, 0, len(publicSpans))
	for _, span := range publicSpans {
		if uintptr(span.value.length) < span.minimum || uintptr(span.value.length) > span.maximum {
			return resultBounds
		}
		public = append(public, migrationAuthorizationRange(span.value))
	}
	if req.pkcs8_a.length != ynxbatch.PKCS8ASize || req.pkcs8_b.length != ynxbatch.PKCS8BSize {
		return resultBounds
	}
	private := []memoryRange{migrationAuthorizationRange(req.pkcs8_a), migrationAuthorizationRange(req.pkcs8_b)}
	return checkMigrationAuthorizationLayout(request, public, private, []memoryRange{{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)}, {uintptr(unsafe.Pointer(length)), unsafe.Sizeof(*length)}, {uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)}})
}

//export YNXAccountMigrationAuthorizationSignV1
func YNXAccountMigrationAuthorizationSignV1(req *C.YNXAccountMigrationAuthorizationRequestV1, buffer *C.uint8_t, capacity C.size_t, length *C.size_t, cleanup *C.uint32_t) (result C.int32_t) {
	if code := checkMigrationAuthorizationRequest(req, buffer, capacity, length, cleanup); code != resultOK {
		return C.int32_t(code)
	}
	*length = 0
	*cleanup = C.uint32_t(cleanupNotRequired)
	var member []byte
	defer func() {
		if recover() != nil {
			result = C.int32_t(resultInternal)
			*length = 0
			*cleanup = C.uint32_t(cleanupUnknown)
		}
		clear(member)
	}()
	in := migrationAuthorizationInputs{message: copyMigrationAuthorizationPublic(req.message_original), policy: copyMigrationAuthorizationPublic(req.policy_original),
		signingPKA: copyMigrationAuthorizationPublic(req.pk_a), signingPKB: copyMigrationAuthorizationPublic(req.pk_b),
		expected: migrationAuthorizationExpected{NetworkID: copyMigrationAuthorizationPublic(req.expected.network_id), Owner: string(copyMigrationAuthorizationPublic(req.expected.owner)),
			CurrentRevision: string(copyMigrationAuthorizationPublic(req.expected.current_revision)), CurrentNonce: string(copyMigrationAuthorizationPublic(req.expected.current_nonce)), ExecutionHeight: string(copyMigrationAuthorizationPublic(req.expected.execution_height)),
			CurrentPKA: copyMigrationAuthorizationPublic(req.expected.current_pk_a), CurrentPKB: copyMigrationAuthorizationPublic(req.expected.current_pk_b)}}
	plan, code := prepareMigrationAuthorization(in, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var clean cleanupCode
	member, code, clean = signMigrationAuthorizationPrepared(plan, ynxbatch.KeyMaterial{PKCS8A: borrowMigrationAuthorization(req.pkcs8_a), PKCS8B: borrowMigrationAuthorization(req.pkcs8_b), PKA: borrowMigrationAuthorization(req.pk_a), PKB: borrowMigrationAuthorization(req.pk_b)})
	*cleanup = C.uint32_t(clean)
	if code != resultOK {
		return C.int32_t(code)
	}
	if clean != cleanupLogicalComplete || len(member) == 0 || len(member) > int(capacity) {
		*cleanup = C.uint32_t(cleanupUnknown)
		return C.int32_t(resultCleanup)
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(buffer)), int(capacity)), member)
	*length = C.size_t(len(member))
	return C.int32_t(resultOK)
}
