// Package commerceentry mounts the original three Commerce entry points without
// treating a static page, role name or identity session as private authority.
package commerceentry

import (
	"bytes"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

type Inputs struct {
	BuyerDocuments, SellerDocuments           *commerce.Server
	BuyerAssets, SellerAssets, MerchantAssets fs.FS
	// Each input is the original independently composed role-specific handler.
	// A missing handler remains closed. No caller-selected union or fallback.
	Buyer, Seller, Merchant, ShopIdentity http.Handler
	PublicShop                            http.Handler
}

type Handler struct{ in Inputs }

func New(in Inputs) (*Handler, error) {
	if in.BuyerAssets == nil || in.SellerAssets == nil {
		return nil, errors.New("exact Buyer and Seller asset inputs required")
	}
	return &Handler{in}, nil
}
func unavailable(w http.ResponseWriter, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
}
func original(w http.ResponseWriter, r *http.Request, h http.Handler, code string) {
	if h == nil {
		unavailable(w, code)
		return
	}
	h.ServeHTTP(w, r)
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL == nil || r.URL.RawPath != "" || strings.Contains(r.URL.Path, "\\") || path.Clean(r.URL.Path) != strings.TrimSuffix(r.URL.Path, "/") && r.URL.Path != "/" {
		http.Error(w, "exact original path required", 400)
		return
	}
	if r.Host != "shop.ynxweb4.com" && r.Host != "pay.ynxweb4.com" {
		http.Error(w, "original Commerce host required", 400)
		return
	}
	if r.URL.Scheme != "" && r.URL.Scheme != "https" {
		http.Error(w, "original HTTPS origin required", 400)
		return
	}
	p := r.URL.Path
	if r.Host == "pay.ynxweb4.com" {
		if p == "/merchant/wallet-auth/callback" {
			h.asset(w, r, h.in.MerchantAssets, nil, "index.html")
			return
		}
		if strings.HasPrefix(p, "/merchant/") {
			h.asset(w, r, h.in.MerchantAssets, nil, strings.TrimPrefix(p, "/merchant/"))
			return
		}
		if strings.HasPrefix(p, "/v1/") || strings.HasPrefix(p, "/app/pay-product/v1/") {
			original(w, r, h.in.Merchant, "MERCHANT_ORIGINAL_AUTHORITY_UNAVAILABLE")
			return
		}
		http.NotFound(w, r)
		return
	}
	if p == "/wallet-auth/callback" || p == "/" {
		h.asset(w, r, h.in.BuyerAssets, h.in.BuyerDocuments, "index.html")
		return
	}
	if strings.HasPrefix(p, "/shop/") {
		h.asset(w, r, h.in.BuyerAssets, h.in.BuyerDocuments, strings.TrimPrefix(p, "/shop/"))
		return
	}
	if strings.HasPrefix(p, "/seller/") {
		h.asset(w, r, h.in.SellerAssets, h.in.SellerDocuments, strings.TrimPrefix(p, "/seller/"))
		return
	}
	if p == "/sso/start" || p == "/sso/callback" || p == "/api/sso/account" || p == "/api/sso/logout" {
		method := http.MethodGet
		if p == "/api/sso/logout" {
			method = http.MethodPost
		}
		if r.Method != method {
			http.Error(w, "original identity method required", 405)
			return
		}
		original(w, r, h.in.ShopIdentity, "SHOP_ORIGINAL_IDENTITY_UNAVAILABLE")
		return
	}
	if strings.HasPrefix(p, "/api/seller/") {
		original(w, r, h.in.Seller, "SELLER_ORIGINAL_AUTHORITY_UNAVAILABLE")
		return
	}
	if publicShopRead(r) {
		original(w, r, h.in.PublicShop, "SHOP_PUBLIC_ENGINE_UNAVAILABLE")
		return
	}
	if strings.HasPrefix(p, "/api/") {
		original(w, r, h.in.Buyer, "BUYER_ORIGINAL_AUTHORITY_UNAVAILABLE")
		return
	}
	http.NotFound(w, r)
}
func publicShopRead(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	p := r.URL.Path
	return p == "/health" || p == "/version" || p == "/api/products" || strings.HasPrefix(p, "/api/products/") || strings.HasPrefix(p, "/api/stores/") || p == "/api/capabilities" || p == "/api/auth/config"
}
func (h *Handler) asset(w http.ResponseWriter, r *http.Request, assets fs.FS, documents *commerce.Server, name string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "static method required", 405)
		return
	}
	if assets == nil {
		unavailable(w, "ORIGINAL_ASSET_BUILD_UNAVAILABLE")
		return
	}
	if name == "" {
		name = "index.html"
	}
	if !fs.ValidPath(name) || strings.HasPrefix(name, ".") || strings.Contains(name, "/.") {
		http.NotFound(w, r)
		return
	}
	info, err := fs.Stat(assets, name)
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	// A dedicated asset-only FS must be supplied. The original URL/query is never
	// rewritten or redirected: the exact Wallet callback remains browser-visible.
	policy := "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: https:"
	if documents != nil {
		policy = documents.OriginalCommerceDocumentPolicy()
	}
	const combined = "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self' https://wallet-auth.ynxweb4.com; img-src 'self' data: https:"
	const legacy = "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: https:"
	if policy != legacy && policy != combined {
		unavailable(w, "ORIGINAL_DOCUMENT_POLICY_UNAVAILABLE")
		return
	}
	w.Header().Set("Content-Security-Policy", policy)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	file, err := assets.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	const limit = 64 << 20
	if info.Size() < 0 || info.Size() > limit {
		unavailable(w, "ORIGINAL_ASSET_SIZE_UNAVAILABLE")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(data)) != info.Size() || len(data) > limit {
		unavailable(w, "ORIGINAL_ASSET_READ_UNAVAILABLE")
		return
	}
	// ServeContent avoids FileServer's index.html redirect, which would otherwise
	// discard the approved callback path or shift it to an unapproved directory.
	http.ServeContent(w, r, name, info.ModTime(), bytes.NewReader(data))
}
