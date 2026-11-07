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
		parts := strings.Split(p, "/")
		warehouseMutation := len(parts) == 5 && parts[1] == "api" && parts[2] == "orders" && parts[3] != "" && (parts[4] == "return-receipts" || parts[4] == "return-restock")
		warehouseRead := len(parts) == 6 && parts[1] == "api" && parts[2] == "seller" && parts[3] == "orders" && parts[4] != "" && parts[5] == "warehouse"
		publicRead := r.Method == http.MethodGet && (p == "/health" || p == "/version" || p == "/api/capabilities" || p == "/api/products" || strings.HasPrefix(p, "/api/products/") || strings.HasPrefix(p, "/api/stores/") || p == "/api/catalog/search")
		if !publicRead && (r.URL.RawQuery != "" || r.URL.ForceQuery) {
			http.Error(w, "exact private path required", http.StatusBadRequest)
			return
		}
		// Callback admission is an independent Pay HMAC domain. The public
		// handler refuses503 unless its original merchant receiver is supplied.
		if r.Method == http.MethodPost && p == "/api/pay/notifications/native" && public != nil {
			public.ServeHTTP(w, r)
			return
		}
		if publicRead && public != nil {
			public.ServeHTTP(w, r)
			return
		}
		// Fixed inventory/warehouse CLI surface borrows the original complete
		// Seller handler. Its own protected identity/current/action verification
		// remains mandatory. Never retry a denial through Buyer or legacy auth.
		nativeListing := len(parts) == 6 && parts[1] == "api" && parts[2] == "seller" && parts[3] == "products" && parts[4] != "" && parts[5] == "native-listing"
		sellerInventory := originalNativeSellerRoute(r.Method, p, parts) || (r.Method == http.MethodPost && (nativeListing || warehouseMutation || warehouseRead))
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

// This is dispatch only, never authorization. Role-separated paths preserve the
// exact signed method/path and borrow the original complete Seller verifier.
func originalNativeSellerRoute(method, p string, parts []string) bool {
	if method == http.MethodGet {
		switch p {
		case "/api/seller/stores", "/api/seller/products", "/api/seller/audit", "/api/seller/settlements", "/api/seller/invitations", "/api/seller/orders":
			return true
		}
		return (len(parts) == 6 && parts[1] == "api" && parts[2] == "seller" && parts[3] == "stores" && parts[4] != "" && parts[5] == "roles") || (len(parts) == 5 && parts[1] == "api" && parts[2] == "seller" && parts[3] == "orders" && parts[4] != "")
	}
	if method != http.MethodPost {
		return false
	}
	switch p {
	case "/api/seller/stores", "/api/seller/products", "/api/seller/mutations/lookup", "/api/seller/listing/read", "/api/seller/inventory/batch", "/api/seller/inventory/read":
		return true
	}
	if len(parts) < 6 || parts[1] != "api" || parts[2] != "seller" || parts[4] == "" {
		return false
	}
	if len(parts) == 6 {
		switch parts[3] {
		case "stores":
			return parts[5] == "native-activate" || parts[5] == "native-invitations" || parts[5] == "native-profile"
		case "products":
			return parts[5] == "native-listing" || parts[5] == "listing" || parts[5] == "unpublish"
		case "orders":
			return parts[5] == "transition" || parts[5] == "warehouse"
		}
	}
	return len(parts) == 8 && parts[3] == "stores" && parts[6] != "" && ((parts[5] == "roles" && parts[7] == "native-revoke") || (parts[5] == "invitations" && (parts[7] == "native-accept" || parts[7] == "native-cancel")))
}
