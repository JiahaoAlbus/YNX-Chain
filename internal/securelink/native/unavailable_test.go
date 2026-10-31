//go:build !securelink_openssl || !cgo

package native

import (
	"errors"
	"testing"
)

func TestLINK01MissingNativeRuntimeFailsClosed(t *testing.T) {
	if context, err := NewContext(Config{PeerSAN: "pay.ynx.test"}); context != nil || !errors.Is(err, ErrUnavailable) {
		t.Fatalf("context=%v err=%v", context, err)
	}
}

func TestLINK01ConnectionIDUnavailableIsZero(t *testing.T) {
	if (&Conn{}).ID() != (ConnectionID{}) {
		t.Fatal("unavailable native endpoint received a valid ID")
	}
}
