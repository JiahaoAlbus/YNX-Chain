//go:build securelink_product_pay_transport && securelink_product_pay_transport_fixture && cgo && (linux || darwin)

package securelink

/*
#cgo CFLAGS: -I${SRCDIR}/testdata/product-transport-contract-r2 -DYNX_PRODUCT_TRANSPORT_FIXTURE=1
#include <stdlib.h>
#include "product_pay_transport_private.h"
ynx_product_pay_source_loan_v1 *ynx_product_fixture_new(ynx_product_pay_profile_v1*);
void ynx_product_fixture_set(ynx_product_pay_source_loan_v1*,int,int,int,int);
void ynx_product_fixture_counts(ynx_product_pay_source_loan_v1*,int*,int*,int*,int*,int*);
int32_t ynx_product_fixture_destroy(ynx_product_pay_source_loan_v1*);
void ynx_product_fixture_prepare(ynx_product_pay_request_v1*,ynx_product_pay_source_loan_v1*);
void ynx_product_fixture_release_busy(ynx_product_pay_source_loan_v1*);
void ynx_product_fixture_transport_fault(int);
uintptr_t ynx_product_fixture_transport_go(ynx_product_pay_transport_v1*);
*/
import "C"

import (
	"bytes"
	"unsafe"
)

// Test-only wrappers call the exact production C ABI and Go/Unix transport.
// The PUBLIC fixture loan is deliberately NOT the actual Auth source producer.
type productFixture struct {
	loan      *C.ynx_product_pay_source_loan_v1
	transport *C.ynx_product_pay_transport_v1
}
type productFixtureResponse struct {
	value *C.ynx_product_pay_response_v1
}

func (r *productFixtureResponse) hasOwner() bool {
	return r != nil && r.value != nil && r.value.response_owner != nil
}

type productFixturePacket struct {
	method, path, contentType        string
	body, headers                    []byte
	status                           uint32
	first, native                    int32
	errorPresent, complete, dispatch bool
	partial                          uint64
}

