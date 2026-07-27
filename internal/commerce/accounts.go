package commerce

import (
	"errors"
	"fmt"
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
func (s *Store) latestSellerRevocationLocked(storeID, account string) (SellerRoleRevocation, bool) {
	var latest SellerRoleRevocation
	found := false
	for _, revocation := range s.s.SellerRevocations {
		if revocation.StoreID != storeID || revocation.Account != account {
			continue
		}
		if !found || revocation.RequestedAt.After(latest.RequestedAt) || (revocation.RequestedAt.Equal(latest.RequestedAt) && revocation.ID > latest.ID) {
			latest = revocation
			found = true
		}
	}
	return latest, found
}

func (s *Store) sellerIntegrationEventLocked(eventName, actor string, revocation SellerRoleRevocation) {
	s.s.SellerEvents = append(s.s.SellerEvents, SellerIntegrationEvent{
		ID:                  newID("seller_event"),
		EventName:           eventName,
		Source:              "seller-console",
		StoreID:             revocation.StoreID,
		Account:             revocation.Account,
		Actor:               actor,
		RevocationID:        revocation.ID,
		PreviousRole:        revocation.PreviousRole,
		SessionStatus:       revocation.SessionStatus,
		SessionRevocationID: revocation.SessionRevocationID,
		SchemaVersion:       1,
		SessionCount:        revocation.SessionCount,
		OccurredAt:          revocation.UpdatedAt,
	})
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
	if revocation, ok := s.latestSellerRevocationLocked(storeID, account); ok && revocation.SessionStatus != "confirmed" {
		return fmt.Errorf("%w: prior role revocation session invalidation is %s", ErrConflict, revocation.SessionStatus)
	}
	previous, hadPrevious := s.s.SellerRoles[storeID][account]
	auditLen := len(s.s.Audits)
	s.s.SellerRoles[storeID][account] = role
	s.auditLocked(actor, "seller", "seller_role_set", "store", storeID, "approved", account+":"+role)
	if err := s.persistLocked(); err != nil {
		if hadPrevious {
			s.s.SellerRoles[storeID][account] = previous
		} else {
			delete(s.s.SellerRoles[storeID], account)
		}
		s.s.Audits = s.s.Audits[:auditLen]
		return err
	}
	return nil
}

func (s *Store) RevokeSellerRole(actor, storeID, account, reason string) (SellerRoleRevocation, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return SellerRoleRevocation{}, false, err
	}
	reason = strings.TrimSpace(reason)
	if !consensus.IsNativeAddress(account) || account == actor {
		return SellerRoleRevocation{}, false, errors.New("valid distinct account required")
	}
	if len(reason) < 8 || len(reason) > 240 || strings.ContainsAny(reason, "\r\n") {
		return SellerRoleRevocation{}, false, errors.New("revocation reason must contain 8 to 240 single-line characters")
	}
	role, ok := s.s.SellerRoles[storeID][account]
	if !ok {
		if existing, found := s.latestSellerRevocationLocked(storeID, account); found {
			if existing.Reason != reason {
				return SellerRoleRevocation{}, false, fmt.Errorf("%w: repeated revocation reason differs", ErrConflict)
			}
			return existing, false, nil
		}
		return SellerRoleRevocation{}, false, ErrNotFound
	}
	role, valid := canonicalSellerRole(role)
	if !valid || role == SellerRoleOwner {
		return SellerRoleRevocation{}, false, ErrUnauthorized
	}
	now := s.now()
	revocation := SellerRoleRevocation{ID: newID("seller_revocation"), StoreID: storeID, Account: account, PreviousRole: role, Reason: reason, SessionStatus: "pending", RequestedAt: now, UpdatedAt: now}
	auditLen := len(s.s.Audits)
	eventLen := len(s.s.SellerEvents)
	delete(s.s.SellerRoles[storeID], account)
	s.s.SellerRevocations[revocation.ID] = revocation
	s.auditLocked(actor, "seller", "seller_role_revoked", "store", storeID, "local_revoked", "revocation_id="+revocation.ID+" account="+account+" previous_role="+role)
	s.sellerIntegrationEventLocked("ynx.seller.role.revoked.v1", actor, revocation)
	if err := s.persistLocked(); err != nil {
		s.s.SellerRoles[storeID][account] = role
		delete(s.s.SellerRevocations, revocation.ID)
		s.s.Audits = s.s.Audits[:auditLen]
		s.s.SellerEvents = s.s.SellerEvents[:eventLen]
		return SellerRoleRevocation{}, false, err
	}
	return revocation, true, nil
}

