//go:build !securelink_openssl || !cgo

package native

import (
	"errors"
	"reflect"
	"testing"
)

func TestServerIdentityUnavailableFailsClosed(t *testing.T) {
	for _, ctx := range []*Context{nil, {}} {
		identity, err := ctx.ServerIdentity()
		if !errors.Is(err, ErrUnavailable) || !reflect.DeepEqual(identity, ServerIdentity{}) {
			t.Fatal("unavailable native server identity supplied public DATA", err)
		}
	}
	if ctx, err := NewServerContextFromFDs(1, 2, 3, "PUBLIC.peer.test", "PUBLIC-no-runtime"); ctx != nil || !errors.Is(err, ErrUnavailable) {
		t.Fatal("unavailable FD constructor supplied a native context", err)
	}
	cause := errors.New("PUBLIC close outcome unknown")
	var typed *ServerContextFDCleanupError
	err := &ServerContextFDCleanupError{CertificateFD: -1, PrivateKeyFD: -1, CAFD: 19, CloseUnknown: 4, Cause: cause}
	if !errors.As(err, &typed) || !errors.Is(err, cause) || typed.CAFD != 19 || typed.CloseUnknown != 4 {
		t.Fatal("typed duplicate-close uncertainty lost its original diagnostic")
	}
}
