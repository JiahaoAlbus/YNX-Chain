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

func (s *Store) ExportBuyerData(actor string) BuyerDataExport {
	s.mu.Lock()
	defer s.mu.Unlock()

	profile := s.s.BuyerProfiles[actor]
	profile.Account = actor
	cart := s.s.Carts[actor]
	cart.Buyer = actor

	orders := make([]Order, 0)
	for _, order := range s.s.Orders {
		if order.Buyer == actor {
			orders = append(orders, order)
		}
	}
	sort.Slice(orders, func(i, j int) bool { return orders[i].CreatedAt.After(orders[j].CreatedAt) })

	jobs := make([]AIJob, 0)
	for _, job := range s.s.AIJobs {
		if job.Actor == actor {
			jobs = append(jobs, job)
		}
	}
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].CreatedAt.After(jobs[j].CreatedAt) })

	audits := make([]AuditEvent, 0)
	for _, event := range s.s.Audits {
		if event.Role == "buyer" && event.Actor == actor {
			audits = append(audits, event)
		}
	}
	sort.Slice(audits, func(i, j int) bool { return audits[i].At.After(audits[j].At) })

	return BuyerDataExport{
		SchemaVersion:   1,
		ExportedAt:      s.now(),
		Account:         actor,
		Profile:         profile,
		Cart:            cart,
		Orders:          orders,
		AIJobs:          jobs,
		AuditEvents:     audits,
		RetentionNotice: "Profile, saved addresses, cart, AI jobs, and buyer-scoped request records can be deleted. Finalized orders are pseudonymized, while authoritative public-chain settlement addresses, transaction hashes, refund evidence, dispute state, and integrity records are retained for verification, accounting, fraud prevention, and audit continuity.",
	}
}

func terminalForPrivacyDeletion(status string) bool {
	switch status {
	case "cancelled", "expired", "refunded", "return_rejected", "refund_rejected":
		return true
	default:
		return false
	}
}

func (s *Store) DeleteBuyerData(actor string) (BuyerDataDeletionReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, order := range s.s.Orders {
		if order.Buyer == actor && !terminalForPrivacyDeletion(order.Status) {
			return BuyerDataDeletionReceipt{}, fmt.Errorf("%w: order %s is %s and must reach a terminal state before personal data deletion", ErrInvalidState, order.ID, order.Status)
		}
	}

	now := s.now()
	receipt := BuyerDataDeletionReceipt{
		ReceiptID:       newID("privacy-delete"),
		DeletedAt:       now,
		RetainedRecords: []string{"pseudonymized finalized orders", "authoritative public-chain payer addresses and transaction hashes", "settlement and refund evidence", "order timeline and integrity audit"},
	}
	if _, ok := s.s.BuyerProfiles[actor]; ok {
		delete(s.s.BuyerProfiles, actor)
		receipt.ProfileDeleted = true
	}
	if _, ok := s.s.Carts[actor]; ok {
		delete(s.s.Carts, actor)
		receipt.CartDeleted = true
	}

	pseudonym := newID("deleted-buyer")
	for id, order := range s.s.Orders {
		if order.Buyer != actor {
			continue
		}
		order.Buyer = pseudonym
		order.Address = Address{}
		if order.Resolution != nil {
			resolution := *order.Resolution
			resolution.Reason = ""
			resolution.Explanation = ""
			order.Resolution = &resolution
		}
		if order.Review != nil {
			review := *order.Review
			review.Body = ""
			order.Review = &review
		}
		if order.TrustCase != nil {
			trustCase := *order.TrustCase
			trustCase.EvidenceURL = ""
			trustCase.AppealURL = ""
			order.TrustCase = &trustCase
		}
		for i := range order.Timeline {
			if order.Timeline[i].Actor == actor {
				order.Timeline[i].Actor = pseudonym
			}
		}
		order.UpdatedAt = now
		s.s.Orders[id] = order
		receipt.OrdersPseudonymized++
	}

	for id, job := range s.s.AIJobs {
		if job.Actor == actor {
			delete(s.s.AIJobs, id)
			receipt.AIJobsDeleted++
		}
	}
	for key, record := range s.s.Idempotency {
		if record.Actor == actor && (strings.HasPrefix(record.Route, "order.") || strings.HasPrefix(record.Route, "ai.")) {
			delete(s.s.Idempotency, key)
			receipt.IdempotencyDeleted++
		}
	}
	for key := range s.s.RequestWindow {
		if strings.HasPrefix(key, actor+"\x00") {
			delete(s.s.RequestWindow, key)
			receipt.RateWindowsDeleted++
		}
	}
	for i := range s.s.Audits {
		if s.s.Audits[i].Role == "buyer" && s.s.Audits[i].Actor == actor {
			s.s.Audits[i].Actor = pseudonym
			receipt.AuditEventsPseudonymized++
		}
		if (s.s.Audits[i].ObjectType == "profile" || s.s.Audits[i].ObjectType == "cart") && s.s.Audits[i].ObjectID == actor {
			s.s.Audits[i].ObjectID = pseudonym
		}
	}
	s.auditLocked("privacy-service", "system", "buyer_data_deleted", "privacy_receipt", receipt.ReceiptID, "completed", fmt.Sprintf("profile=%t cart=%t orders=%d aiJobs=%d", receipt.ProfileDeleted, receipt.CartDeleted, receipt.OrdersPseudonymized, receipt.AIJobsDeleted))
	if err := s.persistLocked(); err != nil {
		return BuyerDataDeletionReceipt{}, err
	}
	return receipt, nil
}

type StoreUpdate struct{ Name, Description, Policy, TrustURL, SettlementAccount string }

func (s *Store) UpdateStore(actor, id string, in StoreUpdate) (StoreProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.s.Stores[id]
	if !ok {
		return StoreProfile{}, ErrNotFound
	}
	if err := s.requireSellerLocked(id, actor, "owner"); err != nil {
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
		if s.s.SellerRoles[id][actor] != "" {
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
	if err := s.requireSellerLocked(storeID, actor, "owner", "manager", "fulfillment", "support", "viewer"); err != nil {
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
	if err := s.requireSellerLocked(storeID, actor, "owner"); err != nil {
		return err
	}
	if !consensus.IsNativeAddress(account) || account == actor {
		return errors.New("valid distinct account required")
	}
	allowed := map[string]bool{"manager": true, "fulfillment": true, "support": true, "viewer": true}
	if !allowed[role] {
		return errors.New("role must be manager, fulfillment, support or viewer")
	}
	s.s.SellerRoles[storeID][account] = role
	s.auditLocked(actor, "seller", "seller_role_set", "store", storeID, "approved", account+":"+role)
	return s.persistLocked()
}
func (s *Store) SellerRoles(actor, storeID string) (map[string]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(storeID, actor, "owner", "manager", "viewer"); err != nil {
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
		if s.s.SellerRoles[o.StoreID][actor] != "" && o.Settlement != nil {
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
	for storeID, roles := range s.s.SellerRoles {
		if roles[actor] == "owner" || roles[actor] == "manager" || roles[actor] == "viewer" {
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
