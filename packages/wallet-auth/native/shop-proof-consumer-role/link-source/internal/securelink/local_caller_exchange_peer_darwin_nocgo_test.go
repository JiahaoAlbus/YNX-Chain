//go:build darwin && !cgo

package securelink

import (
	"context"
	"errors"
	"os"
	"testing"
)

func TestOriginalLocalCallerPeerUnavailableWithoutCGO(t *testing.T) {
	// Mandatory-shaped PUBLIC DATA does not make the unavailable kernel port
	// usable. No process/image observation or Root permission is inferred here.
	expected := LocalCallerExpectedProcess{UID: uint32(os.Geteuid()), PID: os.Getpid(), StartKind: LocalCallerDarwinProcessStart, StartA: 1, ImagePath: "/PUBLIC/not-a-qualified-executable", ImageBytes: 1, ImageSHA256: [32]byte{1}}
	p, err := prepareOriginalLocalCallerPeer(context.Background(), expected)
	if p == nil || !errors.Is(err, ErrUnavailable) {
		t.Fatalf("native process port must fail closed without cgo: %v", err)
	}
	if err = p.close(); err != nil || !p.closed() {
		t.Fatalf("unavailable partial still needs real empty cleanup: %v", err)
	}
}
