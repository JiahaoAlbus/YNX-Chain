//go:build cgo && (darwin || linux)

package productreadsource

/*
#include <stdlib.h>
#include "../ShopProofCarrierPrivate.h"
*/
import "C"
import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"runtime"
	"time"
	"unsafe"
)

// Preserve the original numeric code including present/code0; this private
// wrapper does not serialize a proof or install a permission/provider.
type shopProofOriginalFailure struct {
	code    int32
	unknown bool
}

func (*shopProofOriginalFailure) Error() string       { return "SHOP_ORIGINAL_PROOF_FAILURE" }
func (e *shopProofOriginalFailure) NativeCode() int32 { return e.code }
func (e *shopProofOriginalFailure) Unwrap() error {
	if e.unknown {
		return ErrUnknown
	}
	return ErrDenied
}
func shopProofFailure(s C.ynx_auth_shop_status_v1) error {
	if s.error_present > 1 || s.unknown > 1 || s.physical_done != 0 || (s.error_present == 0 && s.first_code != 0) {
		return ErrDenied
	}
	if s.error_present != 0 || s.unknown != 0 {
		return &shopProofOriginalFailure{int32(s.first_code), s.unknown != 0}
	}
	return nil
}

//export ynx_auth_shop_original_client_read_with_proof_v1
func ynx_auth_shop_original_client_read_with_proof_v1(source *C.ynx_auth_shop_original_client_v1, order *C.uint8_t, n C.size_t, proof *C.ynx_auth_shop_proof_borrow_v1, out **C.ynx_auth_shop_original_response_v1) (status C.ynx_auth_shop_status_v1) {
	// CPP's synchronous borrow is tied to its original actual worker pthread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	e, drop := shopClientRef(source)
	defer drop()
	if e == nil || out == nil || *out != nil || order == nil || n < 3 || n > 128 || proof == nil {
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
	*out = native // adopt response before original first0
	shopCInventory.Lock()
	entry := shopCInventory.responses[unsafe.Pointer(native)]
	shopCInventory.Unlock()
	var failure error
	defer func() {
		if v := recover(); v != nil {
			failure = &shopPanicCause{value: v}
			status = shopCStatus(e.owner.fail(failure), false)
			status.unknown = 1
		}
		entry.mu.Lock()
		entry.releaseError = failure
		entry.mu.Unlock()
	}()
	nativeStatus := C.ynx_auth_shop_proof_borrow_current_v1(proof, source)
	if failure = shopProofFailure(nativeStatus); failure != nil {
		return nativeStatus
	}
	buffer := C.malloc(16384)
	if buffer == nil {
		failure = ErrPending
		return shopCStatus(failure, false)
	}
	defer C.free(buffer)
	var original C.ynx_wallet_shop_invoice_introspection_proof_data_v1
	nativeStatus = C.ynx_auth_shop_proof_borrow_copy_v1(proof, source, (*C.uint8_t)(buffer), 16384, &original)
	// Bounded late DATA is copied/retained before checking the original error.
	start, a, size := uintptr(buffer), uintptr(unsafe.Pointer(original.original.header_value)), uint64(original.original.header_value_bytes)
	valid := original.version == 1 && original.size == C.uint32_t(C.sizeof_ynx_wallet_shop_invoice_introspection_proof_data_v1) && size >= 2 && size <= 16384 && a >= start && a <= ^uintptr(0)-uintptr(size) && a+uintptr(size) <= start+16384
	var header string
	if valid {
		header = string(C.GoBytes(unsafe.Pointer(original.original.header_value), C.int(size)))
	}
	if failure = shopProofFailure(nativeStatus); failure != nil {
		return nativeStatus
	}
	if !valid {
		failure = ErrDenied
		return shopCStatus(failure, false)
	}
	nativeStatus = C.ynx_auth_shop_proof_borrow_current_v1(proof, source)
	if failure = shopProofFailure(nativeStatus); failure != nil {
		return nativeStatus
	}
	// Expiry is the SAME sole-decoded original proof, never Source/session TTL.
	readCtx, cancel := context.WithDeadline(e.owner.ctx, time.UnixMilli(int64(original.expires_at_ms)))
	deadlineOwned := false
	defer func() {
		if !deadlineOwned {
			cancel()
		}
	}()
	r, err := e.owner.readOriginalShopRequest(readCtx, id, &securelink.ProductSessionProofV2DATA{HeaderValue: header})
	if r != nil {
		r.proofCancel = cancel
		deadlineOwned = true
	}
	entry.mu.Lock()
	entry.owner = r
	entry.mu.Unlock() // retain partial raw/owned exchange FIRST
	failure = err
	if failure != nil {
		return shopCStatus(failure, false)
	}
	nativeStatus = C.ynx_auth_shop_proof_borrow_current_v1(proof, source)
	if failure = shopProofFailure(nativeStatus); failure != nil {
		if r != nil {
			r.first = errors.Join(r.first, failure)
		}
		return nativeStatus
	}
	return shopCStatus(nil, false)
}
