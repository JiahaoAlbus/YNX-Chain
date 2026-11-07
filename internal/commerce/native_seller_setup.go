package commerce

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

type NativeSellerInvitationInput struct{ Account, Role, TTLSeconds, IdempotencyKey string }
type NativeSellerInvitationResult struct {
	Invitation                 SellerInvitation
	OriginalApplied, QueryOnly bool
}
type NativeStoreActivationInput struct{ ExpectedUpdatedAt, ExpectedPolicy, ExpectedSettlementAccount, IdempotencyKey string }
type NativeStoreActivationResult struct {
	Store                      StoreProfile
	OriginalApplied, QueryOnly bool
}

func (s *Store) CreateOriginalSellerInvitation(actor, store string, in NativeSellerInvitationInput) (NativeSellerInvitationResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(store, actor, SellerRoleOwner); err != nil {
		return NativeSellerInvitationResult{}, err
	}
	seconds, err := strconv.ParseInt(in.TTLSeconds, 10, 64)
	canonicalRole, validRole := canonicalSellerRole(in.Role)
	if err != nil || strconv.FormatInt(seconds, 10) != in.TTLSeconds || seconds < 900 || seconds > 604800 || !isAssignableSellerRole(in.Role) || !validRole || canonicalRole != in.Role || len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 {
		return NativeSellerInvitationResult{}, ErrInvalidState
	}
	route := "invitation.native." + store
	id, found, err := s.idempotencyLocked(actor, route, in.IdempotencyKey, in)
	if err != nil {
		return NativeSellerInvitationResult{}, err
	}
	if found {
		value, ok := s.s.SellerInvitations[id]
		if !ok || value.StoreID != store || value.Account != in.Account || value.Role != in.Role {
			return NativeSellerInvitationResult{}, ErrConflict
		}
		value.Status = effectiveSellerInvitationStatus(value, s.now())
		return NativeSellerInvitationResult{Invitation: value, OriginalApplied: true}, nil
	}
	staged, err := cloneSnapshot(s.s)
	if err != nil {
		return NativeSellerInvitationResult{}, err
	}
	tx := &Store{s: staged, now: s.now}
	value, err := tx.CreateSellerInvitation(actor, store, in.Account, in.Role, time.Duration(seconds)*time.Second)
	if err != nil {
		return NativeSellerInvitationResult{}, err
	}
	tx.recordIdempotencyLocked(actor, route, in.IdempotencyKey, requestHash(in), value.ID)
	before := s.s
	s.s = tx.s
	if err = s.persistLocked(); err != nil {
		s.s = before
		return NativeSellerInvitationResult{}, err
	}
	return NativeSellerInvitationResult{Invitation: value, OriginalApplied: true}, nil
}
func (s *Store) ActivateOriginalStore(actor, store string, in NativeStoreActivationInput) (NativeStoreActivationResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(store, actor, SellerRoleOwner); err != nil {
		return NativeStoreActivationResult{}, err
	}
	value, ok := s.s.Stores[store]
	if !ok {
		return NativeStoreActivationResult{}, ErrNotFound
	}
	if len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 {
		return NativeStoreActivationResult{}, ErrInvalidState
	}
	route := "store.activate.native." + store
	id, found, err := s.idempotencyLocked(actor, route, in.IdempotencyKey, in)
	if err != nil {
		return NativeStoreActivationResult{}, err
	}
	if found {
		if id != store {
			return NativeStoreActivationResult{}, ErrConflict
		}
		return NativeStoreActivationResult{Store: value, OriginalApplied: true}, nil
	}
	if in.ExpectedUpdatedAt == "" || value.UpdatedAt.Format(time.RFC3339Nano) != in.ExpectedUpdatedAt || value.Policy != in.ExpectedPolicy || value.SettlementAccount != in.ExpectedSettlementAccount {
		return NativeStoreActivationResult{}, ErrConflict
	}
	staged, err := cloneSnapshot(s.s)
	if err != nil {
		return NativeStoreActivationResult{}, err
	}
	tx := &Store{s: staged, now: s.now}
	value, err = tx.ActivateStore(actor, store)
	if err != nil {
		return NativeStoreActivationResult{}, err
	}
	tx.recordIdempotencyLocked(actor, route, in.IdempotencyKey, requestHash(in), store)
	before := s.s
	s.s = tx.s
	if err = s.persistLocked(); err != nil {
		s.s = before
		return NativeStoreActivationResult{}, err
	}
	return NativeStoreActivationResult{Store: value, OriginalApplied: true}, nil
}
func (s *Server) nativeInviteSeller(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in NativeSellerInvitationInput
	if !decode(w, r, &in) {
		return
	}
	value, err := s.store.CreateOriginalSellerInvitation(actor.Account, r.PathValue("id"), in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, http.StatusCreated, value)
}
func (s *Server) nativeActivateStore(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in NativeStoreActivationInput
	if !decode(w, r, &in) {
		return
	}
	value, err := s.store.ActivateOriginalStore(actor.Account, r.PathValue("id"), in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, http.StatusOK, value)
}

