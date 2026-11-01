package main

/*
#include "publisher_registration.h"
*/
import "C"

import (
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type publisherBridgeSpan struct {
	rangeValue memoryRange
	minimum    uintptr
	maximum    uintptr
}

func publisherSpan(s C.YNXArtifactBytesV1, minimum, maximum uintptr) publisherBridgeSpan {
	return publisherBridgeSpan{spanRange(s), minimum, maximum}
}

func publisherControlSpan(s C.YNXProjectControlBytesV1, minimum, maximum uintptr) publisherBridgeSpan {
	return publisherBridgeSpan{controlSpanRange(s), minimum, maximum}
}

func publisherBridgeLayout(request memoryRange, spans []publisherBridgeSpan, outputs []memoryRange) resultCode {
	inputs := make([]memoryRange, len(spans))
	for i, s := range spans {
		if s.rangeValue.length < s.minimum || s.rangeValue.length > s.maximum {
			return resultBounds
		}
		inputs[i] = s.rangeValue
	}
	return checkMemoryLayout(request, inputs, outputs)
}

func publisherExpectedSpans(e C.YNXArtifactPublisherExpectedV1) []publisherBridgeSpan {
	return []publisherBridgeSpan{
		publisherSpan(e.network_id, 32, 32), publisherSpan(e.subject_owner, 42, 42),
		publisherSpan(e.account, 1, 256), publisherSpan(e.project_id, 1, 256),
		publisherSpan(e.publisher_id, 1, 256), publisherSpan(e.publisher_key_version, 1, 20),
		publisherSpan(e.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize), publisherSpan(e.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize),
	}
}

func publisherExpected(e C.YNXArtifactPublisherExpectedV1) ynxbatch.ArtifactPublisherRegistration {
	return ynxbatch.ArtifactPublisherRegistration{NetworkID: copyPublic(e.network_id), SubjectOwner: string(copyPublic(e.subject_owner)),
		Account: string(copyPublic(e.account)), ProjectID: string(copyPublic(e.project_id)), PublisherID: string(copyPublic(e.publisher_id)),
		PublisherKeyVersion: string(copyPublic(e.publisher_key_version)), PKA: copyPublic(e.pk_a), PKB: copyPublic(e.pk_b)}
}

func checkPublisherGenerate(req *C.YNXPublisherGenerateRequestV1, privateBuffer *C.uint8_t, privateCapacity C.size_t, privateLength *C.size_t,
	publicBuffer *C.uint8_t, publicCapacity C.size_t, publicLength *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil || privateBuffer == nil || privateLength == nil || publicBuffer == nil || publicLength == nil || cleanup == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	if !request.valid() || request.start%unsafe.Alignof(*req) != 0 || uintptr(unsafe.Pointer(privateLength))%unsafe.Alignof(*privateLength) != 0 ||
		uintptr(unsafe.Pointer(publicLength))%unsafe.Alignof(*publicLength) != 0 || uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return resultBounds
	}
	if req.abi_version != publisherRegistrationABIVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if privateCapacity != publisherPrivateCapacity || publicCapacity != publisherPublicCapacity {
		return resultCapacity
	}
	i := req.identity
	spans := []publisherBridgeSpan{publisherSpan(i.network_id, 32, 32), publisherSpan(i.subject_owner, 42, 42), publisherSpan(i.account, 1, 256),
		publisherSpan(i.project_id, 1, 256), publisherSpan(i.publisher_id, 1, 256), publisherSpan(i.publisher_key_version, 1, 20)}
	outputs := []memoryRange{{uintptr(unsafe.Pointer(privateBuffer)), uintptr(privateCapacity)}, {uintptr(unsafe.Pointer(privateLength)), unsafe.Sizeof(*privateLength)},
		{uintptr(unsafe.Pointer(publicBuffer)), uintptr(publicCapacity)}, {uintptr(unsafe.Pointer(publicLength)), unsafe.Sizeof(*publicLength)}, {uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)}}
	return publisherBridgeLayout(request, spans, outputs)
}

