//go:build cgo && (linux || darwin)

package securelink

/*
#include <stdlib.h>
#include "../../cmd/ynx-secure-link-caller/private_client_v1.h"
ynx_link_private_client_registration_v1 *ynx_link_owner_register(uintptr_t);
void ynx_link_owner_retire(ynx_link_private_client_registration_v1 *);
int32_t ynx_link_owner_free(ynx_link_private_client_registration_v1 *);
void ynx_link_owner_holder_retire(void *);
int32_t ynx_link_owner_current(void *);
int32_t ynx_link_owner_native_code(void *);
void *ynx_link_owner_borrow(ynx_link_private_client_registration_v1 *);
uint32_t ynx_link_owner_borrows(ynx_link_private_client_registration_v1 *);
int32_t ynx_link_owner_drop_borrow(void *);
*/
import "C"

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"runtime/cgo"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

// NativeLocalCallerRegistration is the same-process startup owner's original
// client/parent lifetime, not a Root or Source registration. A normal Go main
// may hand NativeRegistrationPointer to its private native composition when
// linked normally or with c-shared/c-archive. There is no C config installer,
// RPC, JSON provider, or cross-process Go/native pointer protocol.
type NativeLocalCallerRegistration struct {
	client   *LocalCallerClient
	bindings [5]NativeLocalCallerBinding
	ctx      context.Context
	cancel   context.CancelFunc
	retired  atomic.Bool
	mu       sync.Mutex
	holders  map[*nativeLocalCallerHolder]bool
	changed  chan struct{}
	native   *C.ynx_link_private_client_registration_v1
	handle   cgo.Handle
	closed   bool
}

type nativeLocalCallerHolder struct {
	registration            *NativeLocalCallerRegistration
	queryOnly               bool
	ctx                     context.Context
	cancel                  context.CancelFunc
	native                  unsafe.Pointer
	handle                  cgo.Handle
	mu                      sync.Mutex
	inflight                int
	retired, joined, closed bool
	closeAttempted          bool
	cleanupFirst            error
	preconditionFirst       error
	postAttempted           bool
	changed                 chan struct{}
	first                   error
	firstPacket             LocalCallerResponse
	last                    LocalCallerResponse
	lastErr                 error
}

type nativeCallerCurrentError struct{ code int32 }

func nativeLocalCallerStartupBorrowCurrent(p unsafe.Pointer) error {
	if p == nil {
		return ErrDenied
	}
	if rc := C.ynx_link_private_client_registration_borrow_current_v1((*C.ynx_link_private_client_registration_borrow_v1)(p)); rc != 0 {
		return fmt.Errorf("native registration borrow current (%d): %w", int32(rc), ErrDenied)
	}
	return nil
}
func nativeLocalCallerStartupReleaseBorrow(p unsafe.Pointer) error {
	if p == nil {
		return ErrDenied
	}
	if rc := C.ynx_link_private_client_registration_borrow_release_v1((*C.ynx_link_private_client_registration_borrow_v1)(p)); rc != 0 {
		return fmt.Errorf("native registration borrow release (%d): %w", int32(rc), ErrLocalCallerDraining)
	}
	return nil
}

func (e nativeCallerCurrentError) Error() string {
	return fmt.Sprintf("original native source current rejected (%d)", e.code)
}

