//go:build securelink_openssl && cgo

package native

/*
#include "bridge.h"
*/
import "C"

import (
	"errors"
	"fmt"
	"net"
	"runtime"
	"time"
	"unsafe"
)

// ServerIdentity copies bounded public metadata from this Context's actual
// loaded certificate and existing local verification store. It never reopens
// paths, returns a private key or creates a provider or Source qualification.
// The fixed profile describes local configuration, not a negotiated peer.
//
// The same Context mutex as Close spans the entire native read/copy. A returned
// copy remains owned after Close; it does not extend the Context/listener life
// or establish a current Root, remote peer or authorization decision.
func (c *Context) ServerIdentity() (ServerIdentity, error) {
	if c == nil {
		return ServerIdentity{}, net.ErrClosed
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ptr == nil {
		return ServerIdentity{}, net.ErrClosed
	}
	if !c.cfg.Server {
		return ServerIdentity{}, errors.New("securelink: server identity requires original server context")
	}
	var captured C.ynx_server_identity
	var message [192]C.char
	ok := C.ynx_ctx_server_identity(c.ptr, &captured, &message[0], C.size_t(len(message)))
	runtime.KeepAlive(c)
	if ok != 1 {
		return ServerIdentity{}, fmt.Errorf("securelink: %s", C.GoString(&message[0]))
	}
	if captured.version != 1 || captured.size != C.uint32_t(C.sizeof_ynx_server_identity) ||
		captured.certificate_der_length == 0 || captured.certificate_der_length > C.YNX_SERVER_CERT_DER_MAX ||
		captured.spki_der_length == 0 || captured.spki_der_length > C.YNX_SERVER_SPKI_DER_MAX ||
		captured.dns_count == 0 || captured.dns_count > C.YNX_SERVER_DNS_MAX ||
		captured.not_before >= captured.not_after || captured.server_auth != 1 || captured.mutual != 1 || captured.tickets_off != 1 {
		return ServerIdentity{}, errors.New("securelink: bounded original server identity unavailable")
	}
	identity := ServerIdentity{
		CertificateDER:    C.GoBytes(unsafe.Pointer(&captured.certificate_der[0]), C.int(captured.certificate_der_length)),
		SPKIDER:           C.GoBytes(unsafe.Pointer(&captured.spki_der[0]), C.int(captured.spki_der_length)),
		CertificateSHA256: C.GoString(&captured.certificate_sha256[0]),
		SPKISHA256:        C.GoString(&captured.spki_sha256[0]),
		DNSNames:          make([]string, int(captured.dns_count)),
		NotBefore:         time.Unix(int64(captured.not_before), 0).UTC(),
		NotAfter:          time.Unix(int64(captured.not_after), 0).UTC(),
		RuntimeVersion:    C.GoString(&captured.runtime_version[0]),
		Protocol:          C.GoString(&captured.protocol[0]),
		Group:             C.GoString(&captured.group[0]),
		Cipher:            C.GoString(&captured.cipher[0]),
		Signature:         C.GoString(&captured.signature[0]),
		ServerAuth:        true,
		Mutual:            true,
		TicketsOff:        true,
	}
	for i := range identity.DNSNames {
		identity.DNSNames[i] = C.GoString(&captured.dns_names[i][0])
	}
	return identity, nil
}
