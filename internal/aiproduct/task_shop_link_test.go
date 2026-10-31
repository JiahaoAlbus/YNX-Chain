package aiproduct

import (
	"context"
	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"net/http"
	"testing"
	policy "ynx.local/authgrantpolicy"
)

func TestP08ActualLinkShopProfileAndNoQueryFallback(t *testing.T) {
	target := policy.Sink{Service: "PUBLIC-shop", Origin: "https://PUBLIC-shop.invalid", Path: shopOrderToolPath, Operation: shopOrderToolID}
	profile := link.FixedPeerProfile{Service: target.Service, Origin: target.Origin, Operations: []link.ServiceOperation{{ID: shopOrderToolID, Method: http.MethodPost, Path: shopOrderToolPath, MediaProfile: link.MediaProfileShopOrderReadV1, MaxRequestBytes: 1 << 20, MaxResponseBytes: 1 << 20}}}
	if err := checkOriginalShopLinkProfile(profile, target); err != nil {
		t.Fatal(err)
	}
	profile.Operations[0].MediaProfile = link.MediaProfileJSONCBOR
	if err := checkOriginalShopLinkProfile(profile, target); err == nil {
		t.Fatal("legacy MIME profile admitted E5")
	}
	if _, err := prepareOriginalShopLinkCaller(context.Background(), nil, OriginalShopOrderProfile{Target: target}, nil); err == nil {
		t.Fatal("unconfigured actual client admitted")
	}
	var caller *originalShopLinkCaller
	if _, err := caller.QueryShopOrderRead(context.Background(), target, OriginalShopOrderCall{}); err == nil {
		t.Fatal("missing original query authority became a Shop POST")
	}
}