//export YNXPublisherGenerateV1
func YNXPublisherGenerateV1(req *C.YNXPublisherGenerateRequestV1, privateBuffer *C.uint8_t, privateCapacity C.size_t, privateLength *C.size_t,
	publicBuffer *C.uint8_t, publicCapacity C.size_t, publicLength *C.size_t, cleanupStatus *C.uint32_t) (result C.int32_t) {
	if code := checkPublisherGenerate(req, privateBuffer, privateCapacity, privateLength, publicBuffer, publicCapacity, publicLength, cleanupStatus); code != resultOK {
		return C.int32_t(code)
	}
	*privateLength, *publicLength = 0, 0
	*cleanupStatus = C.uint32_t(cleanupNotRequired)
	var private, public []byte
	defer func() {
		if recover() != nil {
			result = C.int32_t(resultInternal)
			*privateLength, *publicLength = 0, 0
			*cleanupStatus = C.uint32_t(cleanupUnknown)
		}
		clear(private)
		clear(public)
	}()
	i := req.identity
	identity := publisherIdentity{NetworkID: copyPublic(i.network_id), SubjectOwner: string(copyPublic(i.subject_owner)), Account: string(copyPublic(i.account)),
		ProjectID: string(copyPublic(i.project_id)), PublisherID: string(copyPublic(i.publisher_id)), PublisherKeyVersion: string(copyPublic(i.publisher_key_version))}
	plan, code := preparePublisherGenerate(identity, uint64(privateCapacity), uint64(publicCapacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanup cleanupCode
	private, public, code, cleanup = generatePublisherPrepared(plan)
	*cleanupStatus = C.uint32_t(cleanup)
	if code != resultOK {
		return C.int32_t(code)
	}
	if cleanup != cleanupLogicalComplete || len(private) == 0 || len(private) > int(privateCapacity) || len(public) == 0 || len(public) > int(publicCapacity) {
		*cleanupStatus = C.uint32_t(cleanupUnknown)
		return C.int32_t(resultCleanup)
	}
	// Both complete outputs have passed cleanup before either caller buffer is
	// changed. No pointer or owned key handle survives this synchronous call.
	copy(unsafe.Slice((*byte)(unsafe.Pointer(privateBuffer)), int(privateCapacity)), private)
	copy(unsafe.Slice((*byte)(unsafe.Pointer(publicBuffer)), int(publicCapacity)), public)
	*privateLength, *publicLength = C.size_t(len(private)), C.size_t(len(public))
	return C.int32_t(resultOK)
}

func checkPublisherPoP(req *C.YNXPublisherPoPRequestV1, buffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil || buffer == nil || outLength == nil || cleanup == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	if !request.valid() || request.start%unsafe.Alignof(*req) != 0 || uintptr(unsafe.Pointer(outLength))%unsafe.Alignof(*outLength) != 0 || uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return resultBounds
	}
	if req.abi_version != publisherRegistrationABIVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != publisherMemberCapacity {
		return resultCapacity
	}
	spans := []publisherBridgeSpan{publisherSpan(req.public_original, 1, ynxbatch.MaxPublisherRegistrationPublicBytes), publisherSpan(req.principal_original, 1, ynxbatch.MaxProjectControlPrincipalBytes),
		publisherSpan(req.command_original, 1, ynxbatch.MaxProjectControlCommandBytes), publisherSpan(req.registration_original, 1, ynxbatch.MaxPublisherRegistrationBodyBytes)}
	spans = append(spans, publisherExpectedSpans(req.publisher)...)
	spans = append(spans, publisherSpan(req.pkcs8_a, ynxbatch.PKCS8ASize, ynxbatch.PKCS8ASize), publisherSpan(req.pkcs8_b, ynxbatch.PKCS8BSize, ynxbatch.PKCS8BSize),
		publisherSpan(req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize), publisherSpan(req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize))
	return publisherBridgeLayout(request, spans, []memoryRange{{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)}, {uintptr(unsafe.Pointer(outLength)), unsafe.Sizeof(*outLength)}, {uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)}})
}

