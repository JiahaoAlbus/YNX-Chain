//go:build securelink_product_pay_transport && cgo && (linux || darwin)

package securelink

/*
#include <stdlib.h>
#include "product_pay_transport_private.h"
#include "../../cmd/ynx-secure-link-caller/private_client_v1.h"
int32_t ynx_product_link_write_current(void *);
int32_t ynx_product_link_packet_fault(void);
*/
import "C"

import (
	"context"
	"encoding/json"
	"errors"
	"runtime/cgo"
	"strings"
	"time"
	"unicode/utf8"
	"unsafe"
)

func productPrivateSpan(s C.ynx_product_pay_bytes_v1, maximum uint64, text bool) ([]byte, error) {
	if uint64(s.bytes) > maximum || s.bytes != 0 && s.data == nil {
		return nil, ErrBounds
	}
	var out []byte
	if s.bytes != 0 {
		out = C.GoBytes(unsafe.Pointer(s.data), C.int(s.bytes))
	}
	if text && (!utf8.Valid(out) || strings.ContainsAny(string(out), "\x00\r\n")) {
		return nil, ErrDenied
	}
	return out, nil
}

func productPrivateDecodeProfile(v *C.ynx_product_pay_profile_v1) (p productPrivateProfile, err error) {
	if v == nil || v.version != 1 || uintptr(v.size) != unsafe.Sizeof(*v) {
		return p, ErrDenied
	}
	inputs := []struct {
		span C.ynx_product_pay_bytes_v1
		max  uint64
		dst  *string
	}{
		{v.resource_ref, 4096, &p.resource}, {v.network_id, 128, &p.network}, {v.account, 128, &p.account}, {v.epoch, 64, &p.epoch}, {v.origin, 2048, &p.origin}, {v.socket, 103, &p.cfg.SocketPath}, {v.service, 128, &p.cfg.Service},
	}
	for _, input := range inputs {
		b, e := productPrivateSpan(input.span, input.max, true)
		if e != nil {
			return p, e
		}
		if len(b) == 0 {
			return p, ErrDenied
		}
		*input.dst = string(b)
	}
	if v.timeout_ms == 0 || v.timeout_ms > 30000 || v.max_header_bytes == 0 || v.max_header_bytes > 65536 || v.max_response_bytes == 0 || v.max_response_bytes > 1<<20 {
		return p, ErrBounds
	}
	p.cfg.PeerUID = uint32(v.peer_uid)
	p.cfg.PeerPID = int(v.peer_pid)
	p.cfg.Timeout = time.Duration(v.timeout_ms) * time.Millisecond
	p.cfg.MaxHeaderBytes = int(v.max_header_bytes)
	p.cfg.MaxResponseBytes = int64(v.max_response_bytes)
	p.enabled = uint32(v.enabled_operations)
	return p, nil
}

//export goYNXProductClientOpen
func goYNXProductClientOpen(profile *C.ynx_product_pay_profile_v1, out *C.uintptr_t) C.int32_t {
	if out == nil {
		return 1
	}
	*out = 0
	p, err := productPrivateDecodeProfile(profile)
	if err != nil {
		return C.int32_t(productPrivateErrorCode(err))
	}
	owner, err := newProductPrivateClient(context.Background(), p)
	if owner != nil {
		*out = C.uintptr_t(cgo.NewHandle(owner))
	}
	return C.int32_t(productPrivateErrorCode(err))
}

