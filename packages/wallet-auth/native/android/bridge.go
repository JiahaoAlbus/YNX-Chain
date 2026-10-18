//go:build cgo

package main

/*
#cgo darwin LDFLAGS: -Wl,-U,_ynx_original_wallet_android_transfer_assert_current -Wl,-U,_ynx_wallet_main_android_pq_store_new -Wl,-U,_ynx_wallet_main_android_pq_load_original
#define YNX_WALLET_PQ_CGO_IMPLEMENTATION 1
#include <stdlib.h>
#include <string.h>
#include "bridge-support.h"
*/
import "C"

import (
	"bytes"
	"errors"
	"runtime"
	"sync"
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// C-owned nonreused tokens contain no Go pointer, key, selector or authority.
// Tombstones remain allocated for process lifetime to prevent stale-pointer ABA.
// The lifetime bound refuses further acquisition rather than recycling a ref.
const bridgeLimit = 4096
const (
	bridgeOK          int32 = 0
	bridgeInvalid     int32 = -1
	bridgeCapacity    int32 = -2
	bridgeUnavailable int32 = -3
	bridgeOriginal    int32 = -4
	bridgePending     int32 = -5
	bridgeFailure     int32 = -6
	bridgeClosed      int32 = -7
)

type foreignFailure struct{ code int32 }

func (e *foreignFailure) Error() string { return "WALLET_ANDROID_PQ_ORIGINAL_NATIVE_FAILURE" }

type pairRef struct {
	owner  *pairOwner
	closed bool
	users  uint32
}
type operationRef struct {
	owner    *operationOwner
	closed   bool
	users    uint32
	authCode int32
}

var bridgeRegistry = struct {
	sync.Mutex
	pairs map[uintptr]*pairRef
	ops   map[uintptr]*operationRef
	total int
}{pairs: make(map[uintptr]*pairRef), ops: make(map[uintptr]*operationRef)}

func bridgeCode(e error) int32 {
	if e == nil {
		return bridgeOK
	}
	var original *foreignFailure
	if errors.As(e, &original) {
		if original.code == -7001 {
			return bridgeUnavailable
		}
		return bridgeOriginal
	}
	if errors.Is(e, errJoin) {
		return bridgePending
	}
	if errors.Is(e, errBinding) {
		return bridgeInvalid
	}
	if errors.Is(e, errAuth) {
		return bridgeUnavailable
	}
	return bridgeFailure
}
func errorOut(out *C.ynx_wallet_pq_error_v1, e error) C.int32_t {
	code := bridgeCode(e)
	if out != nil {
		out.code = C.int32_t(code)
		out.original_auth_code = 0
		var original *foreignFailure
		if errors.As(e, &original) {
			out.original_auth_code = C.int32_t(original.code)
		}
	}
	return C.int32_t(code)
}
func bridgeStatusOut(out *C.ynx_wallet_pq_error_v1, code int32) C.int32_t {
	if out != nil {
		out.code = C.int32_t(code)
		out.original_auth_code = 0
	}
	return C.int32_t(code)
}
func invalid(out *C.ynx_wallet_pq_error_v1) C.int32_t { return errorOut(out, errBinding) }
func allocToken() unsafe.Pointer {
	bridgeRegistry.Lock()
	defer bridgeRegistry.Unlock()
	if bridgeRegistry.total >= bridgeLimit {
		return nil
	}
	p := C.calloc(1, 1)
	if p != nil {
		bridgeRegistry.total++
	}
	return p
}
func retainPair(p *pairOwner) *C.ynx_wallet_pq_pair {
	ref := allocToken()
	if ref == nil {
		return nil
	}
	bridgeRegistry.Lock()
	bridgeRegistry.pairs[uintptr(ref)] = &pairRef{owner: p}
	bridgeRegistry.Unlock()
	return (*C.ynx_wallet_pq_pair)(ref)
}
func retainOperation(o *operationOwner) *C.ynx_wallet_pq_operation {
	ref := allocToken()
	if ref == nil {
		return nil
	}
	bridgeRegistry.Lock()
	bridgeRegistry.ops[uintptr(ref)] = &operationRef{owner: o}
	bridgeRegistry.Unlock()
	return (*C.ynx_wallet_pq_operation)(ref)
}
func borrowPair(ref *C.ynx_wallet_pq_pair) (*pairOwner, func(), bool) {
	bridgeRegistry.Lock()
	r := bridgeRegistry.pairs[uintptr(unsafe.Pointer(ref))]
	if r == nil || r.closed || r.owner == nil {
		bridgeRegistry.Unlock()
		return nil, nil, false
	}
	r.users++
	p := r.owner
	bridgeRegistry.Unlock()
	return p, func() { bridgeRegistry.Lock(); r.users--; bridgeRegistry.Unlock() }, true
}
func borrowOperation(ref *C.ynx_wallet_pq_operation) (*operationOwner, *operationRef, func(), bool) {
	bridgeRegistry.Lock()
	r := bridgeRegistry.ops[uintptr(unsafe.Pointer(ref))]
	if r == nil || r.closed || r.owner == nil {
		bridgeRegistry.Unlock()
		return nil, nil, nil, false
	}
	r.users++
	o := r.owner
	bridgeRegistry.Unlock()
	return o, r, func() { bridgeRegistry.Lock(); r.users--; bridgeRegistry.Unlock() }, true
}
func bindingFromC(raw *C.ynx_wallet_pq_binding_v1) (pairBinding, error) {
	var b pairBinding
	if raw == nil || raw.abi_version != C.YNX_WALLET_PQ_ANDROID_ABI {
		return b, errBinding
	}
	copy(b.NetworkHash[:], C.GoBytes(unsafe.Pointer(&raw.network_hash[0]), 32))
	b.NativeChainID = uint64(raw.native_chain_id)
	b.Owner = string(C.GoBytes(unsafe.Pointer(&raw.owner[0]), 42))
	b.PairVersion = uint64(raw.pair_version)
	if !validBinding(b) {
		return pairBinding{}, errBinding
	}
	return b, nil
}
func writeBinding(out *C.ynx_wallet_pq_binding_v1, b pairBinding) {
	out.abi_version = C.YNX_WALLET_PQ_ANDROID_ABI
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&out.network_hash[0])), 32), b.NetworkHash[:])
	out.native_chain_id = C.uint64_t(b.NativeChainID)
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&out.owner[0])), 42), b.Owner)
	out.pair_version = C.uint64_t(b.PairVersion)
}
func publicFromC(in *C.ynx_wallet_pq_public_v1) ynxbatch.PublicKey {
	return ynxbatch.PublicKey{PKA: C.GoBytes(unsafe.Pointer(&in.pk_a[0]), 2592), PKB: C.GoBytes(unsafe.Pointer(&in.pk_b[0]), 64)}
}
func writePublic(out *C.ynx_wallet_pq_public_v1, p ynxbatch.PublicKey) error {
	if len(p.PKA) != 2592 || len(p.PKB) != 64 {
		return errBinding
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&out.pk_a[0])), 2592), p.PKA)
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&out.pk_b[0])), 64), p.PKB)
	return nil
}
func newCMaterial() *C.ynx_wallet_pq_private_storage_material_v1 {
	return (*C.ynx_wallet_pq_private_storage_material_v1)(C.calloc(1, C.sizeof_ynx_wallet_pq_private_storage_material_v1))
}
func clearCMaterial(p *C.ynx_wallet_pq_private_storage_material_v1) {
	if p != nil {
		C.ynx_bridge_clear(unsafe.Pointer(p), C.sizeof_ynx_wallet_pq_private_storage_material_v1)
		C.free(unsafe.Pointer(p))
	}
}
func materialFromC(p *C.ynx_wallet_pq_private_storage_material_v1) ynxbatch.KeyMaterial {
	return ynxbatch.KeyMaterial{PKCS8A: C.GoBytes(unsafe.Pointer(&p.pkcs8_a[0]), 54), PKCS8B: C.GoBytes(unsafe.Pointer(&p.pkcs8_b[0]), 150), PKA: C.GoBytes(unsafe.Pointer(&p.public_pair.pk_a[0]), 2592), PKB: C.GoBytes(unsafe.Pointer(&p.public_pair.pk_b[0]), 64)}
}
func writeMaterial(p *C.ynx_wallet_pq_private_storage_material_v1, m ynxbatch.KeyMaterial) error {
	if len(m.PKCS8A) != 54 || len(m.PKCS8B) != 150 || len(m.PKA) != 2592 || len(m.PKB) != 64 {
		return errBinding
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&p.pkcs8_a[0])), 54), m.PKCS8A)
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&p.pkcs8_b[0])), 150), m.PKCS8B)
	return writePublic(&p.public_pair, ynxbatch.PublicKey{PKA: m.PKA, PKB: m.PKB})
}
func storageFailed(p *pairOwner, e error) {
	p.mu.Lock()
	p.storageReady = false
	p.storageCause = e
	p.mu.Unlock()
	p.retire()
	p.mu.Lock()
	if p.key == nil && p.busy == 0 {
		p.cleanupComplete = true
	}
	p.mu.Unlock()
}
func pairReady(p *pairOwner) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.storageReady && !p.retired && p.key != nil
}

