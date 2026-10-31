package main

/*
#include "deployment_manifest_v2.h"
*/
import "C"

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"unsafe"
)

func checkDeploymentManifestV2Request(req *C.YNXDeploymentManifestRequestV2, buffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil || buffer == nil || outLength == nil || cleanup == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	if !request.valid() || request.start%unsafe.Alignof(*req) != 0 || uintptr(unsafe.Pointer(outLength))%unsafe.Alignof(*outLength) != 0 || uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return resultBounds
	}
	if req.abi_version != deploymentManifestVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != deploymentManifestCapacity {
		return resultCapacity
	}
	spans := []struct {
		value            C.YNXArtifactBytesV1
		minimum, maximum uintptr
	}{
		{req.payload_original, 1, ynxbatch.DeploymentManifestV2MaxBytes}, {req.actual_artifact, 0, ynxbatch.DeploymentArtifactV2MaxBytes},
		{req.expected_payload_original, 1, ynxbatch.DeploymentManifestV2MaxBytes}, {req.expected_payload_bind, ynxbatch.DeploymentV2BindBytes, ynxbatch.DeploymentV2BindBytes},
		{req.expected_artifact_bind, ynxbatch.DeploymentV2BindBytes, ynxbatch.DeploymentV2BindBytes}, {req.profile_network_id, 32, 32}, {req.subject_owner, 1, 128},
		{req.expected_pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.expected_pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
		{req.pkcs8_a, ynxbatch.PKCS8ASize, ynxbatch.PKCS8ASize}, {req.pkcs8_b, ynxbatch.PKCS8BSize, ynxbatch.PKCS8BSize},
		{req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
	}
	inputs := make([]memoryRange, 0, len(spans))
	for _, span := range spans {
		if !spanBounds(span.value, span.minimum, span.maximum) {
			return resultBounds
		}
		// Zero-byte artifacts are valid SDK DATA. No address is read for them;
		// all nonempty spans still undergo checked extent/overlap validation.
		if span.value.length == 0 {
			continue
		}
		inputs = append(inputs, spanRange(span.value))
	}
	return checkMemoryLayout(request, inputs, []memoryRange{{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)}, {uintptr(unsafe.Pointer(outLength)), unsafe.Sizeof(*outLength)}, {uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)}})
}

//export YNXDeploymentManifestSignV2
func YNXDeploymentManifestSignV2(req *C.YNXDeploymentManifestRequestV2, buffer *C.uint8_t, capacity C.size_t, outLength *C.size_t, cleanupStatus *C.uint32_t) (result C.int32_t) {
	if code := checkDeploymentManifestV2Request(req, buffer, capacity, outLength, cleanupStatus); code != resultOK {
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
	payloadBind, err := ynxbatch.DecodeDeploymentV2Bind(copyPublic(req.expected_payload_bind))
	if err != nil {
		return C.int32_t(resultPublicBinding)
	}
	artifactBind, err := ynxbatch.DecodeDeploymentV2Bind(copyPublic(req.expected_artifact_bind))
	if err != nil {
		return C.int32_t(resultPublicBinding)
	}
	var artifact []byte
	if req.actual_artifact.length != 0 {
		artifact = borrow(req.actual_artifact)
	}
	in := deploymentManifestV2Inputs{payload: copyPublic(req.payload_original), actualArtifact: artifact, expected: ynxbatch.DeploymentManifestV2SigningBinding{
		NetworkID: copyPublic(req.profile_network_id), SubjectOwner: string(copyPublic(req.subject_owner)), PKA: copyPublic(req.expected_pk_a), PKB: copyPublic(req.expected_pk_b),
		PayloadOriginal: copyPublic(req.expected_payload_original), PayloadBind: payloadBind, ArtifactBind: artifactBind}}
	plan, code := prepareDeploymentManifestV2(in, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var cleanup cleanupCode
	member, code, cleanup = signDeploymentManifestV2Prepared(plan, ynxbatch.KeyMaterial{PKCS8A: borrow(req.pkcs8_a), PKCS8B: borrow(req.pkcs8_b), PKA: borrow(req.pk_a), PKB: borrow(req.pk_b)})
	*cleanupStatus = C.uint32_t(cleanup)
	if code != resultOK {
		return C.int32_t(code)
	}
	if cleanup != cleanupLogicalComplete || len(member) == 0 || len(member) > int(capacity) {
		*cleanupStatus = C.uint32_t(cleanupUnknown)
		return C.int32_t(resultCleanup)
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(buffer)), int(capacity)), member)
	*outLength = C.size_t(len(member))
	return C.int32_t(resultOK)
}
