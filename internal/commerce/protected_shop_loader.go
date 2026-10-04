//go:build commerce_v2

package commerce

import (
	"context"
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"net/http"
	"strings"
)

// OriginalShopFiles names only original protected backend/seal carriers. Empty
// or partial configuration cannot activate a private profile. Current custody
// must independently bind these exact paths/roles, not trust request metadata.
type OriginalShopFiles struct{ BackendKeyID, BackendKeyFile, BrowserSealFile string }

func LoadOriginalShopProfile(ctx context.Context, files OriginalShopFiles, current ShopRuntimeCurrent, buyer, seller CommerceBrowserActorBinder, transport http.RoundTripper) (*PreparedOriginalShop, error) {
	if files.BackendKeyID == "" || strings.TrimSpace(files.BackendKeyID) != files.BackendKeyID || files.BackendKeyFile == "" || files.BrowserSealFile == "" || buyer == nil || seller == nil {
		return nil, ErrOriginalShopCompositionUnavailable
	}
	if err := shopCurrent(ctx, current); err != nil {
		return nil, err
	}
	key, err := v2.LoadBackendEd25519PrivateKey(files.BackendKeyFile)
	if err != nil {
		return nil, err
	}
	defer clear(key)
	if err := shopCurrent(ctx, current); err != nil {
		return nil, err
	}
	seal, err := v2.LoadProtectedBrowserSeal(files.BrowserSealFile)
	if err != nil {
		return nil, err
	}
	defer clear(seal)
	if err := shopCurrent(ctx, current); err != nil {
		return nil, err
	}
	prepared, err := PrepareOriginalShop(ctx, OriginalShopProfile{BackendKeyID: files.BackendKeyID, BackendKey: key, BrowserSeal: seal, Current: current, BuyerActor: buyer, SellerActor: seller, Transport: transport})
	if err != nil {
		return nil, err
	}
	if err := shopCurrent(ctx, current); err != nil {
		clear(prepared.key)
		clear(prepared.seal)
		return nil, err
	}
	return prepared, nil
}
