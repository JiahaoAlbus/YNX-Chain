package commerce

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
)

type sellerMutationLookupInput struct{ Method, Path, OriginalBody string }

func (s *Server) sellerMutationLookup(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in sellerMutationLookupInput
	if !decode(w, r, &in) {
		return
	}
	result, key, err := s.store.lookupSellerMutation(sess.Account, in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	actor := sess.Account
	if verified, ok := r.Context().Value(businessRequestContextKey{}).(*verifiedBusinessRequest); ok && verified.walletAccount != "" {
		actor = verified.walletAccount
	}
	write(w, 200, map[string]any{"Actor": actor, "Method": in.Method, "Path": in.Path, "IdempotencyKey": key, "Result": result})
}

// Pure original Store readback under the current Seller action fence. No call
// to mutation helpers, providers, new transition, or idempotency registration.
func (s *Store) lookupSellerMutation(actor string, in sellerMutationLookupInput) (any, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(in.OriginalBody) == 0 || len(in.OriginalBody) > 1<<20 {
		return nil, "", ErrConflict
	}
	route, key, storeID, target, kind := "", "", "", "", ""
	detached := func(value any) (any, string, error) {
		raw, err := json.Marshal(value)
		if err != nil {
			return nil, "", err
		}
		var copy any
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		err = decoder.Decode(&copy)
		return copy, key, err
	}
	permission := permissionSellerRead
	var original any
	decode := func(out any) bool { return decodeBusinessBody([]byte(in.OriginalBody), out) == nil }
	switch {
	case in.Method == "POST" && in.Path == "/seller/stores":
		var input CreateStoreInput
		if !decode(&input) {
			return nil, "", ErrConflict
		}
		route, key, original = "store.create", input.IdempotencyKey, input
		kind = "store"
	case in.Method == "POST" && in.Path == "/seller/products":
		var input CreateProductInput
		if !decode(&input) {
			return nil, "", ErrConflict
		}
		route, key, storeID, original = "product.create", input.IdempotencyKey, input.StoreID, input
		kind = "product"
		permission = permissionCatalogWrite
	case in.Method == "PUT" && strings.HasPrefix(in.Path, "/seller/products/"):
		target = strings.TrimPrefix(in.Path, "/seller/products/")
		if target == "" || strings.Contains(target, "/") {
			return nil, "", ErrConflict
		}
		p, ok := s.s.Products[target]
		if !ok {
			return nil, "", ErrNotFound
		}
		storeID = p.StoreID
		var input UpdateProductInput
		if !decode(&input) {
			return nil, "", ErrConflict
		}
		route, key, original = "product.update."+target, input.IdempotencyKey, input
		kind = "product"
		permission = permissionCatalogWrite
	case in.Method == "POST" && in.Path == "/seller/inventory":
		var input InventoryInput
		if !decode(&input) {
			return nil, "", ErrConflict
		}
		route, key, storeID, target, original = "inventory.set", input.IdempotencyKey, input.StoreID, input.ProductID, input
		kind = "product"
		permission = permissionInventoryWrite
	case in.Method == "POST" && strings.HasPrefix(in.Path, "/orders/") && strings.HasSuffix(in.Path, "/transition"):
		parts := strings.Split(in.Path, "/")
		if len(parts) != 4 {
			return nil, "", ErrConflict
		}
		target = parts[2]
		order, ok := s.s.Orders[target]
		if !ok {
			return nil, "", ErrNotFound
		}
		storeID = order.StoreID
		var input orderTransitionInput
		if !decode(&input) {
			return nil, "", ErrConflict
		}
		switch input.Action {
		case "shipped", "delivered":
			permission = permissionFulfillmentWrite
		case "return_approved", "return_rejected":
			permission = permissionReturnResolve
		case "refund_rejected":
			permission = permissionRefundApprove
		default:
			return nil, "", ErrConflict
		}
		ship, res, review := input.parts()
		original = struct {
			OrderID, Next string
			Shipment      *Shipment
			Resolution    *Resolution
			Review        *Review
		}{target, input.Action, ship, res, review}
		route, key, kind = "order.transition."+target, input.IdempotencyKey, "order"
	default:
		parts := strings.Split(in.Path, "/")
		if len(parts) < 6 || len(parts) > 7 || parts[1] != "seller" || parts[2] != "stores" || parts[4] != "providers" || parts[3] == "" {
			return nil, "", ErrConflict
		}
		storeID = parts[3]
		providerKind, err := normalizeProviderKind(parts[5])
		if err != nil {
			return nil, "", ErrConflict
		}
		target = providerKey(storeID, providerKind)
		if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
			return nil, "", err
		}
		switch {
		case len(parts) == 6 && in.Method == "PUT":
			var input ProviderConfigInput
			if !decode(&input) {
				return nil, "", ErrConflict
			}
			route, key, original = "provider.configure."+storeID+"."+providerKind, input.IdempotencyKey, input
		case len(parts) == 7 && parts[6] == "disable" && in.Method == "POST":
			var input ProviderDisableInput
			if !decode(&input) {
				return nil, "", ErrConflict
			}
			route, key, original = "provider.disable."+storeID+"."+providerKind, input.IdempotencyKey, input
		case len(parts) == 7 && parts[6] == "rotate" && in.Method == "POST":
			var input ProviderRotationInput
			if !decode(&input) {
				return nil, "", ErrConflict
			}
			route, key, original = "provider.rotate."+storeID+"."+providerKind, input.IdempotencyKey, input
		default:
			return nil, "", ErrConflict
		}
		kind = "provider"
	}
	if len(key) < 8 || len(key) > 128 {
		return nil, "", ErrConflict
	}
	if storeID != "" {
		if err := s.requireSellerPermissionLocked(storeID, actor, permission); err != nil {
			return nil, "", err
		}
	}
	for _, alias := range businessActorAliases(actor) {
		if _, retired := s.s.RetiredIdempotency[retiredIdempotencyDigest(alias, route, key)]; retired {
			return nil, "", ErrConflict
		}
	}
	rec, ok := s.s.Idempotency[idemMapKey(actor, route, key)]
	if !ok || rec.Actor != actor || rec.Route != route || rec.Key != key || rec.RequestHash != requestHash(original) || (target != "" && rec.ObjectID != target) {
		return nil, "", ErrConflict
	}
	switch kind {
	case "store":
		value, ok := s.s.Stores[rec.ObjectID]
		if !ok || value.Owner != actor {
			return nil, "", ErrUnauthorized
		}
		if err := s.requireSellerLocked(value.ID, actor, SellerRoleOwner); err != nil {
			return nil, "", err
		}
		return detached(value)
	case "product":
		value, ok := s.s.Products[rec.ObjectID]
		if !ok || value.StoreID != storeID {
			return nil, "", ErrConflict
		}
		return detached(value)
	case "order":
		value, ok := s.s.Orders[rec.ObjectID]
		if !ok || value.StoreID != storeID {
			return nil, "", ErrConflict
		}
		return detached(value)
	case "provider":
		value, ok := s.s.ProviderConfigs[rec.ObjectID]
		if !ok || value.StoreID != storeID {
			return nil, "", ErrConflict
		}
		return detached(providerView(value))
	}
	return nil, "", ErrConflict
}
