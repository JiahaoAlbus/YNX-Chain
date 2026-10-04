//go:build commerce_v2

package commerce

import (
	"crypto/ed25519"
	"errors"
	"net/http"
	"slices"

	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// NewCommerceCombinedSellerWebV2Server is a Seller capability of the ORIGINAL
// Shop identity and private client. It never uses the retired seller client or
// callback, never upgrades a Buyer grant, and never assigns store membership.
// The existing transaction checks the current original Seller role/object.
// Protected backend admission and new explicit two-scope Wallet consent are
// still required at the authority; constructor success is not enrollment.
func NewCommerceCombinedSellerWebV2Server(store *Store, cfg ServerConfig, backendKeyID string, backendKey ed25519.PrivateKey, browserSealKey []byte, transport http.RoundTripper, bind CommerceBrowserActorBinder) (*Server, error) {
	if store == nil || bind == nil {
		return nil, errors.New("complete original Shop Seller Browser actor composition required")
	}
	if err := validateCommerceBusinessRoutes(); err != nil {
		return nil, err
	}
	browser, err := v2.NewBrowserSSO("shop", "https://wallet-auth.ynxweb4.com", browserSealKey, []string{"overview", "orders", "settings"}, transport)
	if err != nil {
		return nil, err
	}
	policy := v2.Policy{ProductID: "shop", ClientID: ShopClientID, ApplicationID: ShopBundleID + ".web", Platform: "web", Origin: "https://shop.ynxweb4.com", Callback: "https://shop.ynxweb4.com/wallet-auth/callback", AllowedScopes: slices.Clone(SellerScopes)}
	client, err := v2.NewClient("https://wallet-auth.ynxweb4.com", policy, transport)
	if err != nil {
		return nil, err
	}
	live, err := v2.NewPrivateBusinessRevalidator(client, ShopClientID+"-business-web-v1", backendKeyID, backendKey)
	if err != nil {
		return nil, err
	}
	cfg.businessV2 = &commerceV2Verifier{consumers: []commerceV2Consumer{{policy, client, live}}, browser: browser, bindBrowser: bind}
	cfg.browserGatewayOrigin = "https://wallet-auth.ynxweb4.com"
	cfg.browserSSO = browser
	return NewServer(store, cfg), nil
}
