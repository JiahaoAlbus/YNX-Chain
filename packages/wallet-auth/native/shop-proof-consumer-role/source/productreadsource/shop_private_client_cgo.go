//go:build cgo && (darwin || linux)

package productreadsource

/*
#include <stdlib.h>
#include "../native/ShopOriginalPrivateClient.h"
#include "../ShopOwnedExchangePrivate.h"
*/
import "C"
import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"
	"unsafe"
)

// Same-runtime private inventory, not a permission table or serialized handle.
// Tokens are tiny C allocations kept as tombstones; Go owner refs are dropped
// ONLY after exact physical closure. There is no caller registration setter.
type shopCClient struct {
	mu            sync.Mutex
	owner         *ShopPrivateClient
	active        int
	released      bool
	scope         unsafe.Pointer
	scopeBytes    int
	releasedError error
}
type shopCResponse struct {
	mu                      sync.Mutex
	owner                   *ShopOriginalResponse
	parent                  *shopCClient
	active                  int
	released                bool
	buffers                 []unsafe.Pointer
	data                    C.ynx_auth_shop_transport_v1
	copied                  bool
	releaseBusy             bool
	copyError, releaseError error
}

var shopCInventory = struct {
	sync.Mutex
	clients   map[unsafe.Pointer]*shopCClient
	responses map[unsafe.Pointer]*shopCResponse
	count     int
}{clients: map[unsafe.Pointer]*shopCClient{}, responses: map[unsafe.Pointer]*shopCResponse{}}

const shopCBound = 65536

func shopCStatus(err error, done bool) C.ynx_auth_shop_status_v1 {
	var s C.ynx_auth_shop_status_v1
	if done {
		s.physical_done = 1
	}
	if err != nil {
		s.error_present = 1
		s.first_code = 74001
		switch {
		case errors.Is(err, ErrNotSupplied):
			s.first_code = 74002
		case errors.Is(err, ErrDenied):
			s.first_code = 74003
		case errors.Is(err, ErrRetired):
			s.first_code = 74004
		case errors.Is(err, ErrPending):
			s.first_code = 74005
		case errors.Is(err, ErrUnknown):
			s.first_code = 74006
			s.unknown = 1
		}
		var original interface{ NativeCode() int32 }
		if errors.As(err, &original) {
			s.first_code = C.int32_t(original.NativeCode())
		}
	}
	return s
}
func shopClientRef(p *C.ynx_auth_shop_original_client_v1) (*shopCClient, func()) {
	shopCInventory.Lock()
	e := shopCInventory.clients[unsafe.Pointer(p)]
	shopCInventory.Unlock()
	if e == nil {
		return nil, func() {}
	}
	e.mu.Lock()
	if e.released || e.owner == nil {
		e.mu.Unlock()
		return nil, func() {}
	}
	e.active++
	e.mu.Unlock()
	return e, func() { e.mu.Lock(); e.active--; e.mu.Unlock() }
}
func shopResponseRef(p *C.ynx_auth_shop_original_response_v1) (*shopCResponse, func()) {
	shopCInventory.Lock()
	e := shopCInventory.responses[unsafe.Pointer(p)]
	shopCInventory.Unlock()
	if e == nil {
		return nil, func() {}
	}
	e.mu.Lock()
	if e.released || e.owner == nil || e.releaseBusy {
		e.mu.Unlock()
		return nil, func() {}
	}
	e.active++
	e.mu.Unlock()
	return e, func() { e.mu.Lock(); e.active--; e.mu.Unlock() }
}
func reserveShopClient() (*C.ynx_auth_shop_original_client_v1, *shopCClient) {
	shopCInventory.Lock()
	defer shopCInventory.Unlock()
	if shopCInventory.count >= shopCBound {
		return nil, nil
	}
	p := C.malloc(1)
	if p == nil {
		return nil, nil
	}
	e := &shopCClient{}
	shopCInventory.count++
	shopCInventory.clients[p] = e
	return (*C.ynx_auth_shop_original_client_v1)(p), e
}
func reserveShopResponse(parent *shopCClient, r *ShopOriginalResponse) (*C.ynx_auth_shop_original_response_v1, error) {
	shopCInventory.Lock()
	defer shopCInventory.Unlock()
	if shopCInventory.count >= shopCBound {
		return nil, ErrPending
	}
	p := C.malloc(1)
	if p == nil {
		return nil, ErrPending
	}
	shopCInventory.count++
	shopCInventory.responses[p] = &shopCResponse{owner: r, parent: parent}
	return (*C.ynx_auth_shop_original_response_v1)(p), nil
}

