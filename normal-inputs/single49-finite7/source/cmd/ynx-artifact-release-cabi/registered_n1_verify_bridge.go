package main

/*
#include "registered_n1_verify.h"
*/
import "C"

import (
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// All ranges are checked without reading the spans' contents or writing result.
// A rejected output alias must never initialize the bytes of a borrowed input.
func checkRegisteredN1Layout(req *C.YNXRegisteredANDMemberVerifyN1RequestV1, out *C.YNXRegisteredANDMemberVerifyN1ResultV1) registeredN1VerifyCode {
	if req == nil || out == nil || unsafe.Sizeof(uintptr(0)) != 8 {
		return registeredN1Argument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	output := memoryRange{uintptr(unsafe.Pointer(out)), unsafe.Sizeof(*out)}
	if !request.valid() || !output.valid() || request.start%unsafe.Alignof(*req) != 0 || output.start%unsafe.Alignof(*out) != 0 {
		return registeredN1Argument
	}
	spans := []struct {
		span     C.YNXReadOnlyPublicSpanV1
		min, max uint64
	}{
		{req.member, 1, registeredN1MemberMaximum}, {req.message, 0, registeredN1MessageMaximum},
		{req.network, 32, 32}, {req.owner, 1, 128}, {req.purpose, 1, 64},
		{req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
	}
	inputs := make([]memoryRange, 0, len(spans))
	for _, item := range spans {
		length := uint64(item.span.bytes)
		if length < item.min || length > item.max {
			return registeredN1Argument
		}
		// Empty opaque messages are legal and read no bytes. A NULL pointer is
		// legal only for this empty span; it never reaches C.GoBytes.
		if length != 0 {
			inputs = append(inputs, memoryRange{uintptr(unsafe.Pointer(item.span.data)), uintptr(length)})
		}
	}
	if checkMemoryLayout(request, inputs, []memoryRange{output}) != resultOK {
		return registeredN1Argument
	}
	return registeredN1OK
}

func copyRegisteredN1Public(span C.YNXReadOnlyPublicSpanV1) []byte {
	if span.bytes == 0 {
		return nil
	}
	return C.GoBytes(unsafe.Pointer(span.data), C.int(span.bytes))
}

func initializeRegisteredN1Result(out *C.YNXRegisteredANDMemberVerifyN1ResultV1) {
	*out = C.YNXRegisteredANDMemberVerifyN1ResultV1{}
	out.version = registeredN1Version
	out.struct_size = C.uint32_t(unsafe.Sizeof(*out))
}

//export YNXRegisteredANDMemberVerifyN1V1
func YNXRegisteredANDMemberVerifyN1V1(req *C.YNXRegisteredANDMemberVerifyN1RequestV1,
	out *C.YNXRegisteredANDMemberVerifyN1ResultV1) (result C.int32_t) {
	layoutAdmitted := false
	defer func() {
		if recover() != nil {
			if layoutAdmitted {
				initializeRegisteredN1Result(out)
			}
			result = C.int32_t(registeredN1Internal)
		}
	}()
	if code := checkRegisteredN1Layout(req, out); code != registeredN1OK {
		return C.int32_t(code)
	}
	layoutAdmitted = true
	initializeRegisteredN1Result(out)
	if req.version != registeredN1Version || req.struct_size != C.uint32_t(unsafe.Sizeof(*req)) {
		return C.int32_t(registeredN1Argument)
	}
	in := registeredN1Inputs{member: copyRegisteredN1Public(req.member), message: copyRegisteredN1Public(req.message),
		network: copyRegisteredN1Public(req.network), owner: string(copyRegisteredN1Public(req.owner)), purpose: string(copyRegisteredN1Public(req.purpose)),
		pkA: copyRegisteredN1Public(req.pk_a), pkB: copyRegisteredN1Public(req.pk_b), policyRevision: uint64(req.policy_revision),
		observedHeight: uint64(req.observed_height), activeFrom: uint64(req.active_from), revokedAt: uint64(req.revoked_at),
		enabled: uint32(req.enabled), hasRevokedAt: uint32(req.has_revoked_at)}
	code := verifyRegisteredANDMemberN1(in)
	if code == registeredN1OK {
		out.verified, out.member_count = 1, 1
	}
	return C.int32_t(code)
}
