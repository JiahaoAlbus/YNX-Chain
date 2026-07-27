package commerce

import (
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func (s *Store) Profile(actor string) BuyerProfile {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.s.BuyerProfiles[actor]
	p.Account = actor
	return p
}
func (s *Store) SaveProfile(actor, displayName string, addresses []Address) (BuyerProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(displayName) > 80 || len(addresses) > 10 {
		return BuyerProfile{}, errors.New("profile exceeds limits")
	}
	for _, a := range addresses {
		if a.Recipient == "" || a.Line1 == "" || a.Country == "" || len(a.Recipient) > 120 || len(a.Line1) > 240 || len(a.City) > 120 || len(a.Region) > 120 || len(a.PostalCode) > 40 || len(a.Country) > 80 {
			return BuyerProfile{}, errors.New("address recipient, line and country required")
		}
	}
	p := BuyerProfile{Account: actor, DisplayName: strings.TrimSpace(displayName), Addresses: addresses, UpdatedAt: s.now()}
	s.s.BuyerProfiles[actor] = p
	s.auditLocked(actor, "buyer", "profile_updated", "profile", actor, "approved", "address count stored: "+strconv.Itoa(len(addresses)))
	if err := s.persistLocked(); err != nil {
		return BuyerProfile{}, err
	}
	return p, nil
}
func (s *Store) Cart(actor string) Cart {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.s.Carts[actor]
	c.Buyer = actor
	return c
}
func (s *Store) SaveCart(actor string, items []CartItem) (Cart, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(items) > 50 {
		return Cart{}, errors.New("cart exceeds 50 lines")
	}
	for _, item := range items {
		if item.ProductID == "" || item.VariantID == "" || item.Quantity < 1 || item.Quantity > 20 {
			return Cart{}, errors.New("invalid cart item")
		}
		p, ok := s.s.Products[item.ProductID]
		if !ok || !p.Published {
			return Cart{}, ErrNotFound
		}
		found := false
		for _, v := range p.Variants {
			if v.ID == item.VariantID {
				found = true
			}
		}
		if !found {
			return Cart{}, ErrNotFound
		}
	}
	c := Cart{Buyer: actor, Items: items, UpdatedAt: s.now()}
	s.s.Carts[actor] = c
	s.auditLocked(actor, "buyer", "cart_saved", "cart", actor, "approved", "persistent cart updated")
	if err := s.persistLocked(); err != nil {
		return Cart{}, err
	}
	return c, nil
}

type StoreUpdate struct{ Name, Description, Policy, TrustURL, SettlementAccount string }

func (s *Store) UpdateStore(actor, id string, in StoreUpdate) (StoreProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.s.Stores[id]
	if !ok {
		return StoreProfile{}, ErrNotFound
	}
	if err := s.requireSellerLocked(id, actor, SellerRoleOwner); err != nil {
		return StoreProfile{}, err
	}
	if err := validateStoreFields(in.Name, in.Description, in.Policy, in.TrustURL, in.SettlementAccount); err != nil {
		return StoreProfile{}, err
	}
	st.Name = in.Name
	st.Description = in.Description
	st.Policy = in.Policy
	st.TrustURL = in.TrustURL
	st.SettlementAccount = in.SettlementAccount
	st.UpdatedAt = s.now()
	s.s.Stores[id] = st
	s.auditLocked(actor, "seller", "store_profile_policy_updated", "store", id, "approved", "explicit owner action")
	if err := s.persistLocked(); err != nil {
		return StoreProfile{}, err
	}
	return st, nil
}
func (s *Store) SellerStores(actor string) []StoreProfile {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []StoreProfile{}
	for id := range s.s.SellerRoles {
		role, ok := s.sellerRoleLocked(id, actor)
		if ok && sellerRoleAllows(role, permissionSellerRead) {
			out = append(out, s.s.Stores[id])
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

func (s *Store) PublicStore(id string) (PublicStore, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	store, ok := s.s.Stores[id]
	if !ok || store.Status != "active" {
		return PublicStore{}, ErrNotFound
	}
	return PublicStore{ID: store.ID, Name: store.Name, Description: store.Description, Policy: store.Policy, TrustURL: store.TrustURL, Status: store.Status}, nil
}

func (s *Store) SellerProducts(actor, storeID string) ([]Product, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerPermissionLocked(storeID, actor, permissionSellerRead); err != nil {
		return nil, err
	}
	out := []Product{}
	for _, product := range s.s.Products {
		if product.StoreID == storeID {
			out = append(out, product)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}
func (s *Store) SetSellerRole(actor, storeID, account, role string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return err
	}
	if !consensus.IsNativeAddress(account) || account == actor {
		return errors.New("valid distinct account required")
	}
	role = strings.ToLower(strings.TrimSpace(role))
	if !isAssignableSellerRole(role) {
		return errors.New("role must be admin, catalog, inventory, fulfillment, finance, support or viewer")
	}
	s.s.SellerRoles[storeID][account] = role
	s.auditLocked(actor, "seller", "seller_role_set", "store", storeID, "approved", account+":"+role)
	return s.persistLocked()
}
func (s *Store) SellerRoles(actor, storeID string) (map[string]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerPermissionLocked(storeID, actor, permissionTeamRead); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for a, r := range s.s.SellerRoles[storeID] {
		out[a] = r
	}
	return out, nil
}
func (s *Store) Settlements(actor string) []SettlementEvidence {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []SettlementEvidence{}
	for _, o := range s.s.Orders {
		role, ok := s.sellerRoleLocked(o.StoreID, actor)
		if ok && sellerRoleAllows(role, permissionFinanceRead) && o.Settlement != nil {
			out = append(out, *o.Settlement)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ConfirmedAt.After(out[j].ConfirmedAt) })
	return out
}

func (s *Store) SellerAudit(actor string) ([]AuditEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	owned := map[string]bool{}
	for storeID := range s.s.SellerRoles {
		role, ok := s.sellerRoleLocked(storeID, actor)
		if ok && sellerRoleAllows(role, permissionAuditRead) {
			owned[storeID] = true
		}
	}
	if len(owned) == 0 {
		return nil, ErrUnauthorized
	}
	out := []AuditEvent{}
	for _, event := range s.s.Audits {
		visible := event.Actor == actor
		switch event.ObjectType {
		case "store":
			visible = visible || owned[event.ObjectID]
		case "product":
			product, ok := s.s.Products[event.ObjectID]
			visible = visible || (ok && owned[product.StoreID])
		case "order":
			order, ok := s.s.Orders[event.ObjectID]
			visible = visible || (ok && owned[order.StoreID])
		}
		if visible {
			out = append(out, event)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	return out, nil
}