//export ynx_wallet_android_pq_pair_create
func ynx_wallet_android_pq_pair_create(storage *C.ynx_wallet_main_android_pq_storage, raw *C.ynx_wallet_pq_binding_v1, out **C.ynx_wallet_pq_pair, errout *C.ynx_wallet_pq_error_v1) C.int32_t {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if out == nil {
		return invalid(errout)
	}
	*out = nil
	b, e := bindingFromC(raw)
	if e != nil {
		return errorOut(errout, e)
	}
	if storage == nil || C.ynx_bridge_storage_available() != 1 {
		return errorOut(errout, &foreignFailure{-7001})
	}
	p, e := newPair(b)
	if e != nil {
		return errorOut(errout, e)
	}
	ref := retainPair(p)
	if ref == nil {
		p.retire()
		return bridgeStatusOut(errout, bridgeCapacity)
	}
	*out = ref // retain partial BEFORE foreign storage entry
	_, epoch, e := p.capture()
	if e != nil {
		storageFailed(p, e)
		return errorOut(errout, e)
	}
	defer p.release()
	material, e := p.exportNewMaterialForStorage()
	defer material.Clear()
	if e != nil {
		storageFailed(p, e)
		return errorOut(errout, e)
	}
	cm := newCMaterial()
	if cm == nil {
		storageFailed(p, errBinding)
		return invalid(errout)
	}
	defer clearCMaterial(cm)
	if e = writeMaterial(cm, material); e != nil {
		storageFailed(p, e)
		return errorOut(errout, e)
	}
	cb := (*C.ynx_wallet_pq_binding_v1)(C.calloc(1, C.sizeof_ynx_wallet_pq_binding_v1))
	if cb == nil {
		storageFailed(p, errBinding)
		return invalid(errout)
	}
	defer C.free(unsafe.Pointer(cb))
	writeBinding(cb, b)
	code := int32(C.ynx_bridge_store_new(storage, cb, cm))
	if code != 0 {
		e = &foreignFailure{code}
		storageFailed(p, e)
		return errorOut(errout, e)
	}
	if e = p.current(epoch); e != nil {
		storageFailed(p, e)
		return errorOut(errout, e)
	}
	p.mu.Lock()
	if p.retired || p.key == nil {
		e = errRetired
	} else {
		p.storageReady = true
	}
	p.mu.Unlock()
	if e != nil {
		return errorOut(errout, e)
	}
	return errorOut(errout, nil)
}

