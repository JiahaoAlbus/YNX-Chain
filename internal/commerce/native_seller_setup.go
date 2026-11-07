package commerce

import (
	"net/http"
	"strconv"
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
