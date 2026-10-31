//go:build darwin || linux

package commerce

import (
	"context"
	"errors"
	"testing"

	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	authgrant "ynx.local/authgrantpolicy"
)

func TestShopTaskOrderNativeZeroFactoryCannotAdmitSource(t *testing.T) {
	prepared, err := OpenOriginalShopTaskOrders(context.Background(), nil, nil, authgrant.Sink{}, "shop.order")
	if prepared != nil || !errors.Is(err, native.ErrUnavailable) {
		t.Fatal("normal factory manufactured original Source", prepared, err)
	}
	if err := prepared.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestShopTaskOrderNativeCancelledStartupPreservesCause(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	prepared, err := OpenOriginalShopTaskOrders(ctx, nil, nil, authgrant.Sink{}, "shop.order")
	if prepared != nil || !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled startup lost original cause", err)
	}
}
