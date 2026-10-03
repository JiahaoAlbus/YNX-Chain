package commerce

import "errors"

func sameCartItems(a, b []CartItem) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func hasCartProtection(s Snapshot) bool {
	for _, c := range s.Carts {
		if c.Revision != "" {
			return true
		}
	}
	for _, o := range s.Orders {
		if o.CartConsumption != nil {
			return true
		}
	}
	return false
}

// Read-only recovery never makes a missing intent safe to replace: a request
// may still be in transit. Authentication supplies actor; the client sends no body.
func (s *Store) OrderIntent(actor, key string) (Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(key) < 8 || len(key) > 128 {
		return Order{}, errors.New("invalid idempotency key")
	}
	if _, retired := s.s.RetiredIdempotency[retiredIdempotencyDigest(actor, "order.create", key)]; retired {
		return Order{}, ErrConflict
	}
	rec, ok := s.s.Idempotency[idemMapKey(actor, "order.create", key)]
	if !ok {
		return Order{}, ErrNotFound
	}
	o, ok := s.s.Orders[rec.ObjectID]
	if !ok {
		return Order{}, ErrConflict
	}
	if o.Buyer != actor {
		return Order{}, ErrUnauthorized
	}
	return cloneOrder(o), nil
}