// The reviewed invitation, actor and original key are committed together with
// the existing Store transition. A lost acknowledgement never requires replay.
type NativeInvitationDecisionInput struct {
	ExpectedUpdatedAt, ExpectedRole, ExpectedAccount, Reason, IdempotencyKey string
}

func (s *Store) DecideOriginalSellerInvitation(actor, storeID, invitationID string, accept bool, in NativeInvitationDecisionInput) (NativeSellerInvitationResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, ok := s.s.SellerInvitations[invitationID]
	if !ok || value.StoreID != storeID {
		return NativeSellerInvitationResult{}, ErrNotFound
	}
	action := "cancel"
	if accept {
		action = "accept"
		if value.Account != actor {
			return NativeSellerInvitationResult{}, ErrNotFound
		}
		if in.Reason != "" {
			return NativeSellerInvitationResult{}, ErrInvalidState
		}
	} else if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return NativeSellerInvitationResult{}, err
	}
	if len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 {
		return NativeSellerInvitationResult{}, ErrInvalidState
	}
	route := "invitation." + action + ".native." + invitationID
	id, found, err := s.idempotencyLocked(actor, route, in.IdempotencyKey, in)
	if err != nil {
		return NativeSellerInvitationResult{}, err
	}
	if found {
		if id != invitationID || (accept && value.Status != sellerInvitationAccepted) || (!accept && value.Status != sellerInvitationCancelled) {
			return NativeSellerInvitationResult{}, ErrConflict
		}
		return NativeSellerInvitationResult{Invitation: value, OriginalApplied: true}, nil
	}
	if value.UpdatedAt.Format(time.RFC3339Nano) != in.ExpectedUpdatedAt || value.Role != in.ExpectedRole || value.Account != in.ExpectedAccount || effectiveSellerInvitationStatus(value, s.now()) != sellerInvitationPending {
		return NativeSellerInvitationResult{}, ErrConflict
	}
	staged, err := cloneSnapshot(s.s)
	if err != nil {
		return NativeSellerInvitationResult{}, err
	}
	tx := &Store{s: staged, now: s.now}
	if accept {
		value, err = tx.AcceptSellerInvitation(actor, invitationID)
	} else {
		value, err = tx.CancelSellerInvitation(actor, storeID, invitationID, in.Reason)
	}
	if err != nil {
		return NativeSellerInvitationResult{}, err
	}
	tx.recordIdempotencyLocked(actor, route, in.IdempotencyKey, requestHash(in), invitationID)
	before := s.s
	s.s = tx.s
	if err = s.persistLocked(); err != nil {
		s.s = before
		return NativeSellerInvitationResult{}, err
	}
	return NativeSellerInvitationResult{Invitation: value, OriginalApplied: true}, nil
}
func (s *Server) nativeAcceptSellerInvitation(w http.ResponseWriter, r *http.Request) {
	s.nativeDecideSellerInvitation(w, r, true)
}
func (s *Server) nativeCancelSellerInvitation(w http.ResponseWriter, r *http.Request) {
	s.nativeDecideSellerInvitation(w, r, false)
}
func (s *Server) nativeDecideSellerInvitation(w http.ResponseWriter, r *http.Request, accept bool) {
	actor, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in NativeInvitationDecisionInput
	if !decode(w, r, &in) {
		return
	}
	value, err := s.store.DecideOriginalSellerInvitation(actor.Account, r.PathValue("id"), r.PathValue("invitation"), accept, in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, http.StatusOK, value)
}