//export goYNXProductClientRequest
func goYNXProductClientRequest(id C.uintptr_t, request *C.ynx_product_pay_request_v1, guard unsafe.Pointer, responseOwner unsafe.Pointer, fallback *C.ynx_link_private_client_packet_v1, out **C.ynx_link_private_client_packet_v1, complete *C.uint32_t) C.int32_t {
	if out == nil || complete == nil {
		return 1
	}
	*out = nil
	*complete = 0
	owner, ok := nativeCallerValue[*productPrivateClient](id)
	if !ok || request == nil {
		return 1
	}
	var req productPrivateRequest
	var err error
	if request.version != 1 || uintptr(request.size) != unsafe.Sizeof(*request) {
		err = ErrDenied
	} else {
		req.operation = uint32(request.operation)
		var b []byte
		b, err = productPrivateSpan(request.method, 8, true)
		req.method = string(b)
		if err == nil {
			b, err = productPrivateSpan(request.path, 4096, true)
			req.path = string(b)
		}
		if err == nil {
			b, err = productPrivateSpan(request.content_type, 64, true)
			req.contentType = string(b)
		}
		if err == nil {
			req.body, err = productPrivateSpan(request.body, 1<<20, false)
		}
	}
	var response LocalCallerResponse
	if err == nil {
		response, err = owner.request(req, func() error {
			rc := C.ynx_product_link_write_current(guard)
			if rc != 0 {
				return productPrivateNativeError{code: int32(rc)}
			}
			return nil
		})
	}
	owner.remember(err)
	if response.BodyComplete {
		*complete = 1
	}
	// Keep the actual received bytes in Go custody before any C allocation. The
	// already minted response owner is the ONLY release path, including OOM.
	owner.mu.Lock()
	owner.pending[uintptr(responseOwner)] = response
	owner.mu.Unlock()
	if fallback != nil {
		if response.PacketPresent {
			fallback.packet_present = 1
			fallback.status_code = C.int32_t(response.StatusCode)
			fallback.dispatch_possible = 1
		}
		var dispatch *DispatchError
		if errors.As(err, &dispatch) {
			if dispatch.DispatchPossible {
				fallback.dispatch_possible = 1
			}
			fallback.partial_response_bytes = C.uint64_t(dispatch.PartialResponseBytes)
		}
		if response.PacketPresent && fallback.partial_response_bytes == 0 {
			fallback.partial_response_bytes = C.uint64_t(len(response.Body))
		}
	}
	packet := productPrivatePacket(response, err)
	if packet == nil {
		if err != nil {
			return C.int32_t(productPrivateErrorCode(err))
		}
		owner.remember(ErrUnavailable)
		return 3
	}
	packet.error_code = C.int32_t(productPrivateErrorCode(err))
	var native productPrivateNativeError
	if errors.As(err, &native) {
		packet.native_current_code = C.int32_t(native.code)
	}
	*out = packet
	return packet.error_code
}

func productPrivatePacket(response LocalCallerResponse, err error) (out *C.ynx_link_private_client_packet_v1) {
	if C.ynx_product_link_packet_fault() != 0 {
		return nil
	}
	p := (*C.ynx_link_private_client_packet_v1)(C.calloc(1, C.size_t(unsafe.Sizeof(C.ynx_link_private_client_packet_v1{}))))
	if p == nil {
		return nil
	}
	defer func() {
		if out == nil {
			C.ynx_link_private_client_packet_free_v1(p)
		}
	}()
	set := func(data []byte, dst **C.uint8_t, size *C.size_t) bool {
		if len(data) == 0 {
			return true
		}
		ptr := C.CBytes(data)
		if ptr == nil {
			return false
		}
		*dst = (*C.uint8_t)(ptr)
		*size = C.size_t(len(data))
		return true
	}
	if response.PacketPresent {
		p.packet_present = 1
		p.status_code = C.int32_t(response.StatusCode)
		headers, e := json.Marshal(response.Header)
		if e != nil {
			return nil
		}
		if !set([]byte(response.Method), &p.method, &p.method_size) || !set([]byte(response.RequestPath), &p.request_path, &p.request_path_size) || !set(headers, &p.header_json, &p.header_json_size) || !set([]byte(response.Header.Get("Content-Type")), &p.content_type, &p.content_type_size) || !set([]byte(response.Header.Get("Cache-Control")), &p.cache_control, &p.cache_control_size) || !set(response.Body, &p.body, &p.body_size) {
			return nil
		}
	}
	var dispatch *DispatchError
	if errors.As(err, &dispatch) {
		if dispatch.DispatchPossible {
			p.dispatch_possible = 1
		}
		p.partial_response_bytes = C.uint64_t(dispatch.PartialResponseBytes)
	}
	return p
}

//export goYNXProductClientReleaseResponse
func goYNXProductClientReleaseResponse(id C.uintptr_t, responseOwner unsafe.Pointer) C.int32_t {
	p, ok := nativeCallerValue[*productPrivateClient](id)
	if !ok {
		return 1
	}
	p.mu.Lock()
	delete(p.pending, uintptr(responseOwner))
	p.mu.Unlock()
	return 0
}

//export goYNXProductClientRetire
func goYNXProductClientRetire(id C.uintptr_t) C.int32_t {
	p, ok := nativeCallerValue[*productPrivateClient](id)
	if !ok {
		return 1
	}
	p.retire()
	return 0
}

//export goYNXProductClientDrain
func goYNXProductClientDrain(id C.uintptr_t, completed *C.uint32_t) C.int32_t {
	if completed == nil {
		return 1
	}
	*completed = 0
	p, ok := nativeCallerValue[*productPrivateClient](id)
	if !ok {
		return 1
	}
	done, err := p.drain()
	if done {
		*completed = 1
	}
	return C.int32_t(productPrivateErrorCode(err))
}

//export goYNXProductClientDispose
func goYNXProductClientDispose(id C.uintptr_t) C.int32_t {
	p, ok := nativeCallerValue[*productPrivateClient](id)
	if !ok {
		return 1
	}
	done, _ := p.drain()
	if !done {
		return 5
	}
	cgo.Handle(id).Delete()
	return 0
}