//export ynx_wallet_android_pq_pair_restore
func ynx_wallet_android_pq_pair_restore(storage *C.ynx_wallet_main_android_pq_storage, raw *C.ynx_wallet_pq_binding_v1, expected *C.ynx_wallet_pq_public_v1, out **C.ynx_wallet_pq_pair, errout *C.ynx_wallet_pq_error_v1) C.int32_t {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if out == nil {
		return invalid(errout)
	}
	*out = nil
	b, e := bindingFromC(raw)
	if e != nil || expected == nil {
		return invalid(errout)
	}
	if storage == nil || C.ynx_bridge_storage_available() != 1 {
		return errorOut(errout, &foreignFailure{-7001})
	}
	expectedPublic := publicFromC(expected)
	// Restore retains a real empty partial before entering Main's original store.
	partial := &pairOwner{binding: b, epoch: 1}
	ref := retainPair(partial)
	if ref == nil {
		return bridgeStatusOut(errout, bridgeCapacity)
	}
	*out = ref
	cm := newCMaterial()
	if cm == nil {
		storageFailed(partial, errBinding)
		return invalid(errout)
	}
	defer clearCMaterial(cm)
	cb := (*C.ynx_wallet_pq_binding_v1)(C.calloc(1, C.sizeof_ynx_wallet_pq_binding_v1))
	if cb == nil {
		storageFailed(partial, errBinding)
		return invalid(errout)
	}
	defer C.free(unsafe.Pointer(cb))
	writeBinding(cb, b)
	code := int32(C.ynx_bridge_load_original(storage, cb, cm))
	if code != 0 {
		e = &foreignFailure{code}
		storageFailed(partial, e)
		return errorOut(errout, e)
	}
	material := materialFromC(cm)
	defer material.Clear()
	p, e := restorePair(b, material, expectedPublic)
	if e != nil {
		storageFailed(partial, e)
		return errorOut(errout, e)
	}
	bridgeRegistry.Lock()
	r := bridgeRegistry.pairs[uintptr(unsafe.Pointer(ref))]
	partial.mu.Lock()
	retired := partial.retired
	partial.mu.Unlock()
	if r.closed || r.users != 0 || retired {
		bridgeRegistry.Unlock()
		p.retire()
		storageFailed(partial, errRetired)
		return errorOut(errout, errRetired)
	}
	r.owner = p
	bridgeRegistry.Unlock()
	partial.retire()
	return errorOut(errout, nil)
}

