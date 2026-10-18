//go:build cgo && ynx_bridge_test

// Explicit PUBLIC test controls only. No fixed Auth/storage symbol is supplied
// or made successful, and this file is absent from production builds.
package main

/*
#include <stdlib.h>
#include "bridge-support.h"
*/
import "C"

import (
	"bytes"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"unsafe"
)

type publicBridgeControls struct {
	pair  *C.ynx_wallet_pq_pair
	op    *C.ynx_wallet_pq_operation
	owner *pairOwner
}

func publicBinding() pairBinding {
	return pairBinding{NetworkHash: [32]byte{1}, NativeChainID: 6423, Owner: "0x1234567890abcdef1234567890abcdef12345678", PairVersion: 1}
}
func publicMissingStorage(restore bool) (code int32, partial bool, original int32) {
	b := (*C.ynx_wallet_pq_binding_v1)(C.calloc(1, C.sizeof_ynx_wallet_pq_binding_v1))
	defer C.free(unsafe.Pointer(b))
	writeBinding(b, publicBinding())
	out := (**C.ynx_wallet_pq_pair)(C.calloc(1, C.size_t(unsafe.Sizeof(uintptr(0)))))
	defer C.free(unsafe.Pointer(out))
	e := (*C.ynx_wallet_pq_error_v1)(C.calloc(1, C.sizeof_ynx_wallet_pq_error_v1))
	defer C.free(unsafe.Pointer(e))
	storage := (*C.ynx_wallet_main_android_pq_storage)(C.calloc(1, 1))
	defer C.free(unsafe.Pointer(storage))
	if restore {
		expected := (*C.ynx_wallet_pq_public_v1)(C.calloc(1, C.sizeof_ynx_wallet_pq_public_v1))
		defer C.free(unsafe.Pointer(expected))
		code = int32(C.ynx_wallet_android_pq_pair_restore(storage, b, expected, out, e))
	} else {
		code = int32(C.ynx_wallet_android_pq_pair_create(storage, b, out, e))
	}
	return code, *out != nil, int32(e.original_auth_code)
}
func publicCapturedPair(ready bool) (*publicBridgeControls, error) {
	p, e := newPair(publicBinding())
	if e != nil {
		return nil, e
	}
	p.mu.Lock()
	p.storageReady = ready
	p.mu.Unlock()
	return &publicBridgeControls{pair: retainPair(p), owner: p}, nil
}
func (c *publicBridgeControls) prepare() (int32, error) {
	b := c.owner.binding
	t := ynxauth.Transfer{ChainID: bytes.Clone(b.NetworkHash[:]), NativeChainID: b.NativeChainID, From: b.Owner, To: "0xabcdef1234567890abcdef1234567890abcdef12", Amount: 1, Nonce: 1, Fee: 1}
	wire, e := t.SigningBytes()
	if e != nil {
		return 0, e
	}
	raw := (*C.ynx_wallet_pq_transfer_scope_v1)(C.calloc(1, C.sizeof_ynx_wallet_pq_transfer_scope_v1))
	defer C.free(unsafe.Pointer(raw))
	raw.abi_version = 1
	writeBinding(&raw.binding, b)
	if e = writePublic(&raw.public_pair, c.owner.publicCopy()); e != nil {
		return 0, e
	}
	raw.policy_revision = 1
	raw.execution_height = 20
	raw.transfer_nonce = 1
	raw.request_id_bytes = 6
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&raw.request_id[0])), 128), "PUBLIC")
	raw.signing_bytes_length = C.uint32_t(len(wire))
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&raw.signing_bytes[0])), 1024), wire)
	out := (**C.ynx_wallet_pq_operation)(C.calloc(1, C.size_t(unsafe.Sizeof(uintptr(0)))))
	defer C.free(unsafe.Pointer(out))
	code := int32(C.ynx_wallet_android_pq_transfer_prepare(c.pair, raw, out, nil))
	c.op = *out
	return code, nil
}
func (c *publicBridgeControls) signMissingAuth() (int32, int32) {
	ref := (*C.ynx_original_wallet_android_transfer_authorization)(C.calloc(1, 1))
	defer C.free(unsafe.Pointer(ref))
	e := (*C.ynx_wallet_pq_error_v1)(C.calloc(1, C.sizeof_ynx_wallet_pq_error_v1))
	defer C.free(unsafe.Pointer(e))
	code := int32(C.ynx_wallet_android_pq_transfer_sign_once(c.op, ref, e))
	return code, int32(e.original_auth_code)
}
func (c *publicBridgeControls) pairLifecycle() (int32, int32, int32) {
	return int32(C.ynx_wallet_android_pq_pair_retire(c.pair)), int32(C.ynx_wallet_android_pq_pair_join(c.pair)), int32(C.ynx_wallet_android_pq_pair_close(c.pair))
}
func (c *publicBridgeControls) closeOp() int32 {
	return int32(C.ynx_wallet_android_pq_transfer_close(c.op))
}
func (c *publicBridgeControls) publicBytes() (int32, []byte) {
	p := (*C.ynx_wallet_pq_public_v1)(C.calloc(1, C.sizeof_ynx_wallet_pq_public_v1))
	defer C.free(unsafe.Pointer(p))
	code := int32(C.ynx_wallet_android_pq_pair_public(c.pair, p))
	return code, C.GoBytes(unsafe.Pointer(p), C.int(C.sizeof_ynx_wallet_pq_public_v1))
}
func (c *publicBridgeControls) opStatus() (int32, bool, bool, bool, int32) {
	s := (*C.ynx_wallet_pq_operation_status_v1)(C.calloc(1, C.sizeof_ynx_wallet_pq_operation_status_v1))
	defer C.free(unsafe.Pointer(s))
	code := int32(C.ynx_wallet_android_pq_transfer_status(c.op, s))
	return code, s.entered != 0, s.signing_complete != 0, s.result_captured != 0, int32(s.original_auth_code)
}
func publicForeignRefs() (int32, int32) {
	p := C.calloc(1, 1)
	defer C.free(p)
	return int32(C.ynx_wallet_android_pq_pair_retire((*C.ynx_wallet_pq_pair)(p))), int32(C.ynx_wallet_android_pq_transfer_cancel((*C.ynx_wallet_pq_operation)(p)))
}
func (c *publicBridgeControls) injectPublicJournalData() {
	o, _, done, ok := borrowOperation(c.op)
	if !ok {
		panic("PUBLIC fixture missing owner")
	}
	defer done()
	o.mu.Lock()
	o.result = []byte("PUBLIC_NOT_A_SIGNATURE")
	o.mu.Unlock()
}
func (c *publicBridgeControls) copyData(capacity int) (int32, int, []byte) {
	var out *C.uint8_t
	if capacity > 0 {
		out = (*C.uint8_t)(C.calloc(1, C.size_t(capacity)))
		defer C.free(unsafe.Pointer(out))
	}
	written := (*C.size_t)(C.calloc(1, C.size_t(unsafe.Sizeof(uintptr(0)))))
	defer C.free(unsafe.Pointer(written))
	code := int32(C.ynx_wallet_android_pq_transfer_copy_result_data(c.op, out, C.size_t(capacity), written))
	var data []byte
	if code == 0 {
		data = C.GoBytes(unsafe.Pointer(out), C.int(*written))
	}
	return code, int(*written), data
}
func (c *publicBridgeControls) storageFailure() { storageFailed(c.owner, &foreignFailure{-7001}) }
