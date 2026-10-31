package aiproduct

import (
	"context"
	"errors"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	"testing"
)

func TestP08ActualNativeRuntimeCallee(t *testing.T) {
	owner, err := OpenOriginalTaskAuthority()
	if owner != nil {
		defer owner.retireAndClose()
	}
	if !errors.Is(err, native.ErrUnavailable) || owner != nil {
		t.Fatalf("empty original release acquired authority: %v", err)
	}
	var absent *nativeTaskRuntimeAuthority
	if err = absent.Current(context.Background()); !errors.Is(err, native.ErrUnavailable) {
		t.Fatal(err)
	}
	if _, err = absent.queryOriginalTaskOperation(context.Background(), OriginalTaskAuthorizationRequest{QueryOriginal: true}); !errors.Is(err, native.ErrUnavailable) {
		t.Fatal(err)
	}
	if err = absent.retireAndClose(); err != nil {
		t.Fatal(err)
	}
}
