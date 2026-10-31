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

func TestShopTaskOrderSDKBootstrapUsesOriginalZeroSource(t *testing.T) {
	_, call, encoder := publicShopSDKRequest(t)
	channels := &publicShopOuterChannel{}
	_, _, _, response, _, _ := publicShopTaskFixture(t)
	prepared, err := OpenOriginalShopTaskOrdersSDK(context.Background(), encoder, channels, response, call.Binding.Target, call.Binding.Resources[0].Kind)
	if prepared != nil || !errors.Is(err, native.ErrUnavailable) || channels.checks != 0 {
		t.Fatal("actual bootstrap replaced empty original Source with PUBLIC operands", err)
	}
	for _, absent := range []string{"final-frame", "outer-source"} {
		var frame OriginalShopTaskOrderResponseEncoder = encoder
		var outer OriginalShopTaskOrderOuterChannelAuthority = channels
		if absent == "final-frame" {
			frame = nil
		} else {
			outer = nil
		}
		codec, err := PrepareOriginalShopTaskOrderSDKCodec(context.Background(), frame, outer, call.Binding.Target, call.Binding.Resources[0].Kind)
		if codec != nil || err == nil {
			t.Fatal("missing original operand prepared", absent, err)
		}
	}
}
