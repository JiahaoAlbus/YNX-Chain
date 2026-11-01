package commerce

import (
	"net/http"
	"strconv"
)

type NativeListingVariant struct{ ID, Name, SKU, PriceYNXT, Inventory, Reserved string }
type NativeListingVariantInput struct{ ID, Name, SKU, PriceYNXT, Inventory string }
type NativeListingInput struct {
	StoreID, ExpectedRevision, Title, Description, Category, IdempotencyKey string
	Media                                                                   []MediaAsset
	Variants                                                                []NativeListingVariantInput
}
type NativeListingView struct {
	ID, StoreID, Revision, Title, Description, Category string
	Published                                           bool
	Media                                               []MediaAsset
	Variants                                            []NativeListingVariant
}
type NativeListingResult struct {
	Product                    NativeListingView
	OriginalApplied, QueryOnly bool
}

func nativeListingOriginal(in NativeListingInput) (PublishListingInput, error) {
	var out PublishListingInput
	if !invoiceRecoveryID.MatchString(in.StoreID) || len(in.Variants) < 1 || len(in.Variants) > 50 {
		return out, ErrInvalidState
	}
	if _, err := inventoryOperand(in.ExpectedRevision); err != nil {
		return out, err
	}
	out.ExpectedRevision = in.ExpectedRevision
	out.ExpectedStoreID = in.StoreID
	out.Product = UpdateProductInput{Title: in.Title, Description: in.Description, Category: in.Category, Media: append([]MediaAsset{}, in.Media...), IdempotencyKey: in.IdempotencyKey}
	for _, row := range in.Variants {
		price, err := inventoryOperand(row.PriceYNXT)
		if err != nil || price < 1 {
			return PublishListingInput{}, ErrInvalidState
		}
		inventory, err := inventoryOperand(row.Inventory)
		if err != nil {
			return PublishListingInput{}, err
		}
		if row.ID != "" && !invoiceRecoveryID.MatchString(row.ID) {
			return PublishListingInput{}, ErrInvalidState
		}
		out.Product.Variants = append(out.Product.Variants, Variant{ID: row.ID, Name: row.Name, SKU: row.SKU, PriceYNXT: price, Inventory: inventory})
	}
	return out, nil
}
func nativeListingView(p Product, applied, query bool) NativeListingResult {
	view := NativeListingView{ID: p.ID, StoreID: p.StoreID, Revision: strconv.FormatInt(p.Revision, 10), Title: p.Title, Description: p.Description, Category: p.Category, Published: p.Published, Media: append([]MediaAsset{}, p.Media...), Variants: []NativeListingVariant{}}
	for _, v := range p.Variants {
		view.Variants = append(view.Variants, NativeListingVariant{v.ID, v.Name, v.SKU, strconv.FormatInt(v.PriceYNXT, 10), strconv.FormatInt(v.Inventory, 10), strconv.FormatInt(v.Reserved, 10)})
	}
	return NativeListingResult{view, applied, query}
}
func (s *Store) ReadNativeListing(actor, store, id string) (NativeListingResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.s.Products[id]
	if !ok {
		return NativeListingResult{}, ErrNotFound
	}
	if err := s.requireSellerPermissionLocked(p.StoreID, actor, permissionSellerRead); err != nil {
		return NativeListingResult{}, err
	}
	if p.StoreID != store {
		return NativeListingResult{}, ErrConflict
	}
	return nativeListingView(p, false, true), nil
}
func (s *Server) readNativeListing(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in struct{ StoreID, ProductID string }
	if !decode(w, r, &in) {
		return
	}
	result, err := s.store.ReadNativeListing(actor.Account, in.StoreID, in.ProductID)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, result)
}
func (s *Server) publishNativeListing(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in NativeListingInput
	if !decode(w, r, &in) {
		return
	}
	original, err := nativeListingOriginal(in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	product, err := s.store.PublishListing(actor.Account, r.PathValue("id"), original)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, nativeListingView(product, true, false))
}
