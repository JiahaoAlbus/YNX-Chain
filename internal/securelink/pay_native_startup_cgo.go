//go:build securelink_pay_native_startup && cgo && (linux || darwin)

package securelink

/*
#cgo CFLAGS: -I${SRCDIR}/../../cmd/ynx-secure-link-caller
#include <stdlib.h>
#include "pay_native_actual_context_private.h"
#include "private_client_startup_v1.h"
int32_t ynx_pay_startup_native_current(void *);
int32_t ynx_pay_startup_native_code(void *);
int32_t ynx_pay_startup_native_adopt(void *, void *, void **);
*/
import "C"

import (
	"context"
	"fmt"
	"runtime/cgo"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

type payNativeStartupState struct {
	owner  *NativeLocalCallerStartupOwner
	native unsafe.Pointer
	cancel context.CancelFunc
	handle cgo.Handle
	mu     sync.Mutex
	first  error
	closed atomic.Bool
}

func (s *payNativeStartupState) remember(err error) error {
	if err == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.first == nil {
		s.first = err
	}
	return s.first
}
func (s *payNativeStartupState) current() error {
	if rc := C.ynx_pay_startup_native_current(s.native); rc != 0 {
		if code := C.ynx_pay_startup_native_code(s.native); code != 0 {
			return nativeCallerCurrentError{code: int32(code)}
		}
		return fmt.Errorf("native startup no longer active (%d): %w", int32(rc), context.Canceled)
	}
	return nil
}

func payNativeProfileFromC(p *C.ynx_wallet_pay_root_transport_profile_v1) payNativeTransportProfile {
	r := payNativeTransportProfile{version: uint32(p.version), size: uint32(p.size), peerUID: uint32(p.peer_uid), peerPID: int32(p.peer_pid), timeoutMS: uint64(p.timeout_ms), maximumHeaderBytes: uint64(p.maximum_header_bytes), maximumResponseBytes: uint64(p.maximum_response_bytes)}
	copy(r.resourceRef[:], C.GoBytes(unsafe.Pointer(&p.resource_ref[0]), C.int(len(r.resourceRef))))
	copy(r.socketPath[:], C.GoBytes(unsafe.Pointer(&p.socket_path[0]), C.int(len(r.socketPath))))
	copy(r.service[:], C.GoBytes(unsafe.Pointer(&p.service[0]), C.int(len(r.service))))
	for i := range r.routes {
		src := &p.routes[i]
		dst := &r.routes[i]
		dst.enabled = uint8(src.enabled)
		dst.maximumBodyBytes = uint64(src.maximum_body_bytes)
		dst.timeoutMS = uint64(src.timeout_ms)
		copy(dst.method[:], C.GoBytes(unsafe.Pointer(&src.method[0]), C.int(len(dst.method))))
		copy(dst.path[:], C.GoBytes(unsafe.Pointer(&src.path[0]), C.int(len(dst.path))))
		copy(dst.contentType[:], C.GoBytes(unsafe.Pointer(&src.content_type[0]), C.int(len(dst.contentType))))
	}
	return r
}

// Exported Go names are internal shims; the normal C wrapper exposes the exact
// const/opaque ABI. The Auth symbols are STRONG and exist only under this tag.
// The c-archive must be linked with the pinned Auth objects in the SAME image.

//export goYNXPayStartupOpen
func goYNXPayStartupOpen(native unsafe.Pointer, p *C.ynx_wallet_pay_root_transport_profile_v1, out *C.uintptr_t) C.int32_t {
	if out == nil || p == nil || native == nil {
		return 1
	}
	*out = 0
	// Native startup owns a new Go lifetime, governed by its retained actual
	// native context and explicit retirement, not a detached HTTP request.
	ctx, cancel := context.WithCancel(context.Background())
	s := &payNativeStartupState{native: native, cancel: cancel}
	s.handle = cgo.NewHandle(s)
	*out = C.uintptr_t(s.handle)
	cfg, bindings, err := decodePayNativeTransportProfile(payNativeProfileFromC(p), C.sizeof_ynx_wallet_pay_root_transport_profile_v1)
	if err == nil {
		err = s.current()
	}
	if err == nil {
		s.owner, err = OpenNativeLocalCallerStartup(ctx, cfg, bindings)
	} // adopt nonnull partial BEFORE err
	if err == nil {
		err = s.current()
	}
	s.remember(err)
	return nativeCallerErrorCode(err)
}

//export goYNXPayStartupAdopt
func goYNXPayStartupAdopt(id C.uintptr_t, out *unsafe.Pointer) C.int32_t {
	if out == nil {
		return 1
	}
	*out = nil
	s, ok := nativeCallerValue[*payNativeStartupState](id)
	if !ok || s.owner == nil {
		return 1
	}
	result, err := s.owner.TransferBorrowToNativeSource(func(borrow unsafe.Pointer) (unsafe.Pointer, error) {
		if err := s.current(); err != nil {
			return nil, err
		}
		var source unsafe.Pointer
		rc := C.ynx_pay_startup_native_adopt(s.native, borrow, &source)
		// Never drop or hide the actual nonnull Source partial, including a
		// late Auth/current error. The Go owner records its borrow as adopted.
		if rc != 0 {
			return source, nativeCallerCurrentError{code: int32(rc)}
		}
		return source, s.current()
	})
	*out = result
	s.remember(err)
	return nativeCallerErrorCode(err)
}

//export goYNXPayStartupRetire
func goYNXPayStartupRetire(id C.uintptr_t) C.int32_t {
	s, ok := nativeCallerValue[*payNativeStartupState](id)
	if !ok {
		return 1
	}
	s.cancel()
	if s.owner != nil {
		return nativeCallerErrorCode(s.remember(s.owner.Retire()))
	}
	return 0
}

//export goYNXPayStartupJoin
func goYNXPayStartupJoin(id C.uintptr_t, ms C.uint32_t) C.int32_t {
	s, ok := nativeCallerValue[*payNativeStartupState](id)
	if !ok {
		return 1
	}
	if ms == 0 || ms > 60000 {
		return 2
	}
	if s.owner == nil {
		return 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(ms)*time.Millisecond)
	defer cancel()
	err := s.owner.Join(ctx)
	s.remember(err)
	return nativeCallerErrorCode(err)
}

//export goYNXPayStartupClose
func goYNXPayStartupClose(id C.uintptr_t) C.int32_t {
	s, ok := nativeCallerValue[*payNativeStartupState](id)
	if !ok {
		return 1
	}
	if s.owner != nil {
		if err := s.owner.Close(); err != nil {
			s.remember(err)
			return nativeCallerErrorCode(err)
		}
	}
	s.cancel()
	s.closed.Store(true)
	return 0
}

//export goYNXPayStartupError
func goYNXPayStartupError(id C.uintptr_t, out **C.ynx_link_private_client_packet_v1) C.int32_t {
	if out == nil {
		return 1
	}
	*out = nil
	s, ok := nativeCallerValue[*payNativeStartupState](id)
	if !ok {
		return 1
	}
	s.mu.Lock()
	err := s.first
	s.mu.Unlock()
	if err == nil && s.owner != nil {
		err = s.owner.FirstCause()
	}
	*out = nativeCallerPacket(LocalCallerResponse{}, err)
	if *out == nil {
		return 3
	}
	return nativeCallerErrorCode(err)
}

//export goYNXPayStartupFree
func goYNXPayStartupFree(id C.uintptr_t) C.int32_t {
	s, ok := nativeCallerValue[*payNativeStartupState](id)
	if !ok {
		return 1
	}
	if !s.closed.Load() {
		return 5
	}
	s.handle.Delete()
	return 0
}
