package commerce

import (
	"net/http"
	"strings"
)

type NativeSellerRoleRevocationInput struct{ Reason, IdempotencyKey string }
type NativeSellerRoleRevocationResult struct {
	RoleRevoked, OriginalApplied, QueryOnly bool
	SessionInvalidation                     string
	Revocation                              SellerRoleRevocation
}

// Retire the actual Store role using an immutable original request. This never
// claims that central Wallet sessions were invalidated or invokes that service.
// Its existing revocation record remains pending until the original authority
// supplies an actual receipt bound to the current Shop Seller profile. The
// legacy ynx-seller-v1 revoker is not evidence for a ynx-shop-v1 Native session.
func (s *Store) RevokeOriginalSellerRole(actor, storeID, account string, in NativeSellerRoleRevocationInput) (NativeSellerRoleRevocationResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return NativeSellerRoleRevocationResult{}, err
	}
	if len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 {
		return NativeSellerRoleRevocationResult{}, ErrInvalidState
	}
	route := "role.revoke.native." + storeID + "." + account
	id, found, err := s.idempotencyLocked(actor, route, in.IdempotencyKey, in)
	if err != nil {
		return NativeSellerRoleRevocationResult{}, err
	}
	if found {
		record, ok := s.s.SellerRevocations[id]
		if !ok || record.StoreID != storeID || record.Account != account || record.Reason != strings.TrimSpace(in.Reason) {
			return NativeSellerRoleRevocationResult{}, ErrConflict
		}
		return nativeSellerRoleRevocation(record, false), nil
	}
	staged, err := cloneSnapshot(s.s)
	if err != nil {
		return NativeSellerRoleRevocationResult{}, err
	}
	tx := &Store{s: staged, now: s.now}
	record, _, err := tx.RevokeSellerRole(actor, storeID, account, in.Reason)
	if err != nil {
		return NativeSellerRoleRevocationResult{}, err
	}
	tx.recordIdempotencyLocked(actor, route, in.IdempotencyKey, requestHash(in), record.ID)
	before := s.s
	s.s = tx.s
	if err := s.persistLocked(); err != nil {
		s.s = before
		return NativeSellerRoleRevocationResult{}, err
	}
	return nativeSellerRoleRevocation(record, false), nil
}
func nativeSellerRoleRevocation(record SellerRoleRevocation, query bool) NativeSellerRoleRevocationResult {
	return NativeSellerRoleRevocationResult{RoleRevoked: true, OriginalApplied: true, QueryOnly: query, SessionInvalidation: record.SessionStatus, Revocation: record}
}
func (s *Server) nativeRevokeSellerRole(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in NativeSellerRoleRevocationInput
	if !decode(w, r, &in) {
		return
	}
	result, err := s.store.RevokeOriginalSellerRole(actor.Account, r.PathValue("id"), r.PathValue("account"), in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, http.StatusOK, result)
}