func RegisterNativeLocalCallerClient(ctx context.Context, client *LocalCallerClient, bindings [5]NativeLocalCallerBinding) (*NativeLocalCallerRegistration, error) {
	if ctx == nil || client == nil || client.routes == nil {
		return nil, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	seen := make(map[string]bool, 5)
	for i, b := range bindings {
		if b == (NativeLocalCallerBinding{}) {
			continue
		}
		method := http.MethodPost
		contentType := "application/json"
		if i >= 3 {
			method = http.MethodGet
			contentType = ""
		}
		key := b.Method + " " + b.Path
		if b.Method != method || strings.ContainsAny(b.ContentType, "\r\n\x00") || b.ContentType != contentType || seen[key] {
			return nil, ErrDenied
		}
		if _, ok := client.routes[key]; !ok {
			return nil, ErrDenied
		}
		seen[key] = true
	}
	if len(seen) == 0 {
		return nil, ErrDenied
	}
	parent, cancel := context.WithCancel(ctx)
	r := &NativeLocalCallerRegistration{client: client, bindings: bindings, ctx: parent, cancel: cancel, holders: make(map[*nativeLocalCallerHolder]bool), changed: make(chan struct{}, 1)}
	r.handle = cgo.NewHandle(r)
	r.native = C.ynx_link_owner_register(C.uintptr_t(r.handle))
	if r.native == nil {
		r.handle.Delete()
		cancel()
		return nil, ErrUnavailable
	}
	context.AfterFunc(parent, func() { _ = r.Retire() })
	return r, nil
}

func (r *NativeLocalCallerRegistration) NativeRegistrationPointer() unsafe.Pointer {
	if r == nil || r.retired.Load() {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	return unsafe.Pointer(r.native)
}

// BorrowNativeRegistrationPointer is the normal Go owner's private handoff to
// its SAME-process native SourceLease. The result is a registration_borrow_v1*,
// not a registration*. The SourceLease holds it until actual close, obtains
// the original registration with registration_from_borrow_v1 before capture,
// and releases it once. Retire invalidates current but cannot free this debt.
func (r *NativeLocalCallerRegistration) BorrowNativeRegistrationPointer() (unsafe.Pointer, error) {
	if r == nil {
		return nil, ErrUnavailable
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.retired.Load() || r.ctx.Err() != nil {
		return nil, ErrDenied
	}
	borrow := C.ynx_link_owner_borrow(r.native)
	if borrow == nil {
		return nil, ErrUnavailable
	}
	return borrow, nil
}
func (r *NativeLocalCallerRegistration) notify() {
	select {
	case r.changed <- struct{}{}:
	default:
	}
}
func (r *NativeLocalCallerRegistration) Retire() error {
	if r == nil {
		return nil
	}
	r.retired.Store(true)
	r.mu.Lock()
	if r.native != nil {
		C.ynx_link_owner_retire(r.native)
	}
	all := make([]*nativeLocalCallerHolder, 0, len(r.holders))
	for h := range r.holders {
		all = append(all, h)
	}
	r.mu.Unlock()
	r.cancel()
	for _, h := range all {
		h.retire()
	}
	r.notify()
	return nil
}
func (r *NativeLocalCallerRegistration) Join(ctx context.Context) error {
	if r == nil || ctx == nil || !r.retired.Load() {
		return ErrDenied
	}
	for {
		r.mu.Lock()
		empty := len(r.holders) == 0 && C.ynx_link_owner_borrows(r.native) == 0
		r.mu.Unlock()
		if empty {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-r.changed:
		}
	}
}
func (r *NativeLocalCallerRegistration) Close() error {
	if r == nil {
		return nil
	}
	_ = r.Retire()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	if len(r.holders) != 0 || C.ynx_link_owner_borrows(r.native) != 0 {
		return ErrLocalCallerDraining
	}
	if C.ynx_link_owner_free(r.native) != 0 {
		return ErrLocalCallerDraining
	}
	r.handle.Delete()
	r.native = nil
	r.closed = true
	return nil
}

//export goYNXPrivateRegistrationBorrowRelease
func goYNXPrivateRegistrationBorrowRelease(id C.uintptr_t, borrow unsafe.Pointer) C.int32_t {
	r, ok := nativeCallerValue[*NativeLocalCallerRegistration](id)
	if !ok {
		return 1
	}
	r.mu.Lock()
	rc := C.ynx_link_owner_drop_borrow(borrow)
	r.mu.Unlock()
	r.notify()
	return rc
}

func (r *NativeLocalCallerRegistration) capture(native unsafe.Pointer, query bool) (*nativeLocalCallerHolder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.retired.Load() || r.ctx.Err() != nil || len(r.holders) >= 64 {
		return nil, ErrUnavailable
	}
	ctx, cancel := context.WithCancel(r.ctx)
	h := &nativeLocalCallerHolder{registration: r, queryOnly: query, ctx: ctx, cancel: cancel, native: native, changed: make(chan struct{}, 1)}
	h.handle = cgo.NewHandle(h)
	r.holders[h] = true
	// Parent cancellation is observed by registration.Retire, whose private
	// original C registration stays pinned until every child/loan drains. Do
	// not queue a callback containing a child C pointer that Free could reclaim.
	return h, nil
}
func (h *nativeLocalCallerHolder) retire() {
	h.mu.Lock()
	h.retired = true
	if h.native != nil {
		// This helper only updates the native lifecycle flag; it never invokes
		// a Source callback. Serialize against Free clearing this child pointer.
		C.ynx_link_owner_holder_retire(h.native)
	}
	h.mu.Unlock()
	h.cancel()
	select {
	case h.changed <- struct{}{}:
	default:
	}
}
func (h *nativeLocalCallerHolder) join(ctx context.Context) error {
	for {
		h.mu.Lock()
		if !h.retired {
			h.mu.Unlock()
			return ErrDenied
		}
		if h.inflight == 0 {
			h.joined = true
			h.mu.Unlock()
			return nil
		}
		h.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-h.changed:
		}
	}
}
func (h *nativeLocalCallerHolder) close() error {
	h.retire()
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closeAttempted {
		return h.cleanupFirst
	}
	if !h.joined || h.inflight != 0 {
		if h.preconditionFirst == nil {
			h.preconditionFirst = ErrLocalCallerDraining
		}
		return ErrLocalCallerDraining
	}
	// A known precondition failure did not execute Close. Only this selected
	// actual close is once-only; its unknown/failure must never be retried.
	h.closeAttempted = true
	h.closed = true
	return nil
}
func cloneNativeCallerResponse(p LocalCallerResponse) LocalCallerResponse {
	p.Body = bytes.Clone(p.Body)
	p.Header = p.Header.Clone()
	return p
}
func (h *nativeLocalCallerHolder) call(op uint8, body []byte, writeCurrent func() error) (out LocalCallerResponse, err error) {
	h.mu.Lock()
	if h.closed || h.retired || h.ctx.Err() != nil || op > 4 || (h.queryOnly && op < 3) || (op >= 3 && len(body) != 0) || (op < 3 && h.postAttempted) {
		h.mu.Unlock()
		return out, ErrDenied
	}
	b := h.registration.bindings[op]
	if b == (NativeLocalCallerBinding{}) {
		h.mu.Unlock()
		return out, ErrDenied
	}
	if op < 3 {
		h.postAttempted = true
	}
	h.inflight++
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		if err != nil && h.first == nil {
			h.first = err
			h.firstPacket = cloneNativeCallerResponse(out)
		}
		h.last = cloneNativeCallerResponse(out)
		h.lastErr = err
		h.inflight--
		h.mu.Unlock()
		select {
		case h.changed <- struct{}{}:
		default:
		}
	}()
	return h.registration.client.call(h.ctx, b.Method, b.Path, b.ContentType, body, writeCurrent)
}

func nativeCallerErrorCode(err error) C.int32_t {
	if err == nil {
		return 0
	}
	var n nativeCallerCurrentError
	switch {
	case errors.As(err, &n):
		return 6
	case errors.Is(err, ErrBounds):
		return 2
	case errors.Is(err, ErrUnavailable):
		return 3
	case errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded):
		return 4
	case errors.Is(err, ErrLocalCallerDraining):
		return 5
	default:
		return 1
	}
}
func nativeCallerPacket(out LocalCallerResponse, err error) *C.ynx_link_private_client_packet_v1 {
	p := (*C.ynx_link_private_client_packet_v1)(C.calloc(1, C.size_t(unsafe.Sizeof(C.ynx_link_private_client_packet_v1{}))))
	if p == nil {
		return nil
	}
	set := func(data []byte, dst **C.uint8_t, size *C.size_t) {
		if len(data) != 0 {
			*dst = (*C.uint8_t)(C.CBytes(data))
			*size = C.size_t(len(data))
		}
	}
	if out.PacketPresent {
		p.packet_present = 1
		p.status_code = C.int32_t(out.StatusCode)
		set([]byte(out.Method), &p.method, &p.method_size)
		set([]byte(out.RequestPath), &p.request_path, &p.request_path_size)
		header, _ := json.Marshal(out.Header)
		set(header, &p.header_json, &p.header_json_size)
		set([]byte(out.Header.Get("Content-Type")), &p.content_type, &p.content_type_size)
		set([]byte(out.Header.Get("Cache-Control")), &p.cache_control, &p.cache_control_size)
		set(out.Body, &p.body, &p.body_size)
	}
	p.error_code = nativeCallerErrorCode(err)
	var n nativeCallerCurrentError
	if errors.As(err, &n) {
		p.native_current_code = C.int32_t(n.code)
	}
	var dispatch *DispatchError
	if errors.As(err, &dispatch) {
		if dispatch.DispatchPossible {
			p.dispatch_possible = 1
		}
		p.partial_response_bytes = C.uint64_t(dispatch.PartialResponseBytes)
	}
	if err != nil {
		text := []byte(err.Error())
		p.error_message = (*C.char)(C.CBytes(text))
		p.error_message_size = C.size_t(len(text))
	}
	return p
}
func nativeCallerValue[T any](id C.uintptr_t) (out T, ok bool) {
	defer func() {
		if recover() != nil {
			ok = false
		}
	}()
	out, ok = cgo.Handle(id).Value().(T)
	return
}

