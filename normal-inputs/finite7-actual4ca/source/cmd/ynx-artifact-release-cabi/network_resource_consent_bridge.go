package main

/*
#include "network_resource_consent.h"
*/
import "C"

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	consent "github.com/JiahaoAlbus/YNX-Chain/internal/ynxresourceconsent"
	"unsafe"
)

func resourceRange(s C.YNXNetworkResourceBytesV1) memoryRange {
	return memoryRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
}
func resourcePublic(s C.YNXNetworkResourceBytesV1) []byte {
	return C.GoBytes(unsafe.Pointer(s.bytes), C.int(s.length))
}
func resourceBorrow(s C.YNXNetworkResourceBytesV1) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
}
func resourceHasBuffer(action uint32) bool {
	return action == 3 || action == 4 || action == 5 || action == 8
}
func resourceCheck(req *C.YNXNetworkResourceConsentRequestV1, buffer *C.uint8_t, capacity C.size_t, out *C.YNXNetworkResourceConsentResultV1) resultCode {
	if req == nil || out == nil {
		return resultInvalidArgument
	}
	rr := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	or := memoryRange{uintptr(unsafe.Pointer(out)), unsafe.Sizeof(*out)}
	if !rr.valid() || !or.valid() || rr.start%unsafe.Alignof(*req) != 0 || or.start%unsafe.Alignof(*out) != 0 {
		return resultBounds
	}
	if req.abi_version != 1 || req.struct_size != C.size_t(unsafe.Sizeof(*req)) || req.action < 1 || req.action > 9 {
		return resultInvalidArgument
	}
	action := uint32(req.action)
	outputs := []memoryRange{or}
	if resourceHasBuffer(action) {
		if buffer == nil {
			return resultInvalidArgument
		}
		if capacity != resourceMemberCapacity {
			return resultCapacity
		}
		outputs = append(outputs, memoryRange{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)})
	} else if buffer != nil || capacity != 0 {
		return resultInvalidArgument
	}
	prepare := action == 1
	current := action >= 1 && action <= 4
	sign := action == 3
	if prepare && req.handle != 0 || !prepare && req.handle == 0 {
		return resultInvalidArgument
	}
	spans := []C.YNXNetworkResourceBytesV1{req.scope_original, req.input_original, req.expected.network_id, req.expected.owner, req.expected.key_epoch, req.expected.issued_height, req.expected.pk_a, req.expected.pk_b, req.current.subject_owner, req.current.policy_original, req.pk_a, req.pk_b}
	bounds := [][2]uintptr{{1, ynxbatch.MaxNetworkResourceScopeBytes}, {1, ynxbatch.MaxNetworkResourceInputBytes}, {32, 32}, {42, 42}, {1, 20}, {1, 20}, {2592, 2592}, {64, 64}, {42, 42}, {1, ynxauth.MaxWalletPolicyProjectionBytes}, {2592, 2592}, {64, 64}}
	public := []memoryRange{}
	for i, s := range spans {
		used := i < 8 && prepare || i >= 8 && i < 10 && current || i >= 10 && sign
		if !used {
			if s.bytes != nil || s.length != 0 {
				return resultInvalidArgument
			}
			continue
		}
		r := resourceRange(s)
		if r.length < bounds[i][0] || r.length > bounds[i][1] {
			return resultBounds
		}
		public = append(public, r)
	}
	if !current && (req.current.execution_height != 0 || req.current.now_millis != 0) {
		return resultInvalidArgument
	}
	private := []memoryRange{}
	for i, s := range []C.YNXNetworkResourceBytesV1{req.pkcs8_a, req.pkcs8_b} {
		if !sign {
			if s.bytes != nil || s.length != 0 {
				return resultInvalidArgument
			}
			continue
		}
		size := uintptr(ynxbatch.PKCS8ASize)
		if i == 1 {
			size = ynxbatch.PKCS8BSize
		}
		r := resourceRange(s)
		if r.length != size {
			return resultBounds
		}
		private = append(private, r)
	}
	if code := checkMigrationAuthorizationLayout(rr, public, private, outputs); code != resultOK {
		return code
	}
	for _, secret := range private {
		if overlaps(rr, secret) {
			return resultOverlap
		}
	}
	return resultOK
}
func resourceCurrent(req *C.YNXNetworkResourceConsentRequestV1) consent.CurrentDATA {
	return consent.CurrentDATA{SubjectOwner: string(resourcePublic(req.current.subject_owner)), PolicyOriginal: resourcePublic(req.current.policy_original), ExecutionHeight: uint64(req.current.execution_height), NowMillis: int64(req.current.now_millis)}
}
func resourceWrite(out *C.YNXNetworkResourceConsentResultV1, buffer *C.uint8_t, capacity C.size_t, id uint64, e *resourceEntry, v consent.MaterialOutcome, code resultCode) {
	out.status = C.uint32_t(code)
	out.handle = C.uint64_t(id)
	out.first_cause = C.uint32_t(resourceCode(v.FirstCause))
	out.cleanup_status = 1
	var flags uint32
	if v.AttemptSelected {
		flags |= 1
		out.cleanup_status = 0
		if v.KeyCleanupComplete {
			out.cleanup_status = 2
		} else if !v.Running {
			out.cleanup_status = 3
		}
	}
	if v.Running {
		flags |= 2
	}
	if v.SignatureVerified {
		flags |= 4
	}
	if v.BatchCleanupComplete {
		flags |= 8
	}
	if v.CurrentDataMatched {
		flags |= 16
	}
	if v.Retired {
		flags |= 32
	}
	if v.Closed {
		flags |= 64
	}
	if e != nil && e.attempt.Drain() && resourceAlone(e) {
		flags |= 128
	}
	if v.AttemptSelected && (!v.CurrentDataMatched || v.FirstCause != nil) {
		flags |= 256
	}
	out.flags = C.uint32_t(flags)
	if buffer != nil && len(v.MemberOriginal) > 0 {
		if len(v.MemberOriginal) > int(capacity) {
			out.status = C.uint32_t(resultInternal)
			return
		}
		copy(unsafe.Slice((*byte)(unsafe.Pointer(buffer)), int(capacity)), v.MemberOriginal)
		out.member_length = C.size_t(len(v.MemberOriginal))
	}
}

