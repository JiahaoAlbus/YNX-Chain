package commerce

import (
	"net/http"
	"strings"
)

// Read the original typed intent under current Buyer authority. Never replay a
// transition, submit Trust evidence, request a refund or create an intent here.
func (s *Server) buyerTransitionLookup(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer")
	if !ok {
		return
	}
	var in orderTransitionInput
	if !decode(w, r, &in) {
		return
	}
	target := r.PathValue("id")
	order, err := s.store.lookupBuyerTransition(sess.Account, target, in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	actor := sess.Account
	if verified, ok := r.Context().Value(businessRequestContextKey{}).(*verifiedBusinessRequest); ok && verified.walletAccount != "" {
		actor = verified.walletAccount
	}
	write(w, 200, map[string]any{"Actor": actor, "OrderID": target, "Action": in.Action, "IdempotencyKey": in.IdempotencyKey, "Order": order})
}
func (s *Store) lookupBuyerTransition(actor, target string, in orderTransitionInput) (Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if target == "" || strings.ContainsAny(target, "/?#") || len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 {
		return Order{}, ErrConflict
	}
	switch in.Action {
	case "cancelled", "delivered", "reviewed", "return_requested", "refund_requested", "disputed":
	default:
		return Order{}, ErrUnauthorized
	}
	order, ok := s.s.Orders[target]
	if !ok {
		return Order{}, ErrNotFound
	}
	if order.Buyer != actor {
		return Order{}, ErrUnauthorized
	}
	route := "order.transition." + target
	for _, alias := range businessActorAliases(actor) {
		if _, retired := s.s.RetiredIdempotency[retiredIdempotencyDigest(alias, route, in.IdempotencyKey)]; retired {
			return Order{}, ErrConflict
		}
	}
	ship, res, review := in.parts()
	// Match the existing transition's persisted semantic request exactly. Keeping
	// its anonymous field names preserves the original hash and old records.
	original := struct {
		OrderID, Next string
		Shipment      *Shipment
		Resolution    *Resolution
		Review        *Review
	}{target, in.Action, ship, res, review}
	record, ok := s.s.Idempotency[idemMapKey(actor, route, in.IdempotencyKey)]
	if !ok || record.Actor != actor || record.Route != route || record.Key != in.IdempotencyKey || record.ObjectID != target || record.RequestHash != requestHash(original) {
		return Order{}, ErrConflict
	}
	return cloneOrder(order), nil
}
