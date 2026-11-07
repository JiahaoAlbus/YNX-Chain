package main

/*
#include "auth_source_statement_v2.h"
*/
import "C"
import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"unsafe"
)

func checkSourceStatementV2Layout(req *C.YNXAuthSourceStatementVerifyRequestV2, out *C.YNXRegisteredANDMemberVerifyN1ResultV1) registeredN1VerifyCode {
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
		{req.member, 1, ynxbatch.AuthSourceStatementV2MemberMaximum}, {req.body_original, 1, ynxbatch.AuthSourceStatementV2BodyMaximum},
		{req.expected_frame, 1, 512}, {req.network, 32, 32}, {req.owner, 42, 42},
		{req.pk_a, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyASize}, {req.pk_b, ynxbatch.PublicKeyBSize, ynxbatch.PublicKeyBSize},
	}
	inputs := make([]memoryRange, 0, len(spans))
	for _, item := range spans {
		n := uint64(item.span.bytes)
		if n < item.min || n > item.max {
			return registeredN1Argument
		}
		inputs = append(inputs, memoryRange{uintptr(unsafe.Pointer(item.span.data)), uintptr(n)})
	}
	if checkMemoryLayout(request, inputs, []memoryRange{output}) != resultOK {
		return registeredN1Argument
	}
	return registeredN1OK
}

//export YNXAuthSourceStatementVerifyV2
func YNXAuthSourceStatementVerifyV2(req *C.YNXAuthSourceStatementVerifyRequestV2, out *C.YNXRegisteredANDMemberVerifyN1ResultV1) (result C.int32_t) {
	admitted := false
	defer func() {
		if recover() != nil {
			if admitted {
				initializeRegisteredN1Result(out)
			}
			result = C.int32_t(registeredN1Internal)
		}
	}()
	if code := checkSourceStatementV2Layout(req, out); code != registeredN1OK {
		return C.int32_t(code)
	}
	admitted = true
	initializeRegisteredN1Result(out)
	if req.version != 1 || req.struct_size != C.uint32_t(unsafe.Sizeof(*req)) || req.reserved != 0 {
		return C.int32_t(registeredN1Argument)
	}
	in := sourceStatementV2Inputs{body: copyRegisteredN1Public(req.body_original), frame: string(copyRegisteredN1Public(req.expected_frame)), role: ynxbatch.AuthSourceStatementV2Role(req.role), issuedHeight: uint64(req.issued_height),
		registration: registeredN1Inputs{member: copyRegisteredN1Public(req.member), network: copyRegisteredN1Public(req.network), owner: string(copyRegisteredN1Public(req.owner)), pkA: copyRegisteredN1Public(req.pk_a), pkB: copyRegisteredN1Public(req.pk_b),
			policyRevision: uint64(req.key_version), observedHeight: uint64(req.observed_height), activeFrom: uint64(req.active_from), revokedAt: uint64(req.revoked_at), enabled: uint32(req.enabled), hasRevokedAt: uint32(req.has_revoked_at)}}
	code := verifySourceStatementV2(in)
	if code == registeredN1OK {
		out.verified, out.member_count = 1, 1
	}
	return C.int32_t(code)
}
