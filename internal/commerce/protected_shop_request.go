//go:build commerce_v2

package commerce

import (
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"net/http"
)

// Current must be a synchronous local source-custody check safe under the
// original Store lock. No network/renewal/key-loader may be placed here.
func (p *PreparedOriginalShop) bindCurrent(original CommerceBrowserActorBinder) CommerceBrowserActorBinder {
	return func(r *http.Request, s v2.Session, b v2.BrowserGrant, operation string) (func() error, error) {
		if p == nil || r == nil || original == nil {
			return nil, ErrOriginalShopCompositionUnavailable
		}
		if err := shopCurrent(r.Context(), p.current); err != nil {
			return nil, err
		}
		originalFence, err := original(r, s, b, operation)
		if err != nil {
			return nil, err
		}
		if originalFence == nil {
			return nil, ErrOriginalShopCompositionUnavailable
		}
		if err := shopCurrent(r.Context(), p.current); err != nil {
			return nil, err
		}
		return func() error {
			if err := shopCurrent(r.Context(), p.current); err != nil {
				return err
			}
			if err := originalFence(); err != nil {
				return err
			}
			return shopCurrent(r.Context(), p.current)
		}, nil
	}
}

func (p *PreparedOriginalShop) GuardedOriginalHandler(original http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p == nil || original == nil || shopCurrent(r.Context(), p.current) != nil {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("{\"error\":\"SHOP_ORIGINAL_PROTECTED_COMPOSITION_UNAVAILABLE\"}\n"))
			return
		}
		original.ServeHTTP(w, r)
	})
}