//export goYNXPrivateClientCapture
func goYNXPrivateClientCapture(id C.uintptr_t, native unsafe.Pointer, query C.uint8_t, out *C.uintptr_t) C.int32_t {
	if out == nil {
		return 1
	}
	*out = 0
	r, ok := nativeCallerValue[*NativeLocalCallerRegistration](id)
	if !ok {
		return 1
	}
	h, err := r.capture(native, query != 0)
	if h != nil {
		*out = C.uintptr_t(h.handle)
	}
	return nativeCallerErrorCode(err)
}

//export goYNXPrivateClientCall
func goYNXPrivateClientCall(id C.uintptr_t, op C.uint8_t, body unsafe.Pointer, size C.size_t, out **C.ynx_link_private_client_packet_v1) C.int32_t {
	if out == nil {
		return 1
	}
	*out = nil
	h, ok := nativeCallerValue[*nativeLocalCallerHolder](id)
	if !ok {
		return 1
	}
	var response LocalCallerResponse
	var err error
	if size > 16<<20 || (size != 0 && body == nil) {
		err = ErrBounds
	} else {
		owned := C.GoBytes(body, C.int(size))
		response, err = h.call(uint8(op), owned, func() error {
			if C.ynx_link_owner_current(h.native) != 0 {
				return nativeCallerCurrentError{int32(C.ynx_link_owner_native_code(h.native))}
			}
			return nil
		})
	}
	h.mu.Lock()
	if h.first != nil {
		err = h.first
	}
	h.mu.Unlock()
	*out = nativeCallerPacket(response, err)
	if *out == nil {
		return 3
	}
	return nativeCallerErrorCode(err)
}

