//go:build !securelink_openssl || !cgo

package native

// PeerSPKIDER cannot return peer DATA without the pinned native TLS runtime.
func (*Conn) PeerSPKIDER() ([]byte, error) { return nil, ErrUnavailable }
