package commerce

import (
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// CatalogSKU contains public listing facts only. Money/counts remain decimal
// strings; product/variant IDs refer to the existing catalog, not SDK refs.
type CatalogSKU struct {
	ProductID       string `json:"productId"`
	VariantID       string `json:"variantId"`
	StoreID         string `json:"storeId"`
	Title           string `json:"title"`
	VariantName     string `json:"variantName"`
	Category        string `json:"category"`
	Currency        string `json:"currency"`
	PriceYNXT       string `json:"priceYNXT"`
	Available       string `json:"available"`
	ProductRevision string `json:"productRevision"`
}

type CatalogPage struct {
	Items      []CatalogSKU `json:"items"`
	NextCursor string       `json:"nextCursor,omitempty"`
}

type catalogCursor struct {
	Fingerprint string `json:"fingerprint"`
	Product     string `json:"product"`
	Variant     string `json:"variant"`
}

// SearchCatalog uses a deterministic SKU order and a content-bound cursor.
// If any matching visible listing changes, continuation fails rather than
// silently mixing prices/stock from different pages. Checkout still freezes
// actual current terms in CreateOrder, never the search response.
func (s *Store) SearchCatalog(text, category, cursor string, limit int) (CatalogPage, error) {
	if len(text) > 256 || len(category) > 80 || len(cursor) > 2048 || limit < 1 || limit > 100 {
		return CatalogPage{}, fmt.Errorf("%w: catalog search bounds", ErrInvalidState)
	}
	text = strings.ToLower(strings.TrimSpace(text))
	category = strings.TrimSpace(category)
	s.mu.Lock()
	defer s.mu.Unlock()
	items := []CatalogSKU{}
	for _, p := range s.s.Products {
		if !p.Published || s.s.Stores[p.StoreID].Status != "active" || (category != "" && p.Category != category) {
			continue
		}
		if text != "" && !strings.Contains(strings.ToLower(p.Title+" "+p.Description), text) {
			continue
		}
		seen := make(map[string]int, len(p.Variants))
		for _, v := range p.Variants {
			seen[v.ID]++
		}
		for _, v := range p.Variants {
			if v.ID == "" || seen[v.ID] != 1 || v.PriceYNXT <= 0 || v.Reserved < 0 || v.Inventory <= v.Reserved {
				continue
			}
			items = append(items, CatalogSKU{ProductID: p.ID, VariantID: v.ID, StoreID: p.StoreID, Title: p.Title, VariantName: v.Name, Category: p.Category, Currency: NativeSymbol, PriceYNXT: strconv.FormatInt(v.PriceYNXT, 10), Available: strconv.FormatInt(v.Inventory-v.Reserved, 10), ProductRevision: strconv.FormatInt(p.Revision, 10)})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ProductID == items[j].ProductID {
			return items[i].VariantID < items[j].VariantID
		}
		return items[i].ProductID < items[j].ProductID
	})
	raw, err := json.Marshal(struct {
		Text, Category string
		Items          []CatalogSKU
	}{text, category, items})
	if err != nil {
		return CatalogPage{}, err
	}
	hash := sha512.Sum512(raw)
	fingerprint := hex.EncodeToString(hash[:])
	start := 0
	if cursor != "" {
		encoded, err := base64.RawURLEncoding.Strict().DecodeString(cursor)
		if err != nil {
			return CatalogPage{}, fmt.Errorf("%w: invalid catalog cursor", ErrInvalidState)
		}
		var c catalogCursor
		if err = json.Unmarshal(encoded, &c); err != nil || c.Product == "" || c.Variant == "" {
			return CatalogPage{}, fmt.Errorf("%w: invalid catalog cursor", ErrInvalidState)
		}
		if c.Fingerprint != fingerprint {
			return CatalogPage{}, fmt.Errorf("%w: catalog changed; restart search", ErrConflict)
		}
		found := false
		for i, item := range items {
			if item.ProductID == c.Product && item.VariantID == c.Variant {
				start = i + 1
				found = true
				break
			}
		}
		if !found {
			return CatalogPage{}, fmt.Errorf("%w: catalog cursor boundary missing", ErrConflict)
		}
	}
	end := start + limit
	if end > len(items) {
		end = len(items)
	}
	page := CatalogPage{Items: items[start:end]}
	if end < len(items) {
		last := items[end-1]
		raw, _ := json.Marshal(catalogCursor{fingerprint, last.ProductID, last.VariantID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return page, nil
}

func (s *Server) searchCatalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	query := r.URL.Query()
	limit := 25
	if value := query.Get("limit"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil {
			fail(w, 400, fmt.Errorf("invalid catalog limit"))
			return
		}
		limit = n
	}
	page, err := s.store.SearchCatalog(query.Get("q"), query.Get("category"), query.Get("cursor"), limit)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, page)
}