//export YNXPublisherPoPSignV1
func YNXPublisherPoPSignV1(req *C.YNXPublisherPoPRequestV1, callerBuffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanupStatus *C.uint32_t) (result C.int32_t) {
	if code := checkPublisherPoP(req, callerBuffer, capacity, outLength, cleanupStatus); code != resultOK {
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
	in := publisherRegistrationInputs{public: copyPublic(req.public_original), principal: copyPublic(req.principal_original), command: copyPublic(req.command_original),
		registration: copyPublic(req.registration_original), publisher: publisherExpected(req.publisher), atMS: uint64(req.observed_at_ms)}
	plan, code := preparePublisherPoP(in, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanup cleanupCode
	member, code, cleanup = signPublisherPrepared(plan, ynxbatch.KeyMaterial{PKCS8A: borrow(req.pkcs8_a), PKCS8B: borrow(req.pkcs8_b), PKA: borrow(req.pk_a), PKB: borrow(req.pk_b)})
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

func checkPublisherCustodian(req *C.YNXPublisherCustodianRequestV1, buffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil || buffer == nil || outLength == nil || cleanup == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	if !request.valid() || request.start%unsafe.Alignof(*req) != 0 || uintptr(unsafe.Pointer(outLength))%unsafe.Alignof(*outLength) != 0 || uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return resultBounds
	}
	if req.abi_version != publisherRegistrationABIVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != publisherMemberCapacity {
		return resultCapacity
	}
	spans := []publisherBridgeSpan{publisherSpan(req.public_original, 1, ynxbatch.MaxPublisherRegistrationPublicBytes), publisherSpan(req.principal_original, 1, ynxbatch.MaxProjectControlPrincipalBytes),
		publisherSpan(req.command_original, 1, ynxbatch.MaxProjectControlCommandBytes), publisherSpan(req.registration_original, 1, ynxbatch.MaxPublisherRegistrationBodyBytes), publisherSpan(req.pop_member_original, 1, ynxbatch.MaxPublisherRegistrationPoPMemberBytes)}
	spans = append(spans, publisherExpectedSpans(req.publisher)...)
	c := req.custodian
	spans = append(spans, publisherControlSpan(c.network_id, 32, 32), publisherControlSpan(c.owner, 42, 42), publisherControlSpan(c.key_version, 1, 20), publisherControlSpan(c.execution_height, 1, 20),
		publisherControlSpan(c.caller_identity, 1, 256), publisherControlSpan(c.source_current_ref, 1, 256), publisherControlSpan(c.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize), publisherControlSpan(c.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize),
		publisherSpan(req.pkcs8_a, ynxbatch.PKCS8ASize, ynxbatch.PKCS8ASize), publisherSpan(req.pkcs8_b, ynxbatch.PKCS8BSize, ynxbatch.PKCS8BSize), publisherSpan(req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize), publisherSpan(req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize))
	return publisherBridgeLayout(request, spans, []memoryRange{{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)}, {uintptr(unsafe.Pointer(outLength)), unsafe.Sizeof(*outLength)}, {uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)}})
}

//export YNXPublisherCustodianSignV1
func YNXPublisherCustodianSignV1(req *C.YNXPublisherCustodianRequestV1, callerBuffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanupStatus *C.uint32_t) (result C.int32_t) {
	if code := checkPublisherCustodian(req, callerBuffer, capacity, outLength, cleanupStatus); code != resultOK {
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
	c := req.custodian
	in := publisherRegistrationInputs{public: copyPublic(req.public_original), principal: copyPublic(req.principal_original), command: copyPublic(req.command_original), registration: copyPublic(req.registration_original),
		pop: copyPublic(req.pop_member_original), publisher: publisherExpected(req.publisher), atMS: uint64(req.observed_at_ms), custodian: ynxbatch.PublisherRegistrationCustodianBinding{
			NetworkID: copyControlPublic(c.network_id), Owner: string(copyControlPublic(c.owner)), KeyVersion: string(copyControlPublic(c.key_version)), ExecutionHeight: string(copyControlPublic(c.execution_height)),
			CallerIdentity: string(copyControlPublic(c.caller_identity)), SourceCurrentRef: string(copyControlPublic(c.source_current_ref)), PKA: copyControlPublic(c.pk_a), PKB: copyControlPublic(c.pk_b)}}
	plan, code := preparePublisherCustodian(in, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanup cleanupCode
	member, code, cleanup = signPublisherPrepared(plan, ynxbatch.KeyMaterial{PKCS8A: borrow(req.pkcs8_a), PKCS8B: borrow(req.pkcs8_b), PKA: borrow(req.pk_a), PKB: borrow(req.pk_b)})
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