func productFixtureFault(code int)         { C.ynx_product_fixture_transport_fault(C.int(code)) }
func (f *productFixture) releaseBusyOnce() { C.ynx_product_fixture_release_busy(f.loan) }
func (f *productFixture) pendingBody() []byte {
	p, ok := nativeCallerValue[*productPrivateClient](C.ynx_product_fixture_transport_go(f.transport))
	if !ok {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, response := range p.pending {
		return bytes.Clone(response.Body)
	}
	return nil
}

func productFixtureSpan(data []byte) (C.ynx_product_pay_bytes_v1, func()) {
	if len(data) == 0 {
		return C.ynx_product_pay_bytes_v1{}, func() {}
	}
	p := C.CBytes(data)
	return C.ynx_product_pay_bytes_v1{data: (*C.uchar)(p), bytes: C.size_t(len(data))}, func() { C.free(p) }
}

func newProductFixture(cfg LocalCallerClientConfig, mask uint32, fullAt, fullCode, nativeCode, requestCode int) (*productFixture, int32) {
	profile := C.ynx_product_pay_profile_v1{version: 1, size: C.uint32_t(unsafe.Sizeof(C.ynx_product_pay_profile_v1{})), peer_uid: C.uint32_t(cfg.PeerUID), peer_pid: C.int32_t(cfg.PeerPID), timeout_ms: C.uint64_t(cfg.Timeout.Milliseconds()), max_header_bytes: C.uint64_t(cfg.MaxHeaderBytes), max_response_bytes: C.uint64_t(cfg.MaxResponseBytes), enabled_operations: C.uint32_t(mask)}
	for _, row := range []struct {
		dst  *C.ynx_product_pay_bytes_v1
		text string
	}{{&profile.resource_ref, "PUBLIC-resource"}, {&profile.network_id, "PUBLIC-network"}, {&profile.account, "PUBLIC-account"}, {&profile.epoch, "1"}, {&profile.origin, "https://PUBLIC.invalid"}, {&profile.socket, cfg.SocketPath}, {&profile.service, cfg.Service}} {
		span, free := productFixtureSpan([]byte(row.text))
		*row.dst = span
		defer free()
	}
	f := &productFixture{loan: C.ynx_product_fixture_new(&profile)}
	if f.loan == nil {
		return f, 3
	}
	C.ynx_product_fixture_set(f.loan, C.int(fullAt), C.int(fullCode), C.int(nativeCode), C.int(requestCode))
	rc := C.ynx_product_pay_transport_open_v1(f.loan, &f.transport)
	return f, int32(rc)
}

func (f *productFixture) request(req productPrivateRequest) (*productFixtureResponse, int32) {
	r := C.ynx_product_pay_request_v1{version: 1, size: C.uint32_t(unsafe.Sizeof(C.ynx_product_pay_request_v1{})), operation: C.uint32_t(req.operation)}
	for _, row := range []struct {
		dst  *C.ynx_product_pay_bytes_v1
		data []byte
	}{{&r.method, []byte(req.method)}, {&r.path, []byte(req.path)}, {&r.content_type, []byte(req.contentType)}, {&r.body, req.body}} {
		span, free := productFixtureSpan(row.data)
		*row.dst = span
		defer free()
	}
	C.ynx_product_fixture_prepare(&r, f.loan)
	response := &productFixtureResponse{value: (*C.ynx_product_pay_response_v1)(C.calloc(1, C.size_t(unsafe.Sizeof(C.ynx_product_pay_response_v1{}))))}
	if response.value == nil {
		return response, 3
	}
	rc := C.ynx_product_pay_transport_request_v1(f.transport, &r, response.value)
	return response, int32(rc)
}
func (r *productFixtureResponse) packet() (productFixturePacket, int32) {
	if r == nil || r.value == nil {
		return productFixturePacket{}, 1
	}
	d := C.ynx_product_pay_response_diagnostics_v1{}
	rc := C.ynx_product_pay_transport_response_diagnostics_v1(r.value, &d)
	copy := func(span C.ynx_product_pay_bytes_v1) []byte {
		if span.bytes == 0 {
			return nil
		}
		return C.GoBytes(unsafe.Pointer(span.data), C.int(span.bytes))
	}
	return productFixturePacket{method: string(copy(r.value.method)), path: string(copy(r.value.request_path)), contentType: string(copy(r.value.content_type)), body: copy(r.value.body), headers: copy(d.headers_original), status: uint32(r.value.status), first: int32(d.first_code), native: int32(d.native_current_code), errorPresent: d.error_present != 0, complete: d.response_complete != 0, dispatch: d.dispatch_possible != 0, partial: uint64(d.partial_response_bytes)}, int32(rc)
}
func (r *productFixtureResponse) release() {
	if r != nil && r.value != nil {
		C.ynx_product_pay_transport_release_response_v1(r.value)
		C.ynx_product_pay_transport_release_response_v1(r.value)
		C.free(unsafe.Pointer(r.value))
		r.value = nil
	}
}
func (f *productFixture) retire() int32 {
	return int32(C.ynx_product_pay_transport_retire_v1(f.transport))
}
func (f *productFixture) cancel() int32 {
	return int32(C.ynx_product_pay_transport_cancel_v1(f.transport))
}
func (f *productFixture) join() (int32, bool) {
	var completed C.uint32_t
	rc := C.ynx_product_pay_transport_join_v1(f.transport, &completed)
	return int32(rc), completed != 0
}
func (f *productFixture) close() (int32, bool) {
	var completed C.uint32_t
	rc := C.ynx_product_pay_transport_close_v1(f.transport, &completed)
	return int32(rc), completed != 0
}
func (f *productFixture) counts() (int, int, int, int, int) {
	var refs, releases, full, native, request C.int
	C.ynx_product_fixture_counts(f.loan, &refs, &releases, &full, &native, &request)
	return int(refs), int(releases), int(full), int(native), int(request)
}
func (f *productFixture) destroy() int32 {
	if f.loan == nil {
		return 0
	}
	rc := C.ynx_product_fixture_destroy(f.loan)
	if rc == 0 {
		f.loan = nil
	}
	return int32(rc)
}