//export ynx_auth_shop_original_client_acquire_v1
func ynx_auth_shop_original_client_acquire_v1() (out C.ynx_auth_shop_acquisition_v1) {
	p, e := reserveShopClient()
	out.owner = p
	if e == nil {
		out.status = shopCStatus(ErrPending, false)
		return
	}
	defer func() {
		if recover() != nil {
			out.status = shopCStatus(ErrUnknown, false)
		}
	}()
	e.owner, _ = OpenOriginalShopPrivateClient(context.Background())
	if e.owner == nil {
		out.status = shopCStatus(ErrNotSupplied, false)
		return
	}
	e.owner.mu.Lock()
	first := e.owner.first
	e.owner.mu.Unlock()
	out.status = shopCStatus(first, false)
	return
}

//export ynx_auth_shop_original_client_current_v1
func ynx_auth_shop_original_client_current_v1(p *C.ynx_auth_shop_original_client_v1) C.ynx_auth_shop_status_v1 {
	e, drop := shopClientRef(p)
	defer drop()
	if e == nil {
		return shopCStatus(ErrDenied, false)
	}
	return shopCStatus(e.owner.Current(e.owner.ctx), false)
}

//export ynx_auth_shop_original_client_scope_v1
func ynx_auth_shop_original_client_scope_v1(p *C.ynx_auth_shop_original_client_v1, out *C.ynx_auth_shop_span_v1) C.ynx_auth_shop_status_v1 {
	e, drop := shopClientRef(p)
	defer drop()
	if e == nil || out == nil {
		return shopCStatus(ErrDenied, false)
	}
	if err := e.owner.Current(e.owner.ctx); err != nil {
		return shopCStatus(err, false)
	}
	e.mu.Lock()
	if e.scope == nil {
		b, err := json.Marshal(e.owner.capture.Scope)
		if err != nil || len(b) > 32768 {
			e.mu.Unlock()
			return shopCStatus(ErrDenied, false)
		}
		e.scope = C.CBytes(b)
		if e.scope == nil {
			e.mu.Unlock()
			return shopCStatus(ErrPending, false)
		}
		e.scopeBytes = len(b)
	}
	data, length := e.scope, e.scopeBytes
	e.mu.Unlock()
	if err := e.owner.Current(e.owner.ctx); err != nil {
		return shopCStatus(err, false)
	}
	out.bytes = (*C.uint8_t)(data)
	out.length = C.size_t(length)
	return shopCStatus(nil, false)
}

//export ynx_auth_shop_original_client_read_v1
func ynx_auth_shop_original_client_read_v1(p *C.ynx_auth_shop_original_client_v1, order *C.uint8_t, n C.size_t, out **C.ynx_auth_shop_original_response_v1) (status C.ynx_auth_shop_status_v1) {
	e, drop := shopClientRef(p)
	defer drop()
	if e == nil || out == nil || *out != nil || order == nil || n < 3 || n > 128 {
		return shopCStatus(ErrDenied, false)
	}
	id := string(C.GoBytes(unsafe.Pointer(order), C.int(n)))
	if !token.MatchString(id) {
		return shopCStatus(ErrDenied, false)
	}
	native, allocation := reserveShopResponse(e, nil)
	if native == nil {
		return shopCStatus(allocation, false)
	}
	*out = native
	defer func() {
		if recover() != nil {
			status = shopCStatus(e.owner.fail(ErrUnknown), false)
		}
	}()
	r, err := e.owner.ReadOriginalShopNativeInvoiceRequest(e.owner.ctx, id)
	shopCInventory.Lock()
	entry := shopCInventory.responses[unsafe.Pointer(native)]
	shopCInventory.Unlock()
	entry.mu.Lock()
	entry.owner = r
	entry.releaseError = err
	entry.mu.Unlock()
	return shopCStatus(err, false)
}