// resourcePanicOutcome is private public-operation bookkeeping, not a key or
// provider callback. The caller still owes exactly one resourceDone afterwards.
func resourcePanicOutcome(id uint64, e *resourceEntry) (consent.MaterialOutcome, bool) {
	if e == nil {
		return consent.MaterialOutcome{}, false
	}
	if e.attempt == nil {
		// PREPARE published only a reservation. Acquire refuses this state,
		// so its creator is the sole active owner before installation. Keep
		// the existing identity/active-debt guard when releasing public bytes.
		resourceRemove(id, e)
		return consent.MaterialOutcome{}, false
	}
	e.attempt.Retire()
	return e.attempt.OriginalOutcome(), true
}

//export YNXNetworkResourceConsentAttemptV1
func YNXNetworkResourceConsentAttemptV1(req *C.YNXNetworkResourceConsentRequestV1, buffer *C.uint8_t, capacity C.size_t, out *C.YNXNetworkResourceConsentResultV1) (result C.int32_t) {
	if code := resourceCheck(req, buffer, capacity, out); code != resultOK {
		return C.int32_t(code)
	}
	*out = C.YNXNetworkResourceConsentResultV1{abi_version: 1, struct_size: C.uint32_t(unsafe.Sizeof(*out)), cleanup_status: 1}
	var e *resourceEntry
	id := uint64(req.handle)
	defer func() {
		if recover() != nil {
			out.status = C.uint32_t(resultInternal)
			out.cleanup_status = 0
			result = C.int32_t(resultInternal)
			if original, retained := resourcePanicOutcome(id, e); retained {
				resourceWrite(out, buffer, capacity, id, e, original, resultInternal)
			}
		}
		if e != nil {
			resourceDone(e)
		}
	}()
	var code resultCode
	if req.action == 1 {
		id, e, code = resourceReserve(int(req.scope_original.length), int(req.input_original.length))
		if code != resultOK {
			out.status = C.uint32_t(code)
			return C.int32_t(code)
		}
		a, err := consent.PrepareMaterial(resourcePublic(req.scope_original), resourcePublic(req.input_original), ynxbatch.NetworkResourceConsentBinding{NetworkID: resourcePublic(req.expected.network_id), Owner: string(resourcePublic(req.expected.owner)), KeyEpoch: string(resourcePublic(req.expected.key_epoch)), IssuedHeight: string(resourcePublic(req.expected.issued_height)), PKA: resourcePublic(req.expected.pk_a), PKB: resourcePublic(req.expected.pk_b)}, resourceCurrent(req))
		if err != nil {
			resourceRemove(id, e)
			out.status = C.uint32_t(resultPublicBinding)
			if err == consent.ErrCurrent {
				out.status = C.uint32_t(resultOutputValidation)
			}
			return C.int32_t(out.status)
		}
		resourceInstall(e, a)
		resourceWrite(out, nil, 0, id, e, a.OriginalOutcome(), resultOK)
		return 0
	}
	e, code = resourceAcquire(id)
	if code != resultOK {
		out.status = C.uint32_t(code)
		return C.int32_t(code)
	}
	var err error
	var v consent.MaterialOutcome
	switch uint32(req.action) {
	case 2:
		err = e.attempt.Current(resourceCurrent(req))
		v = e.attempt.OriginalOutcome()
	case 3:
		v, err = e.attempt.SignOnce(ynxbatch.KeyMaterial{PKCS8A: resourceBorrow(req.pkcs8_a), PKCS8B: resourceBorrow(req.pkcs8_b), PKA: resourceBorrow(req.pk_a), PKB: resourceBorrow(req.pk_b)}, resourceCurrent(req))
	case 4:
		v, err = e.attempt.ConfirmCurrent(resourceCurrent(req))
	case 5:
		v = e.attempt.OriginalOutcome()
	case 6:
		e.attempt.Retire()
		v = e.attempt.OriginalOutcome()
	case 7:
		v = e.attempt.OriginalOutcome()
		if !e.attempt.Drain() || !resourceAlone(e) {
			code = resourcePending
		}
	case 8:
		done := e.attempt.Close()
		v = e.attempt.OriginalOutcome()
		if !done || !resourceAlone(e) {
			code = resourcePending
		}
	case 9:
		v = e.attempt.OriginalOutcome()
		if !v.Closed || !e.attempt.Drain() || !resourceRemove(id, e) {
			code = resourcePending
		} else {
			id = 0
		}
	}
	if err != nil {
		code = resourceCode(err)
	}
	resourceWrite(out, buffer, capacity, id, e, v, code)
	return C.int32_t(out.status)
}
