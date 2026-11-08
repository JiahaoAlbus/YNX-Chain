//go:build darwin || linux

package aiproduct

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"

	tasklocal "github.com/JiahaoAlbus/YNX-Chain/internal/authtasklocal"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
)

var _ originalTaskReadReceiverRegistration = (*tasklocal.Owner)(nil)

// Exercise the actual zero-input original owner, not a registration provider.
// No real Source/receiver-purpose selection or Root row is installed here.
func TestP08ActualAuthReceiverMissingSelectionCannotMount(t *testing.T) {
	local, openErr := tasklocal.OpenOriginalLocalTaskGrantSource()
	if local == nil || openErr == nil {
		if local != nil {
			_ = local.Close()
		}
		t.Fatal("expected original missing Source partial, no production admission")
	}
	t.Cleanup(func() {
		if err := local.Close(); err != nil {
			t.Error(err)
		}
	})
	socket, cfg, err := local.ReadOriginalTaskReadReceiverRegistration(context.Background())
	if !errors.Is(err, native.ErrTaskReadReceiverNotSupplied) || socket != "" || cfg.Handler != nil || len(cfg.Routes) != 0 || cfg.Service != "" {
		t.Fatalf("missing independent receiver became configuration: %q %+v %v", socket, cfg, err)
	}
	if current := local.AssertOriginalTaskReadReceiverCurrent(context.Background()); current != err {
		t.Fatal("receiver first cause was lost")
	}
	if local.Current(context.Background()) != openErr {
		t.Fatal("receiver missing changed original grant first cause")
	}
	resource, _, _ := taskResourceFixture(t)
	before, readErr := os.ReadFile(resource.store.path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	mounted, mountErr := openOriginalTaskReadReceiver(context.Background(), &OriginalTaskReadReceiver{resource: resource, done: make(chan struct{})}, local)
	if mounted == nil || mountErr != err || mounted.listener != nil || mounted.server != nil || mounted.started {
		t.Fatal("actual missing receiver selection opened a transport")
	}
	p08CloseReadReceiver(t, mounted)
	after, readErr := os.ReadFile(resource.store.path)
	if readErr != nil || !bytes.Equal(before, after) {
		t.Fatal("receiver refusal touched Store")
	}
	if local.Current(context.Background()) != openErr {
		t.Fatal("P08 retired borrowed Auth parent")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := local.AssertOriginalTaskReadReceiverCurrent(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled caller was not rejected")
	}
	if local.AssertOriginalTaskReadReceiverCurrent(context.Background()) != err {
		t.Fatal("request cancellation replaced receiver first cause")
	}
	if err := local.Retire(); err != nil {
		t.Fatal(err)
	}
	if err := local.Join(); err != nil {
		t.Fatal(err)
	}
	if err := local.AssertOriginalTaskReadReceiverCurrent(context.Background()); !errors.Is(err, native.ErrRetired) {
		t.Fatal("retired receiver remained usable")
	}
}
