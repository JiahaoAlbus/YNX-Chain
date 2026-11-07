package main

/*
#include "ynx_artifact_release.h"
*/
import "C"

import (
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func spanRange(s C.YNXArtifactBytesV1) memoryRange {
	return memoryRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
}

func spanBounds(s C.YNXArtifactBytesV1, minimum, maximum uintptr) bool {
	return uintptr(s.length) >= minimum && uintptr(s.length) <= maximum
}

// These copies contain public DATA only. Bounds are checked before C.GoBytes.
func copyPublic(s C.YNXArtifactBytesV1) []byte {
	return C.GoBytes(unsafe.Pointer(s.bytes), C.int(s.length))
}

// Read-only C borrow. It is neither retained nor returned; signPrepared makes
// owned copies only after complete public preflight. No provider internals are
// reached with unsafe; it is used only for this explicit C memory boundary.
func borrow(s C.YNXArtifactBytesV1) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
}

func checkRequest(req *C.YNXArtifactPublicationRequestV1, buffer *C.uint8_t, capacity C.size_t,
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
	if req.abi_version != abiVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != memberCapacity {
		return resultCapacity
	}
	spans := []struct {
		value        C.YNXArtifactBytesV1
		minimum, max uintptr
	}{
		{req.registration_original, 1, registrationMaximum}, {req.manifest_original, 1, manifestMaximum},
		{req.expected.network_id, 32, 32}, {req.expected.subject_owner, 42, 42},
		{req.expected.account, 1, 256}, {req.expected.project_id, 1, 256},
		{req.expected.publisher_id, 1, 256}, {req.expected.publisher_key_version, 1, 20},
		{req.expected.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize},
		{req.expected.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
		{req.pkcs8_a, ynxbatch.PKCS8ASize, ynxbatch.PKCS8ASize}, {req.pkcs8_b, ynxbatch.PKCS8BSize, ynxbatch.PKCS8BSize},
		{req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
	}
	inputs := make([]memoryRange, len(spans))
	for i, span := range spans {
		if !spanBounds(span.value, span.minimum, span.max) {
			return resultBounds
		}
		inputs[i] = spanRange(span.value)
	}
	outputs := []memoryRange{
		{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)},
		{uintptr(unsafe.Pointer(outLength)), unsafe.Sizeof(*outLength)},
		{uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)},
	}
	return checkMemoryLayout(request, inputs, outputs)
}

//export YNXArtifactPublicationSignV1
func YNXArtifactPublicationSignV1(req *C.YNXArtifactPublicationRequestV1, callerBuffer *C.uint8_t,
	capacity C.size_t, outLength *C.size_t, cleanupStatus *C.uint32_t) (result C.int32_t) {
	// Pointer/overlap rejection cannot write even a failure scalar: it might
	// alias KEY7. Main initializes the scalars and discards output on failure.
	if code := checkRequest(req, callerBuffer, capacity, outLength, cleanupStatus); code != resultOK {
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
	in := publicationInputs{registration: copyPublic(req.registration_original), manifest: copyPublic(req.manifest_original),
		expected: ynxbatch.ArtifactPublisherRegistration{
			NetworkID: copyPublic(req.expected.network_id), SubjectOwner: string(copyPublic(req.expected.subject_owner)),
			Account: string(copyPublic(req.expected.account)), ProjectID: string(copyPublic(req.expected.project_id)),
			PublisherID: string(copyPublic(req.expected.publisher_id)), PublisherKeyVersion: string(copyPublic(req.expected.publisher_key_version)),
			PKA: copyPublic(req.expected.pk_a), PKB: copyPublic(req.expected.pk_b),
		}}
	plan, code := preparePublication(in, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanup cleanupCode
	member, code, cleanup = signPrepared(plan, ynxbatch.KeyMaterial{
		PKCS8A: borrow(req.pkcs8_a), PKCS8B: borrow(req.pkcs8_b), PKA: borrow(req.pk_a), PKB: borrow(req.pk_b)})
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