//export ynx_wallet_android_pq_pair_public
func ynx_wallet_android_pq_pair_public(ref *C.ynx_wallet_pq_pair, out *C.ynx_wallet_pq_public_v1) C.int32_t {
	if out == nil {
		return C.int32_t(bridgeInvalid)
	}
	p, done, ok := borrowPair(ref)
	if !ok {
		return C.int32_t(bridgeInvalid)
	}
	defer done()
	if !pairReady(p) {
		return C.int32_t(bridgeUnavailable)
	}
	return C.int32_t(bridgeCode(writePublic(out, p.publicCopy())))
}

//export ynx_wallet_android_pq_pair_retire
func ynx_wallet_android_pq_pair_retire(ref *C.ynx_wallet_pq_pair) C.int32_t {
	p, done, ok := borrowPair(ref)
	if !ok {
		return C.int32_t(bridgeInvalid)
	}
	defer done()
	p.retire()
	return 0
}

//export ynx_wallet_android_pq_pair_join
func ynx_wallet_android_pq_pair_join(ref *C.ynx_wallet_pq_pair) C.int32_t {
	p, done, ok := borrowPair(ref)
	if !ok {
		return C.int32_t(bridgeInvalid)
	}
	defer done()
	return C.int32_t(bridgeCode(p.join()))
}

//export ynx_wallet_android_pq_pair_close
func ynx_wallet_android_pq_pair_close(ref *C.ynx_wallet_pq_pair) C.int32_t {
	bridgeRegistry.Lock()
	defer bridgeRegistry.Unlock()
	r := bridgeRegistry.pairs[uintptr(unsafe.Pointer(ref))]
	if r == nil || r.closed {
		return C.int32_t(bridgeClosed)
	}
	if r.users != 0 {
		return C.int32_t(bridgePending)
	}
	r.owner.retire()
	if e := r.owner.join(); e != nil {
		return C.int32_t(bridgeCode(e))
	}
	r.closed = true
	r.owner = nil
	return 0
}

func scopeFromC(raw *C.ynx_wallet_pq_transfer_scope_v1) (transferReview, ynxbatch.PublicKey, error) {
	var r transferReview
	if raw == nil || raw.abi_version != C.YNX_WALLET_PQ_ANDROID_ABI {
		return r, ynxbatch.PublicKey{}, errBinding
	}
	b, e := bindingFromC(&raw.binding)
	if e != nil {
		return r, ynxbatch.PublicKey{}, e
	}
	n := uint32(raw.signing_bytes_length)
	idlen := uint32(raw.request_id_bytes)
	if n == 0 || n > 1024 || idlen == 0 || idlen > 128 {
		return r, ynxbatch.PublicKey{}, errBinding
	}
	wire := C.GoBytes(unsafe.Pointer(&raw.signing_bytes[0]), C.int(n))
	t, e := ynxauth.DecodeTransfer(wire)
	if e != nil {
		return r, ynxbatch.PublicKey{}, e
	}
	if !bytes.Equal(t.ChainID, b.NetworkHash[:]) || t.NativeChainID != b.NativeChainID || t.From != b.Owner || t.Nonce != uint64(raw.transfer_nonce) {
		return r, ynxbatch.PublicKey{}, errBinding
	}
	r = transferReview{RequestID: string(C.GoBytes(unsafe.Pointer(&raw.request_id[0]), C.int(idlen))), PolicyRevision: uint64(raw.policy_revision), ExecutionHeight: uint64(raw.execution_height), PairVersion: b.PairVersion, Transfer: t}
	copy(r.ReviewDigest[:], C.GoBytes(unsafe.Pointer(&raw.review_digest[0]), 32))
	return r, publicFromC(&raw.public_pair), nil
}