func (s *Store) UpdateSellerRoleRevocation(actor, revocationID, sessionStatus, sessionRevocationID string, sessionCount int, detail string) (SellerRoleRevocation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	revocation, ok := s.s.SellerRevocations[revocationID]
	if !ok {
		return SellerRoleRevocation{}, ErrNotFound
	}
	if err := s.requireSellerLocked(revocation.StoreID, actor, SellerRoleOwner); err != nil {
		return SellerRoleRevocation{}, err
	}
	if revocation.SessionStatus == "confirmed" {
		return revocation, nil
	}
	switch sessionStatus {
	case "confirmed", "unavailable", "rejected":
	default:
		return SellerRoleRevocation{}, errors.New("session revocation status must be confirmed, unavailable or rejected")
	}
	if sessionStatus == "confirmed" && (len(sessionRevocationID) < 8 || sessionCount < 0) {
		return SellerRoleRevocation{}, errors.New("confirmed session revocation requires receipt id and non-negative session count")
	}
	detail = strings.TrimSpace(detail)
	if len(detail) > 500 || strings.ContainsAny(detail, "\r\n") {
		return SellerRoleRevocation{}, errors.New("session revocation detail exceeds limits")
	}
	previous := revocation
	auditLen := len(s.s.Audits)
	eventLen := len(s.s.SellerEvents)
	revocation.SessionStatus = sessionStatus
	revocation.SessionRevocationID = strings.TrimSpace(sessionRevocationID)
	revocation.SessionCount = sessionCount
	revocation.LastError = ""
	if sessionStatus != "confirmed" {
		revocation.LastError = detail
	}
	revocation.UpdatedAt = s.now()
	s.s.SellerRevocations[revocation.ID] = revocation
	s.auditLocked(actor, "seller", "seller_session_invalidation", "store", revocation.StoreID, sessionStatus, "revocation_id="+revocation.ID+" account="+revocation.Account+" "+detail)
	s.sellerIntegrationEventLocked("ynx.seller.authorization.revocation.updated.v1", actor, revocation)
	if err := s.persistLocked(); err != nil {
		s.s.SellerRevocations[revocation.ID] = previous
		s.s.Audits = s.s.Audits[:auditLen]
		s.s.SellerEvents = s.s.SellerEvents[:eventLen]
		return SellerRoleRevocation{}, err
	}
	return revocation, nil
}

func (s *Store) SellerRoleRevocations(actor, storeID string) ([]SellerRoleRevocation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerPermissionLocked(storeID, actor, permissionTeamRead); err != nil {
		return nil, err
	}
	out := []SellerRoleRevocation{}
	for _, revocation := range s.s.SellerRevocations {
		if revocation.StoreID == storeID {
			out = append(out, revocation)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RequestedAt.After(out[j].RequestedAt) })
	return out, nil
}

func (s *Store) SellerIntegrationEvents(actor, storeID string) ([]SellerIntegrationEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerPermissionLocked(storeID, actor, permissionTeamRead); err != nil {
		return nil, err
	}
	out := []SellerIntegrationEvent{}
	for _, event := range s.s.SellerEvents {
		if event.StoreID == storeID {
			out = append(out, event)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].OccurredAt.Equal(out[j].OccurredAt) {
			return out[i].ID > out[j].ID
		}
		return out[i].OccurredAt.After(out[j].OccurredAt)
	})
	return out, nil
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
func (s *Store) Settlements(actor string) ([]SettlementEvidence, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	authorizedStores := map[string]bool{}
	for storeID := range s.s.SellerRoles {
		role, ok := s.sellerRoleLocked(storeID, actor)
		if ok && sellerRoleAllows(role, permissionFinanceRead) {
			authorizedStores[storeID] = true
		}
	}
	if len(authorizedStores) == 0 {
		return nil, ErrUnauthorized
	}
	out := []SettlementEvidence{}
	for _, o := range s.s.Orders {
		if authorizedStores[o.StoreID] && o.Settlement != nil {
			out = append(out, *o.Settlement)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ConfirmedAt.After(out[j].ConfirmedAt) })
	return out, nil
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
