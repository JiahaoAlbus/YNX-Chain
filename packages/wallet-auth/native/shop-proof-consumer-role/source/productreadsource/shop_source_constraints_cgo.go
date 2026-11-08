//go:build cgo && (darwin || linux)

package productreadsource

/*
#include <stdlib.h>
#include "../ShopSourceConstraintsPrivate.h"
*/
import "C"
import (
	"sync"
	"unsafe"
)

// Tiny original public constraint buffers share the SAME C client lifetime.
// The inventory is private bookkeeping, not a registration/session store.
var shopConstraintInventory = struct {
	sync.Mutex
	rows map[*shopCClient]map[uint32]C.ynx_auth_shop_constraints_v1
}{rows: make(map[*shopCClient]map[uint32]C.ynx_auth_shop_constraints_v1)}

//export ynx_auth_shop_original_client_constraints_v1
func ynx_auth_shop_original_client_constraints_v1(p *C.ynx_auth_shop_original_client_v1, index C.uint32_t, out *C.ynx_auth_shop_constraints_v1) C.ynx_auth_shop_status_v1 {
	e, drop := shopClientRef(p)
	defer drop()
	if e == nil || out == nil || out.version != 1 || out.size != C.uint32_t(C.sizeof_ynx_auth_shop_constraints_v1) {
		return shopCStatus(ErrDenied, false)
	}
	if err := e.owner.Current(e.owner.ctx); err != nil {
		return shopCStatus(err, false)
	}
	d := e.owner.capture
	s, err := originalShopConstraintAtObserved(d, uint32(index))
	if err != nil {
		return shopCStatus(err, false)
	}
	shopConstraintInventory.Lock()
	rows := shopConstraintInventory.rows[e]
	if rows == nil {
		rows = make(map[uint32]C.ynx_auth_shop_constraints_v1)
		shopConstraintInventory.rows[e] = rows
	}
	data, found := rows[uint32(index)]
	if !found {
		data.version = 1
		data.size = C.uint32_t(C.sizeof_ynx_auth_shop_constraints_v1)
		data.index = index
		data.total = C.uint32_t(len(d.Selections))
		data.source_epoch = C.uint64_t(s.Epoch)
		values := []string{d.Scope.NetworkID, d.Scope.Account, d.Scope.ProtectedResourceRef, s.Realm, s.Tenant, s.Actor, s.Role, s.StoreID, s.ProductID, s.SourceOrder}
		spans := []*C.ynx_auth_shop_span_v1{&data.network_id, &data.account, &data.protected_resource_ref, &data.realm, &data.tenant, &data.actor, &data.role, &data.store_id, &data.product_id, &data.source_order}
		var buffers []unsafe.Pointer
		for i, v := range values {
			if len(v) == 0 || len(v) > 2048 {
				for _, b := range buffers {
					C.free(b)
				}
				shopConstraintInventory.Unlock()
				return shopCStatus(ErrDenied, false)
			}
			b := C.CBytes([]byte(v))
			if b == nil {
				for _, b := range buffers {
					C.free(b)
				}
				shopConstraintInventory.Unlock()
				return shopCStatus(ErrPending, false)
			}
			buffers = append(buffers, b)
			spans[i].bytes = (*C.uint8_t)(b)
			spans[i].length = C.size_t(len(v))
		}
		rows[uint32(index)] = data
	}
	shopConstraintInventory.Unlock()
	if err := e.owner.Current(e.owner.ctx); err != nil {
		return shopCStatus(err, false)
	}
	*out = data
	return shopCStatus(nil, false)
}

// Called ONLY by actual client_release_closed after active==0 and the real
// Source physicalDone gate. Acquisition failure never publishes constraints.
func releaseOriginalShopConstraintBuffers(e *shopCClient) {
	shopConstraintInventory.Lock()
	defer shopConstraintInventory.Unlock()
	for _, d := range shopConstraintInventory.rows[e] {
		for _, s := range []C.ynx_auth_shop_span_v1{d.network_id, d.account, d.protected_resource_ref, d.realm, d.tenant, d.actor, d.role, d.store_id, d.product_id, d.source_order} {
			if s.bytes != nil {
				C.free(unsafe.Pointer(s.bytes))
			}
		}
	}
	delete(shopConstraintInventory.rows, e)
}