// Expected is the exact profile the owner reviewed. The original outer key
// covers both that snapshot and the replacement fields; no nested key is used.
type NativeStoreProfileInput struct {
	Expected       StoreProfile
	Update         StoreUpdate
	IdempotencyKey string
}
type NativeStoreProfileResult struct {
	Store                      StoreProfile
	Applied                    StoreUpdate
	OriginalApplied, QueryOnly bool
}

func sameNativeStoreProfile(a, b StoreProfile) bool {
	return a.ID == b.ID && a.Owner == b.Owner && a.Name == b.Name && a.Description == b.Description && a.Policy == b.Policy && a.TrustURL == b.TrustURL && a.SettlementAccount == b.SettlementAccount && a.Status == b.Status && a.CreatedAt.Equal(b.CreatedAt) && a.UpdatedAt.Equal(b.UpdatedAt) && sameNativeCharges(a.NativeCharges, b.NativeCharges) && a.NativeChargesApprovalRef == b.NativeChargesApprovalRef
}
func (s *Store) UpdateOriginalStoreProfile(actor, storeID string, in NativeStoreProfileInput) (NativeStoreProfileResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return NativeStoreProfileResult{}, err
	}
	value, ok := s.s.Stores[storeID]
	if !ok {
		return NativeStoreProfileResult{}, ErrNotFound
	}
	if len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 || in.Update.IdempotencyKey != "" || strings.TrimSpace(in.Update.Policy) == "" || in.Expected.ID != storeID || in.Expected.Owner != value.Owner {
		return NativeStoreProfileResult{}, ErrInvalidState
	}
	if err := validateStoreFields(in.Update.Name, in.Update.Description, in.Update.Policy, in.Update.TrustURL, in.Update.SettlementAccount); err != nil {
		return NativeStoreProfileResult{}, err
	}
	route := "store.profile.native." + storeID
	id, found, err := s.idempotencyLocked(actor, route, in.IdempotencyKey, in)
	if err != nil {
		return NativeStoreProfileResult{}, err
	}
	if found {
		if id != storeID {
			return NativeStoreProfileResult{}, ErrConflict
		}
		return NativeStoreProfileResult{Store: value, Applied: in.Update, OriginalApplied: true}, nil
	}
	if !sameNativeStoreProfile(value, in.Expected) {
		return NativeStoreProfileResult{}, ErrConflict
	}
	staged, err := cloneSnapshot(s.s)
	if err != nil {
		return NativeStoreProfileResult{}, err
	}
	tx := &Store{s: staged, now: s.now}
	update := in.Update
	if update.NativeCharges != nil || update.ClearNativeCharges {
		update.IdempotencyKey = in.IdempotencyKey
	}
	value, err = tx.UpdateStore(actor, storeID, update)
	if err != nil {
		return NativeStoreProfileResult{}, err
	}
	tx.recordIdempotencyLocked(actor, route, in.IdempotencyKey, requestHash(in), storeID)
	before := s.s
	s.s = tx.s
	if err = s.persistLocked(); err != nil {
		s.s = before
		return NativeStoreProfileResult{}, err
	}
	return NativeStoreProfileResult{Store: value, Applied: in.Update, OriginalApplied: true}, nil
}
func (s *Server) nativeUpdateStoreProfile(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in NativeStoreProfileInput
	if !decode(w, r, &in) {
		return
	}
	result, err := s.store.UpdateOriginalStoreProfile(actor.Account, r.PathValue("id"), in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, http.StatusOK, result)
}
