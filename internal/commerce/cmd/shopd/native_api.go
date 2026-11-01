package main

import (
	"encoding/json"
	"net/http"
	"path"
	"strings"
)

// The independent app's existing fixed API origin. This is the original Shop
// Store and original complete Buyer handler, without a Web document dependency.
// No request selects another role, host, Source, platform factory or fallback.
func composeOriginalNativeShopAPI(public, buyer, seller http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Host != "shop-api.ynxweb4.com" || r.URL == nil || (r.URL.Scheme != "" && r.URL.Scheme != "https") || r.URL.RawPath != "" || strings.Contains(r.URL.Path, "\\") || path.Clean(r.URL.Path) != r.URL.Path {
			http.Error(w, "exact original Native API origin/path required", http.StatusBadRequest)
			return
		}
		p := r.URL.Path
		publicRead := r.Method == http.MethodGet && (p == "/health" || p == "/version" || p == "/api/capabilities" || p == "/api/products" || strings.HasPrefix(p, "/api/products/") || strings.HasPrefix(p, "/api/stores/") || p == "/api/catalog/search")
		if !publicRead && (r.URL.RawQuery != "" || r.URL.ForceQuery) {
			http.Error(w, "exact private path required", http.StatusBadRequest)
			return
		}
		if publicRead && public != nil {
			public.ServeHTTP(w, r)
			return
		}
		// Fixed inventory/warehouse CLI surface borrows the original complete
		// Seller handler. Its own protected identity/current/action verification
		// remains mandatory. Never retry a denial through Buyer or legacy auth.
		sellerInventory := r.Method == http.MethodPost && (p == "/api/seller/inventory/batch" || p == "/api/seller/inventory/read" || p == "/api/seller/mutations/lookup")
		if sellerInventory {
			if seller != nil {
				seller.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": "SELLER_ORIGINAL_AUTHORITY_UNAVAILABLE"})
			return
		}
		if strings.HasPrefix(p, "/api/") && !strings.HasPrefix(p, "/api/seller/") && !strings.HasPrefix(p, "/api/auth/") && !strings.HasPrefix(p, "/api/sso/") {
			if buyer != nil {
				buyer.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": "BUYER_ORIGINAL_AUTHORITY_UNAVAILABLE"})
			return
		}
		http.NotFound(w, r)
	})
}