//export ynx_wallet_android_pq_transfer_prepare
func ynx_wallet_android_pq_transfer_prepare(ref *C.ynx_wallet_pq_pair, raw *C.ynx_wallet_pq_transfer_scope_v1, out **C.ynx_wallet_pq_operation, errout *C.ynx_wallet_pq_error_v1) C.int32_t {
	if out == nil {
		return invalid(errout)
	}
	*out = nil
	p, done, ok := borrowPair(ref)
	if !ok {
		return invalid(errout)
	}
	defer done()
	if !pairReady(p) {
		return errorOut(errout, errRetired)
	}
	review, pub, e := scopeFromC(raw)
	if e != nil {
		return errorOut(errout, e)
	}
	actual := p.publicCopy()
	if !bytes.Equal(pub.PKA, actual.PKA) || !bytes.Equal(pub.PKB, actual.PKB) {
		return invalid(errout)
	}
	o, e := prepareTransfer(p, review)
	if e != nil {
		return errorOut(errout, e)
	}
	token := retainOperation(o)
	if token == nil {
		return bridgeStatusOut(errout, bridgeCapacity)
	}
	*out = token
	return errorOut(errout, nil)
}

type nativeAuthorization struct {
	ref    *C.ynx_original_wallet_android_transfer_authorization
	phase  uint32
	record *operationRef
	cscope *C.ynx_wallet_pq_transfer_scope_v1
}

func (a *nativeAuthorization) assertOriginalCurrent(s transferScope) error {
	a.phase++
	if a.phase > 2 {
		return errAuth
	}
	scope := a.cscope
	if scope == nil {
		return errAuth
	}
	scope.abi_version = C.YNX_WALLET_PQ_ANDROID_ABI
	writeBinding(&scope.binding, s.Binding)
	if e := writePublic(&scope.public_pair, s.Public); e != nil {
		return e
	}
	scope.policy_revision = C.uint64_t(s.PolicyRevision)
	scope.execution_height = C.uint64_t(s.ExecutionHeight)
	t, e := ynxauth.DecodeTransfer(s.SigningBytes)
	if e != nil {
		return e
	}
	scope.transfer_nonce = C.uint64_t(t.Nonce)
	if len(s.SigningBytes) > 1024 || len(s.RequestID) > 128 {
		return errBinding
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&scope.review_digest[0])), 32), s.ReviewDigest[:])
	scope.request_id_bytes = C.uint32_t(len(s.RequestID))
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&scope.request_id[0])), 128), s.RequestID)
	scope.signing_bytes_length = C.uint32_t(len(s.SigningBytes))
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&scope.signing_bytes[0])), 1024), s.SigningBytes)
	code := int32(C.ynx_bridge_auth_current(a.ref, scope, C.uint32_t(a.phase)))
	if code != 0 {
		bridgeRegistry.Lock()
		if a.record.authCode == 0 {
			a.record.authCode = code
		}
		bridgeRegistry.Unlock()
		return &foreignFailure{code}
	}
	return nil
}

//export ynx_wallet_android_pq_transfer_sign_once
func ynx_wallet_android_pq_transfer_sign_once(ref *C.ynx_wallet_pq_operation, authorization *C.ynx_original_wallet_android_transfer_authorization, errout *C.ynx_wallet_pq_error_v1) C.int32_t {
	o, r, done, ok := borrowOperation(ref)
	if !ok {
		return invalid(errout)
	}
	defer done()
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	scope := (*C.ynx_wallet_pq_transfer_scope_v1)(C.calloc(1, C.sizeof_ynx_wallet_pq_transfer_scope_v1))
	if scope != nil {
		defer C.free(unsafe.Pointer(scope))
	}
	return errorOut(errout, o.sign(&nativeAuthorization{ref: authorization, record: r, cscope: scope}))
}

