package commerce

import (
	"fmt"
	"net/http"
	"strconv"
)

type PublishListingInput struct {
	ExpectedRevision string
	Product          UpdateProductInput
}

// PublishListing applies pricing/stock and publication in one original Store
// commit. Staging reuses existing role, variant, media and stock checks; no
// intermediate draft update is visible if publication or persistence fails.
func (s *Store) PublishListing(actor, id string, in PublishListingInput) (Product, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.s.Products[id]
	if !ok {
		return Product{}, ErrNotFound
	}
	if err := s.requireSellerPermissionLocked(p.StoreID, actor, permissionCatalogWrite); err != nil {
		return Product{}, err
	}
	route := "listing.publish." + id
	h, replay, err := s.idempotencyLocked(actor, route, in.Product.IdempotencyKey, in)
	if err != nil {
		return Product{}, err
	}
	if replay {
		if h != id {
			return Product{}, ErrConflict
		}
		return cloneProduct(p), nil
	}
	if in.ExpectedRevision == "" || in.ExpectedRevision != strconv.FormatInt(p.Revision, 10) {
		return Product{}, fmt.Errorf("%w: listing revision changed", ErrConflict)
	}
	staged, err := cloneSnapshot(s.s)
	if err != nil {
		return Product{}, err
	}
	tx := &Store{s: staged, now: s.now}
	if _, err = tx.UpdateProduct(actor, id, in.Product); err != nil {
		return Product{}, err
	}
	result, err := tx.PublishProduct(actor, id)
	if err != nil {
		return Product{}, err
	}
	tx.recordIdempotencyLocked(actor, route, in.Product.IdempotencyKey, h, id)
	before := s.s
	s.s = tx.s
	if err = s.persistLocked(); err != nil {
		s.s = before
		return Product{}, err
	}
	return result, nil
}

func (s *Server) publishListing(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in PublishListingInput
	if !decode(w, r, &in) {
		return
	}
	result, err := s.store.PublishListing(actor.Account, r.PathValue("id"), in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, result)
}
