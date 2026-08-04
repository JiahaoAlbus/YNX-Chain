package commerce

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const (
	sellerInvitationPending   = "pending"
	sellerInvitationAccepted  = "accepted"
	sellerInvitationCancelled = "cancelled"
	sellerInvitationExpired   = "expired"
	minSellerInvitationTTL    = 15 * time.Minute
	maxSellerInvitationTTL    = 7 * 24 * time.Hour
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

func effectiveSellerInvitationStatus(invitation SellerInvitation, now time.Time) string {
	if invitation.Status == sellerInvitationPending && !now.Before(invitation.ExpiresAt) {
		return sellerInvitationExpired
	}
	return invitation.Status
}

func cloneSellerInvitations(in map[string]SellerInvitation) map[string]SellerInvitation {
	out := make(map[string]SellerInvitation, len(in))
	for id, invitation := range in {
		out[id] = invitation
	}
	return out
}

func (s *Store) sellerRoleUpdateEventLocked(actor, storeID, account, previousRole, role string, occurredAt time.Time) {
	s.s.SellerEvents = append(s.s.SellerEvents, SellerIntegrationEvent{
		ID:            newID("seller_event"),
		EventName:     "ynx.seller.role.updated.v1",
		Source:        "seller-console",
		StoreID:       storeID,
		Account:       account,
		Actor:         actor,
		PreviousRole:  previousRole,
		Role:          role,
		Status:        "updated",
		SchemaVersion: 1,
		OccurredAt:    occurredAt,
	})
}

func (s *Store) sellerInvitationEventLocked(eventName, actor string, invitation SellerInvitation) {
	s.s.SellerEvents = append(s.s.SellerEvents, SellerIntegrationEvent{
		ID:            newID("seller_event"),
		EventName:     eventName,
		Source:        "seller-console",
		StoreID:       invitation.StoreID,
		Account:       invitation.Account,
		Actor:         actor,
		InvitationID:  invitation.ID,
		Role:          invitation.Role,
		Status:        invitation.Status,
		SchemaVersion: 1,
		ExpiresAt:     invitation.ExpiresAt,
		OccurredAt:    invitation.UpdatedAt,
	})
}

func (s *Store) expireSellerInvitationLocked(actor string, invitation SellerInvitation, now time.Time) SellerInvitation {
	invitation.Status = sellerInvitationExpired
	invitation.UpdatedAt = now
	s.s.SellerInvitations[invitation.ID] = invitation
	s.auditLocked(actor, "seller", "seller_team_invitation_expired", "invitation", invitation.ID, "expired", "store_id="+invitation.StoreID+" account="+invitation.Account+" role="+invitation.Role)
	s.sellerInvitationEventLocked("ynx.seller.team.invitation.expired.v1", actor, invitation)
	return invitation
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
	if !hadPrevious {
		return fmt.Errorf("%w: new Seller members must accept a Wallet-bound invitation", ErrConflict)
	}
	auditLen := len(s.s.Audits)
	eventLen := len(s.s.SellerEvents)
	updatedAt := s.now()
	s.s.SellerRoles[storeID][account] = role
	s.auditLocked(actor, "seller", "seller_role_set", "store", storeID, "approved", account+":"+role)
	s.sellerRoleUpdateEventLocked(actor, storeID, account, previous, role, updatedAt)
	if err := s.persistLocked(); err != nil {
		s.s.SellerRoles[storeID][account] = previous
		s.s.Audits = s.s.Audits[:auditLen]
		s.s.SellerEvents = s.s.SellerEvents[:eventLen]
		return err
	}
	return nil
}

func (s *Store) CreateSellerInvitation(actor, storeID, account, role string, ttl time.Duration) (SellerInvitation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return SellerInvitation{}, err
	}
	if !consensus.IsNativeAddress(account) || account == actor {
		return SellerInvitation{}, errors.New("valid distinct invitation account required")
	}
	role = strings.ToLower(strings.TrimSpace(role))
	if !isAssignableSellerRole(role) {
		return SellerInvitation{}, errors.New("role must be admin, catalog, inventory, fulfillment, finance, support or viewer")
	}
	if ttl < minSellerInvitationTTL || ttl > maxSellerInvitationTTL {
		return SellerInvitation{}, errors.New("invitation expiry must be between 15 minutes and 7 days")
	}
	if _, ok := s.s.SellerRoles[storeID][account]; ok {
		return SellerInvitation{}, fmt.Errorf("%w: account already has a Seller role", ErrConflict)
	}
	if revocation, ok := s.latestSellerRevocationLocked(storeID, account); ok && revocation.SessionStatus != "confirmed" {
		return SellerInvitation{}, fmt.Errorf("%w: prior role revocation session invalidation is %s", ErrConflict, revocation.SessionStatus)
	}
	now := s.now()
	for _, existing := range s.s.SellerInvitations {
		if existing.StoreID == storeID && existing.Account == account && effectiveSellerInvitationStatus(existing, now) == sellerInvitationPending {
			return SellerInvitation{}, fmt.Errorf("%w: active Seller invitation already exists", ErrConflict)
		}
	}
	invitation := SellerInvitation{ID: newID("seller_invitation"), StoreID: storeID, Account: account, Role: role, CreatedBy: actor, Status: sellerInvitationPending, CreatedAt: now, ExpiresAt: now.Add(ttl), UpdatedAt: now}
	auditLen := len(s.s.Audits)
	eventLen := len(s.s.SellerEvents)
	s.s.SellerInvitations[invitation.ID] = invitation
	s.auditLocked(actor, "seller", "seller_team_invitation_created", "invitation", invitation.ID, "pending", "store_id="+storeID+" account="+account+" role="+role)
	s.sellerInvitationEventLocked("ynx.seller.team.invitation.created.v1", actor, invitation)
	if err := s.persistLocked(); err != nil {
		delete(s.s.SellerInvitations, invitation.ID)
		s.s.Audits = s.s.Audits[:auditLen]
		s.s.SellerEvents = s.s.SellerEvents[:eventLen]
		return SellerInvitation{}, err
	}
	return invitation, nil
}

