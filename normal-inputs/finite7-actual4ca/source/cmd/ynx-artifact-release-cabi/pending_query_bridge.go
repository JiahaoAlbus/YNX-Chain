package main

/*
#include "product_pair_pending_original_query.h"
*/
import "C"

import (
	"encoding/hex"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"unsafe"
)

func pendingQueryRange(s C.YNXPendingOriginalQueryBytesV1) memoryRange {
	return memoryRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
}
func pendingQueryCopy(s C.YNXPendingOriginalQueryBytesV1) []byte {
	return C.GoBytes(unsafe.Pointer(s.bytes), C.int(s.length))
}
func pendingQueryBorrow(s C.YNXPendingOriginalQueryBytesV1) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
}
func checkPendingQueryRequest(req *C.YNXPendingOriginalQueryRequestV1, buffer *C.uint8_t, capacity C.size_t, length *C.size_t, cleanup *C.uint32_t) resultCode {
	if req == nil || buffer == nil || length == nil || cleanup == nil {
		return resultInvalidArgument
	}
	r := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	if !r.valid() || r.start%unsafe.Alignof(*req) != 0 || uintptr(unsafe.Pointer(length))%unsafe.Alignof(*length) != 0 || uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return resultBounds
	}
	if req.abi_version != 1 || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	if capacity != pendingQueryCapacity {
		return resultCapacity
	}
	spans := []struct {
		s        C.YNXPendingOriginalQueryBytesV1
		min, max uintptr
	}{
		{req.query_original, 1, 1024}, {req.registration_original, 1, ynxbatch.MaxProductSessionDeviceV4MessageBytes}, {req.original_pair_post, 1, ynxbatch.MaxProductPairPendingOriginalBodyBytes},
		{req.expected.network_id, 32, 32}, {req.expected.owner, 42, 42}, {req.expected.pk_a, 2592, 2592}, {req.expected.pk_b, 64, 64}, {req.expected.actor_digest, 32, 32},
		{req.expected.service_origin, 1, 2048}, {req.expected.nonce, 32, 64}, {req.expected.issued_at, 24, 24}, {req.expected.expires_at, 24, 24}, {req.pk_a, 2592, 2592}, {req.pk_b, 64, 64},
	}
	public := make([]memoryRange, len(spans))
	for i, s := range spans {
		if uintptr(s.s.length) < s.min || uintptr(s.s.length) > s.max {
			return resultBounds
		}
		public[i] = pendingQueryRange(s.s)
	}
	if req.pkcs8_a.length != ynxbatch.PKCS8ASize || req.pkcs8_b.length != ynxbatch.PKCS8BSize {
		return resultBounds
	}
	return checkPendingQueryLayout(r, public, []memoryRange{pendingQueryRange(req.pkcs8_a), pendingQueryRange(req.pkcs8_b)}, []memoryRange{{uintptr(unsafe.Pointer(buffer)), uintptr(capacity)}, {uintptr(unsafe.Pointer(length)), unsafe.Sizeof(*length)}, {uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)}})
}

//export YNXProductPairPendingOriginalQuerySignV1
func YNXProductPairPendingOriginalQuerySignV1(req *C.YNXPendingOriginalQueryRequestV1, buffer *C.uint8_t, capacity C.size_t, length *C.size_t, cleanup *C.uint32_t) (rc C.int32_t) {
	if code := checkPendingQueryRequest(req, buffer, capacity, length, cleanup); code != resultOK {
		return C.int32_t(code)
	}
	*length = 0
	*cleanup = C.uint32_t(cleanupNotRequired)
	var member []byte
	defer func() {
		if recover() != nil {
			rc = C.int32_t(resultInternal)
			*cleanup = C.uint32_t(cleanupUnknown)
		}
		clear(member)
	}()
	e := req.expected
	in := pendingQueryInputs{query: pendingQueryCopy(req.query_original), registration: pendingQueryCopy(req.registration_original), originalPair: pendingQueryCopy(req.original_pair_post),
		expected: ynxbatch.ProductPairPendingOriginalQueryBinding{NetworkID: pendingQueryCopy(e.network_id), Owner: string(pendingQueryCopy(e.owner)), PKA: pendingQueryCopy(e.pk_a), PKB: pendingQueryCopy(e.pk_b), ActorDigest: hex.EncodeToString(pendingQueryCopy(e.actor_digest)), Origin: string(pendingQueryCopy(e.service_origin)), Nonce: string(pendingQueryCopy(e.nonce)), IssuedAt: string(pendingQueryCopy(e.issued_at)), ExpiresAt: string(pendingQueryCopy(e.expires_at)), AtMS: uint64(e.at_ms), SourceIssuedAtMS: uint64(e.source_issued_at_ms), SourceExpiresAtMS: uint64(e.source_expires_at_ms)}}
	plan, code := preparePendingQuery(in, uint64(capacity))
	if code != resultOK {
		return C.int32_t(code)
	}
	var clean cleanupCode
	member, code, clean = signPendingQueryPrepared(plan, ynxbatch.KeyMaterial{PKCS8A: pendingQueryBorrow(req.pkcs8_a), PKCS8B: pendingQueryBorrow(req.pkcs8_b), PKA: pendingQueryBorrow(req.pk_a), PKB: pendingQueryBorrow(req.pk_b)})
	written, final := retainDeviceHTTPOutcome(unsafe.Slice((*byte)(unsafe.Pointer(buffer)), int(capacity)), member, code, clean)
	*length = C.size_t(written)
	*cleanup = C.uint32_t(clean)
	return C.int32_t(final)
}