//export goYNXPrivateClientError
func goYNXPrivateClientError(id C.uintptr_t, out **C.ynx_link_private_client_packet_v1) C.int32_t {
	if out == nil {
		return 1
	}
	*out = nil
	h, ok := nativeCallerValue[*nativeLocalCallerHolder](id)
	if !ok {
		return 1
	}
	h.mu.Lock()
	response, err := cloneNativeCallerResponse(h.last), h.first
	if err != nil {
		response = cloneNativeCallerResponse(h.firstPacket)
	} else if h.preconditionFirst != nil {
		err = h.preconditionFirst
	}
	h.mu.Unlock()
	*out = nativeCallerPacket(response, err)
	if *out == nil {
		return 3
	}
	return nativeCallerErrorCode(err)
}

//export goYNXPrivateClientRetire
func goYNXPrivateClientRetire(id C.uintptr_t) C.int32_t {
	h, ok := nativeCallerValue[*nativeLocalCallerHolder](id)
	if !ok {
		return 1
	}
	h.retire()
	return 0
}

//export goYNXPrivateClientJoin
func goYNXPrivateClientJoin(id C.uintptr_t, ms C.uint32_t) C.int32_t {
	h, ok := nativeCallerValue[*nativeLocalCallerHolder](id)
	if !ok {
		return 1
	}
	if ms == 0 || ms > 60000 {
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(ms)*time.Millisecond)
	defer cancel()
	return nativeCallerErrorCode(h.join(ctx))
}

//export goYNXPrivateClientClose
func goYNXPrivateClientClose(id C.uintptr_t) C.int32_t {
	h, ok := nativeCallerValue[*nativeLocalCallerHolder](id)
	if !ok {
		return 1
	}
	return nativeCallerErrorCode(h.close())
}

//export goYNXPrivateClientFree
func goYNXPrivateClientFree(id C.uintptr_t) C.int32_t {
	h, ok := nativeCallerValue[*nativeLocalCallerHolder](id)
	if !ok {
		return 1
	}
	return nativeCallerErrorCode(h.free())
}

func (h *nativeLocalCallerHolder) free() error {
	h.mu.Lock()
	if !h.closed || !h.joined || h.inflight != 0 || h.cleanupFirst != nil {
		h.mu.Unlock()
		return ErrLocalCallerDraining
	}
	h.native = nil
	h.mu.Unlock()
	r := h.registration
	r.mu.Lock()
	delete(r.holders, h)
	r.mu.Unlock()
	h.handle.Delete()
	r.notify()
	return nil
}