//export ynx_auth_shop_original_response_copy_v1
func ynx_auth_shop_original_response_copy_v1(p *C.ynx_auth_shop_original_response_v1, out *C.ynx_auth_shop_transport_v1) C.ynx_auth_shop_status_v1 {
	e, drop := shopResponseRef(p)
	defer drop()
	if e == nil || out == nil || out.version != 1 || out.size != C.uint32_t(C.sizeof_ynx_auth_shop_transport_v1) {
		return shopCStatus(ErrDenied, false)
	}
	raw, err := e.owner.ReadOriginalTransportDATA()
	if err != nil {
		return shopCStatus(err, false)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.copyError != nil {
		return shopCStatus(e.copyError, false)
	}
	if !e.copied {
		e.data.version = 1
		e.data.size = C.uint32_t(C.sizeof_ynx_auth_shop_transport_v1)
		e.data.status_code = C.uint32_t(raw.StatusCode)
		values := [][]byte{[]byte(raw.Method), []byte(raw.RequestPath), []byte(raw.Header.Get("Content-Type")), raw.Body}
		spans := []*C.ynx_auth_shop_span_v1{&e.data.method, &e.data.path, &e.data.content_type, &e.data.body_original}
		for i, v := range values {
			b := C.CBytes(v)
			if b == nil {
				e.copyError = ErrPending
				return shopCStatus(e.copyError, false)
			}
			e.buffers = append(e.buffers, b)
			spans[i].bytes = (*C.uint8_t)(b)
			spans[i].length = C.size_t(len(v))
		}
		e.copied = true
	}
	if _, err = e.owner.ReadOriginalTransportDATA(); err != nil {
		return shopCStatus(err, false)
	}
	*out = e.data
	return shopCStatus(nil, false)
}

//export ynx_auth_shop_original_response_release_v1
func ynx_auth_shop_original_response_release_v1(p *C.ynx_auth_shop_original_response_v1) (status C.ynx_auth_shop_status_v1) {
	shopCInventory.Lock()
	e := shopCInventory.responses[unsafe.Pointer(p)]
	shopCInventory.Unlock()
	if e == nil {
		return shopCStatus(ErrDenied, false)
	}
	defer func() {
		if v := recover(); v != nil {
			e.mu.Lock()
			if e.releaseError == nil {
				e.releaseError = &shopPanicCause{value: v}
			}
			status = shopCStatus(e.releaseError, false)
			status.unknown = 1
			e.mu.Unlock()
		}
	}()
	e.mu.Lock()
	if e.released {
		defer e.mu.Unlock()
		return shopCStatus(e.releaseError, true)
	}
	if e.active != 0 || e.releaseBusy {
		e.mu.Unlock()
		return shopCStatus(ErrPending, false)
	}
	e.releaseBusy = true
	original := e.owner
	e.mu.Unlock()
	var err error
	done := true
	if original != nil {
		err, done = original.Release()
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.releaseBusy = false
	if err == nil {
		err = e.copyError
	}
	if err == nil {
		err = e.releaseError
	}
	if done {
		for _, b := range e.buffers {
			C.free(b)
		}
		e.buffers = nil
		e.owner = nil
		e.released = true
		e.releaseError = err
		e.data = C.ynx_auth_shop_transport_v1{}
	}
	return shopCStatus(err, done)
}

//export ynx_auth_shop_original_response_drain_pending_v1
func ynx_auth_shop_original_response_drain_pending_v1(p *C.ynx_auth_shop_original_response_v1, out *C.uint32_t) C.ynx_auth_shop_status_v1 {
	if out == nil {
		return shopCStatus(ErrDenied, false)
	}
	*out = 0
	e, drop := shopResponseRef(p)
	defer drop()
	if e == nil {
		return shopCStatus(ErrDenied, false)
	}
	if e.owner.originalTransportDrainPending() {
		*out = 1
	}
	return shopCStatus(nil, false)
}

//export ynx_auth_shop_original_client_retire_v1
func ynx_auth_shop_original_client_retire_v1(p *C.ynx_auth_shop_original_client_v1) C.ynx_auth_shop_status_v1 {
	e, drop := shopClientRef(p)
	defer drop()
	if e == nil {
		return shopCStatus(ErrDenied, false)
	}
	e.owner.Retire()
	return shopCStatus(nil, false)
}

//export ynx_auth_shop_original_client_join_v1
func ynx_auth_shop_original_client_join_v1(p *C.ynx_auth_shop_original_client_v1, ms C.uint32_t) C.ynx_auth_shop_status_v1 {
	e, drop := shopClientRef(p)
	defer drop()
	if e == nil || ms < 1 || ms > 60000 {
		return shopCStatus(ErrDenied, false)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(ms)*time.Millisecond)
	defer cancel()
	err, done := e.owner.Join(ctx)
	return shopCStatus(err, done)
}

//export ynx_auth_shop_original_client_close_v1
func ynx_auth_shop_original_client_close_v1(p *C.ynx_auth_shop_original_client_v1) C.ynx_auth_shop_status_v1 {
	e, drop := shopClientRef(p)
	defer drop()
	if e == nil {
		return shopCStatus(ErrDenied, false)
	}
	err, done := e.owner.Close()
	s := shopCStatus(err, done)
	e.owner.mu.Lock()
	selected := e.owner.closeSelected
	e.owner.mu.Unlock()
	if selected && !done {
		s.unknown = 1
	}
	return s
}

//export ynx_auth_shop_original_client_release_closed_v1
func ynx_auth_shop_original_client_release_closed_v1(p *C.ynx_auth_shop_original_client_v1) C.ynx_auth_shop_status_v1 {
	shopCInventory.Lock()
	e := shopCInventory.clients[unsafe.Pointer(p)]
	shopCInventory.Unlock()
	if e == nil {
		return shopCStatus(ErrDenied, false)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.released {
		return shopCStatus(e.releasedError, true)
	}
	if e.active != 0 || e.owner == nil {
		return shopCStatus(ErrPending, false)
	}
	e.owner.mu.Lock()
	done := e.owner.physicalDone
	first := e.owner.closeError
	e.owner.mu.Unlock()
	if !done {
		return shopCStatus(ErrPending, false)
	}
	releaseOriginalShopConstraintBuffers(e)
	if e.scope != nil {
		C.free(e.scope)
		e.scope = nil
	}
	e.owner = nil
	e.released = true
	e.releasedError = first
	return shopCStatus(first, true)
}