//export ynx_wallet_android_pq_transfer_cancel
func ynx_wallet_android_pq_transfer_cancel(ref *C.ynx_wallet_pq_operation) C.int32_t {
	o, _, done, ok := borrowOperation(ref)
	if !ok {
		return C.int32_t(bridgeInvalid)
	}
	defer done()
	o.cancel()
	return 0
}

//export ynx_wallet_android_pq_transfer_copy_result_data
func ynx_wallet_android_pq_transfer_copy_result_data(ref *C.ynx_wallet_pq_operation, out *C.uint8_t, capacity C.size_t, written *C.size_t) C.int32_t {
	if written == nil {
		return C.int32_t(bridgeInvalid)
	}
	*written = 0
	o, _, done, ok := borrowOperation(ref)
	if !ok {
		return C.int32_t(bridgeInvalid)
	}
	defer done()
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.busy {
		return C.int32_t(bridgePending)
	}
	if len(o.result) == 0 {
		return C.int32_t(bridgeUnavailable)
	}
	*written = C.size_t(len(o.result))
	if out == nil || uint64(capacity) < uint64(len(o.result)) {
		return C.int32_t(bridgeCapacity)
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(out)), len(o.result)), o.result)
	o.resultCaptured = true
	return 0
}

//export ynx_wallet_android_pq_transfer_close
func ynx_wallet_android_pq_transfer_close(ref *C.ynx_wallet_pq_operation) C.int32_t {
	bridgeRegistry.Lock()
	defer bridgeRegistry.Unlock()
	r := bridgeRegistry.ops[uintptr(unsafe.Pointer(ref))]
	if r == nil || r.closed {
		return C.int32_t(bridgeClosed)
	}
	if r.users != 0 {
		return C.int32_t(bridgePending)
	}
	if e := r.owner.close(); e != nil {
		return C.int32_t(bridgeCode(e))
	}
	r.closed = true
	r.owner = nil
	return 0
}

//export ynx_wallet_android_pq_pair_status
func ynx_wallet_android_pq_pair_status(ref *C.ynx_wallet_pq_pair, out *C.ynx_wallet_pq_pair_status_v1) C.int32_t {
	if out == nil {
		return C.int32_t(bridgeInvalid)
	}
	p, done, ok := borrowPair(ref)
	if !ok {
		return C.int32_t(bridgeInvalid)
	}
	defer done()
	p.mu.Lock()
	defer p.mu.Unlock()
	*out = C.ynx_wallet_pq_pair_status_v1{}
	out.abi_version = C.YNX_WALLET_PQ_ANDROID_ABI
	if p.storageReady && !p.retired && p.key != nil {
		out.ready = 1
	}
	if p.retired {
		out.retired = 1
	}
	out.busy = C.uint32_t(p.busy)
	if p.cleanupComplete {
		out.cleanup_complete = 1
	}
	out.storage_code = C.int32_t(bridgeCode(p.storageCause))
	return 0
}

//export ynx_wallet_android_pq_transfer_status
func ynx_wallet_android_pq_transfer_status(ref *C.ynx_wallet_pq_operation, out *C.ynx_wallet_pq_operation_status_v1) C.int32_t {
	if out == nil {
		return C.int32_t(bridgeInvalid)
	}
	o, r, done, ok := borrowOperation(ref)
	if !ok {
		return C.int32_t(bridgeInvalid)
	}
	defer done()
	s := o.status()
	*out = C.ynx_wallet_pq_operation_status_v1{}
	out.abi_version = C.YNX_WALLET_PQ_ANDROID_ABI
	flag := func(v bool) C.uint32_t {
		if v {
			return 1
		}
		return 0
	}
	out.entered = flag(s.Entered)
	out.busy = flag(s.Busy)
	out.cancelled = flag(s.Cancelled)
	out.result_retained = flag(s.ResultRetained)
	out.result_captured = flag(s.ResultCaptured)
	out.signing_complete = flag(s.SigningComplete)
	out.unknown = flag(s.Unknown)
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&out.result_digest[0])), 32), s.ResultDigest[:])
	out.first_code = C.int32_t(bridgeCode(s.First))
	out.cleanup_code = C.int32_t(bridgeCode(s.CleanupCause))
	bridgeRegistry.Lock()
	out.original_auth_code = C.int32_t(r.authCode)
	bridgeRegistry.Unlock()
	return 0
}
