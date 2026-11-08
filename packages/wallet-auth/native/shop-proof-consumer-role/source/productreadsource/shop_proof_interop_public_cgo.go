//go:build shop_proof_interop_public && cgo && (darwin || linux)

package productreadsource

/*
#cgo CXXFLAGS: -std=c++17 -DYNX_SHOP_PROOF_INTEROP_PUBLIC=1
#cgo darwin LDFLAGS: -lc++
#cgo linux LDFLAGS: -lstdc++
#include <stdlib.h>
#include "shop_proof_interop_public.h"
*/
import "C"
import "unsafe"

type publicProofStatus struct {
	Present, Unknown, Done bool
	Code                   int32
}

func publicProofStatusDATA(s C.ynx_auth_shop_status_v1) publicProofStatus {
	return publicProofStatus{s.error_present != 0, s.unknown != 0, s.physical_done != 0, int32(s.first_code)}
}

type publicProtectedRead struct {
	client   *C.ynx_auth_shop_original_client_v1
	packet   *C.ynx_auth_shop_original_response_v1
	original *ShopOriginalResponse
	status   publicProofStatus
}

// PUBLIC fixture assembly into the actual private C inventory. This does not
// call the normal Root-empty acquisition or install a production registration.
func publicReadThroughProofCgo(c *ShopPrivateClient, header string) *publicProtectedRead {
	p, e := reserveShopClient()
	if e == nil {
		panic("PUBLIC reserve client")
	}
	e.owner = c
	id := C.CBytes([]byte("order-001"))
	defer C.free(id)
	h := C.CBytes([]byte(header))
	defer C.free(h)
	r := &publicProtectedRead{client: p}
	r.status = publicProofStatusDATA(C.public_shop_proof_read(p, (*C.uint8_t)(id), 9, (*C.uint8_t)(h), C.size_t(len(header)), &r.packet))
	if r.packet != nil {
		shopCInventory.Lock()
		entry := shopCInventory.responses[unsafe.Pointer(r.packet)]
		shopCInventory.Unlock()
		if entry != nil {
			entry.mu.Lock()
			r.original = entry.owner
			entry.mu.Unlock()
		}
	}
	return r
}
func publicReleaseThroughProofCgo(r *publicProtectedRead) (publicProofStatus, publicProofStatus) {
	transport := publicProofStatus{Done: true}
	if r.packet != nil {
		transport = publicProofStatusDATA(ynx_auth_shop_original_response_release_v1(r.packet))
	}
	if !transport.Done {
		return transport, publicProofStatus{}
	}
	return transport, publicProofStatusDATA(C.public_shop_proof_close())
}
func publicCloseProofClient(r *publicProtectedRead) publicProofStatus {
	_ = ynx_auth_shop_original_client_retire_v1(r.client)
	_ = ynx_auth_shop_original_client_join_v1(r.client, 1000)
	closed := ynx_auth_shop_original_client_close_v1(r.client)
	if closed.physical_done != 0 {
		_ = ynx_auth_shop_original_client_release_closed_v1(r.client)
	}
	return publicProofStatusDATA(closed)
}
func publicRevokeOriginalProof() { C.public_shop_proof_revoke() }
func publicOriginalProofCloseCounts() [3]uint32 {
	var out [3]C.uint32_t
	C.public_shop_proof_counts(&out[0])
	return [3]uint32{uint32(out[0]), uint32(out[1]), uint32(out[2])}
}
