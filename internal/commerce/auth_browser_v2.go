//go:build commerce_v2

package commerce

import (
	"crypto/ed25519"
	"errors"
	"net/http"
	"slices"

	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Capture the EXISTING request-entry actor/epoch, exact verified private Session
// and original sealed Browser identity. This is not a new user/account mapping.
// Returned current fence is synchronous and safe inside the original Store lock.
type CommerceBrowserActorBinder func(*http.Request, v2.Session, v2.BrowserGrant, string) (func() error, error)

// Fixed approved Shop Web identity, original Buyer private scopes/operations.
// It does not register Native Browser identity, Merchant or a separate Seller.
// A owns backend/cookie keys, issuer configuration and actual Host mounting.
func NewCommerceCombinedWebV2Server(store *Store, cfg ServerConfig, backendKeyID string, backendKey ed25519.PrivateKey, browserSealKey []byte, transport http.RoundTripper, bind CommerceBrowserActorBinder) (*Server, error) {
	if store == nil || bind == nil {
		return nil, errors.New("complete original Commerce Browser actor composition required")
	}
	if err := validateCommerceBusinessRoutes(); err != nil {
		return nil, err
	}
	browser, err := v2.NewBrowserSSO("shop", "https://wallet-auth.ynxweb4.com", browserSealKey, []string{"overview", "orders", "settings"}, transport)
	if err != nil {
		return nil, err
	}
	policy := v2.Policy{ProductID: "shop", ClientID: ShopClientID, ApplicationID: ShopBundleID + ".web", Platform: "web", Origin: "https://shop.ynxweb4.com", Callback: "https://shop.ynxweb4.com/wallet-auth/callback", AllowedScopes: slices.Clone(ShopScopes)}
	client, err := v2.NewClient("https://wallet-auth.ynxweb4.com", policy, transport)
	if err != nil {
		return nil, err
	}
	live, err := v2.NewPrivateBusinessRevalidator(client, ShopClientID+"-business-web-v1", backendKeyID, backendKey)
	if err != nil {
		return nil, err
	}
	cfg.businessV2 = &commerceV2Verifier{consumers: []commerceV2Consumer{{policy, client, live}}, browser: browser, bindBrowser: bind}
	cfg.browserSSO = browser
	return NewServer(store, cfg), nil
}

// Native Buyer uses the matching protected private backend role and the original
// authenticated native actor fence. It does not borrow a Web Browser identity.
func NewCommerceNativeBuyerV2Server(store *Store, cfg ServerConfig, platform, backendKeyID string, backendKey ed25519.PrivateKey, transport http.RoundTripper, bind CommerceV2ActorBinder) (*Server, error) {
	if store == nil || bind == nil || !slices.Contains([]string{"android", "macos"}, platform) {
		return nil, errors.New("original registered Native Buyer composition required")
	}
	if err := validateCommerceBusinessRoutes(); err != nil {
		return nil, err
	}
	policy := v2.Policy{ProductID: "shop", ClientID: ShopClientID, ApplicationID: ShopBundleID, Platform: platform, Origin: "app://" + platform + "/" + ShopBundleID, Callback: ShopCallback, AllowedScopes: slices.Clone(ShopScopes)}
	identifier := ShopBundleID
	if platform == "android" {
		policy.PackageID = &identifier
	} else {
		policy.BundleID = &identifier
	}
	client, err := v2.NewClient("https://wallet-auth.ynxweb4.com", policy, transport)
	if err != nil {
		return nil, err
	}
	live, err := v2.NewPrivateBusinessRevalidator(client, ShopClientID+"-business-"+platform+"-v1", backendKeyID, backendKey)
	if err != nil {
		return nil, err
	}
	cfg.businessV2 = &commerceV2Verifier{consumers: []commerceV2Consumer{{policy, client, live}}, bind: bind}
	return NewServer(store, cfg), nil
}
