//go:build !securelink_openssl || !cgo

package native

import (
	"errors"
	"testing"
)

func TestPeerSPKIDERUnavailableFailsClosed(t *testing.T) {
	var nilConn *Conn
	zero := Conn{}
	copied := zero
	for _, endpoint := range []struct {
		name string
		conn *Conn
	}{
		{"nil", nilConn}, {"zero", &zero}, {"value copy", &copied},
	} {
		for attempt := 0; attempt < 2; attempt++ {
			der, err := endpoint.conn.PeerSPKIDER()
			if der != nil || !errors.Is(err, ErrUnavailable) {
				t.Fatalf("unavailable %s getter: bytes=%d err=%v", endpoint.name, len(der), err)
			}
			if err := endpoint.conn.Close(); err != nil {
				t.Fatal(err)
			}
		}
	}
}
