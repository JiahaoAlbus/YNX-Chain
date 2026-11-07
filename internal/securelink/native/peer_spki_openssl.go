//go:build securelink_openssl && cgo

package native

/*
#include "bridge.h"
*/
import "C"

import (
	"fmt"
	"net"
	"runtime"
	"unsafe"
)

const maxPeerSPKIDER = int(C.YNX_PEER_SPKI_DER_MAX)

// PeerSPKIDER copies the peer certificate's complete SubjectPublicKeyInfo DER
// from this held SSL endpoint. The returned public bytes are independently
// owned DATA, not a pin, target, DEVICE/Source permission, or current decision.
//
// The SSL mutex prevents concurrent SSL free. Close first closes its transport
// and then takes this mutex, so a successful copy cannot prove that transport
// closure has not started or that a remote peer/Source remains current. The
// original sender must separately recheck its actual target/pin/Source before
// writing; this getter does not extend a TLS or authority lifetime.
func (c *Conn) PeerSPKIDER() ([]byte, error) {
	if c == nil || c.connection == nil {
		return nil, net.ErrClosed
	}
	out := make([]byte, maxPeerSPKIDER)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.ptr == nil || !c.state.Verified {
		return nil, net.ErrClosed
	}
	var length C.size_t
	var message [160]C.char
	ok := C.ynx_peer_spki_der(c.ptr, (*C.uchar)(unsafe.Pointer(&out[0])), C.size_t(len(out)),
		&length, &message[0], C.size_t(len(message)))
	runtime.KeepAlive(c)
	if ok != 1 || length == 0 || length > C.size_t(len(out)) {
		return nil, fmt.Errorf("securelink: %s", C.GoString(&message[0]))
	}
	return out[:int(length):int(length)], nil
}