func (s *Store) SellerInvitations(actor, storeID string) ([]SellerInvitation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerPermissionLocked(storeID, actor, permissionTeamRead); err != nil {
		return nil, err
	}
	now := s.now()
	out := []SellerInvitation{}
	for _, invitation := range s.s.SellerInvitations {
		if invitation.StoreID != storeID {
			continue
		}
		invitation.Status = effectiveSellerInvitationStatus(invitation, now)
		out = append(out, invitation)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID > out[j].ID
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

func (s *Store) SellerInvitationsForAccount(account string) []SellerInvitation {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	out := []SellerInvitation{}
	for _, invitation := range s.s.SellerInvitations {
		if invitation.Account != account {
			continue
		}
		invitation.Status = effectiveSellerInvitationStatus(invitation, now)
		out = append(out, invitation)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID > out[j].ID
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out
}

func (s *Store) AcceptSellerInvitation(actor, invitationID string) (SellerInvitation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	invitation, ok := s.s.SellerInvitations[strings.TrimSpace(invitationID)]
	if !ok {
		return SellerInvitation{}, ErrNotFound
	}
	if actor != invitation.Account {
		return SellerInvitation{}, ErrNotFound
	}
	now := s.now()
	if effectiveSellerInvitationStatus(invitation, now) == sellerInvitationExpired {
		previousInvitations := cloneSellerInvitations(s.s.SellerInvitations)
		auditLen := len(s.s.Audits)
		eventLen := len(s.s.SellerEvents)
		s.expireSellerInvitationLocked(actor, invitation, now)
		if err := s.persistLocked(); err != nil {
			s.s.SellerInvitations = previousInvitations
			s.s.Audits = s.s.Audits[:auditLen]
			s.s.SellerEvents = s.s.SellerEvents[:eventLen]
			return SellerInvitation{}, err
		}
		return SellerInvitation{}, fmt.Errorf("%w: Seller invitation expired", ErrConflict)
	}
	if invitation.Status != sellerInvitationPending {
		return SellerInvitation{}, fmt.Errorf("%w: Seller invitation is %s", ErrConflict, invitation.Status)
	}
	if !isAssignableSellerRole(invitation.Role) {
		return SellerInvitation{}, fmt.Errorf("%w: invitation role is not assignable", ErrInvalidState)
	}
	if _, ok := s.s.Stores[invitation.StoreID]; !ok {
		return SellerInvitation{}, ErrNotFound
	}
	if s.s.SellerRoles[invitation.StoreID] == nil {
		s.s.SellerRoles[invitation.StoreID] = map[string]string{}
	}
	if _, ok := s.s.SellerRoles[invitation.StoreID][actor]; ok {
		return SellerInvitation{}, fmt.Errorf("%w: account already has a Seller role", ErrConflict)
	}
	if revocation, ok := s.latestSellerRevocationLocked(invitation.StoreID, actor); ok && revocation.SessionStatus != "confirmed" {
		return SellerInvitation{}, fmt.Errorf("%w: prior role revocation session invalidation is %s", ErrConflict, revocation.SessionStatus)
	}
	previousInvitation := invitation
	auditLen := len(s.s.Audits)
	eventLen := len(s.s.SellerEvents)
	invitation.Status = sellerInvitationAccepted
	invitation.AcceptedAt = now
	invitation.UpdatedAt = now
	s.s.SellerInvitations[invitation.ID] = invitation
	s.s.SellerRoles[invitation.StoreID][actor] = invitation.Role
	s.auditLocked(actor, "seller", "seller_team_invitation_accepted", "invitation", invitation.ID, "accepted", "store_id="+invitation.StoreID+" role="+invitation.Role)
	s.sellerInvitationEventLocked("ynx.seller.team.invitation.accepted.v1", actor, invitation)
	if err := s.persistLocked(); err != nil {
		s.s.SellerInvitations[invitation.ID] = previousInvitation
		delete(s.s.SellerRoles[invitation.StoreID], actor)
		s.s.Audits = s.s.Audits[:auditLen]
		s.s.SellerEvents = s.s.SellerEvents[:eventLen]
		return SellerInvitation{}, err
	}
	return invitation, nil
}

func (s *Store) CancelSellerInvitation(actor, storeID, invitationID, reason string) (SellerInvitation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return SellerInvitation{}, err
	}
	reason = strings.TrimSpace(reason)
	if len(reason) < 8 || len(reason) > 240 || strings.ContainsAny(reason, "\r\n") {
		return SellerInvitation{}, errors.New("cancellation reason must contain 8 to 240 single-line characters")
	}
	invitation, ok := s.s.SellerInvitations[strings.TrimSpace(invitationID)]
	if !ok || invitation.StoreID != storeID {
		return SellerInvitation{}, ErrNotFound
	}
	now := s.now()
	if effectiveSellerInvitationStatus(invitation, now) == sellerInvitationExpired {
		previousInvitations := cloneSellerInvitations(s.s.SellerInvitations)
		auditLen := len(s.s.Audits)
		eventLen := len(s.s.SellerEvents)
		s.expireSellerInvitationLocked(actor, invitation, now)
		if err := s.persistLocked(); err != nil {
			s.s.SellerInvitations = previousInvitations
			s.s.Audits = s.s.Audits[:auditLen]
			s.s.SellerEvents = s.s.SellerEvents[:eventLen]
			return SellerInvitation{}, err
		}
		return SellerInvitation{}, fmt.Errorf("%w: Seller invitation expired", ErrConflict)
	}
	if invitation.Status != sellerInvitationPending {
		return SellerInvitation{}, fmt.Errorf("%w: Seller invitation is %s", ErrConflict, invitation.Status)
	}
	previousInvitation := invitation
	auditLen := len(s.s.Audits)
	eventLen := len(s.s.SellerEvents)
	invitation.Status = sellerInvitationCancelled
	invitation.Reason = reason
	invitation.CancelledAt = now
	invitation.UpdatedAt = now
	s.s.SellerInvitations[invitation.ID] = invitation
	s.auditLocked(actor, "seller", "seller_team_invitation_cancelled", "invitation", invitation.ID, "cancelled", "store_id="+storeID+" account="+invitation.Account+" role="+invitation.Role+" reason="+reason)
	s.sellerInvitationEventLocked("ynx.seller.team.invitation.cancelled.v1", actor, invitation)
	if err := s.persistLocked(); err != nil {
		s.s.SellerInvitations[invitation.ID] = previousInvitation
		s.s.Audits = s.s.Audits[:auditLen]
		s.s.SellerEvents = s.s.SellerEvents[:eventLen]
		return SellerInvitation{}, err
	}
	return invitation, nil
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
