package payproduct

import (
	"net/http"
	"strings"
)

// Read the original committed result. This never invokes a provider or retries
// a mutation. Legacy records without an atomic original actor/body binding stay
// unresolved; an admission alone is not evidence that a request committed.
type merchantMutationLookupInput struct {
	Method       string `json:"method"`
	Path         string `json:"path"`
	OriginalBody string `json:"originalBody"`
}

func (s *Server) merchantMutationLookup(w http.ResponseWriter, r *http.Request) {
	if _, ok := r.Context().Value(canonicalMerchantKey{}).(MerchantPrincipal); !ok {
		businessError(w, merchantDenied("MERCHANT_CANONICAL_AUTHORITY_REQUIRED", 401))
		return
	}
	p, body, ok := s.merchantAuth(w, r, "read")
	if !ok {
		return
	}
	var in merchantMutationLookupInput
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.lookupMerchantMutation(p, in)
	if err != nil {
		businessError(w, err)
		return
	}
	writeJSON(w, 200, out)
}
func (s *Service) lookupMerchantMutation(p MerchantPrincipal, in merchantMutationLookupInput) (map[string]any, error) {
	unresolved := func() error { return merchantDenied("MERCHANT_MUTATION_OUTCOME_UNCONFIRMED", 409) }
	if in.Method != "POST" || len(in.OriginalBody) == 0 || len(in.OriginalBody) > maxRequestBytes {
		return nil, unresolved()
	}
	permission, scope, key, requestHash := "invoice", "", "", ""
	switch in.Path {
	case "/v1/merchant/catalog":
		var input CatalogInput
		if strictJSON([]byte(in.OriginalBody), &input) != nil {
			return nil, unresolved()
		}
		scope, key, requestHash = "catalog", input.IdempotencyKey, hashJSON(input)
	case "/v1/merchant/invoices":
		var input InvoiceInput
		if strictJSON([]byte(in.OriginalBody), &input) != nil {
			return nil, unresolved()
		}
		scope, key, requestHash = "invoice", input.IdempotencyKey, invoiceRequestHash(input, nil)
	case "/v1/merchant/recurring-drafts":
		if p.Role != "owner" && p.Role != "finance" {
			return nil, merchantDenied("MERCHANT_MEMBERSHIP_REQUIRED", 403)
		}
		var input RecurringDraftInput
		if strictJSON([]byte(in.OriginalBody), &input) != nil {
			return nil, unresolved()
		}
		scope, key, requestHash = "recurring-draft", input.IdempotencyKey, hashJSON(input)
	default:
		parts := strings.Split(in.Path, "/")
		if len(parts) != 6 || parts[1] != "v1" || parts[2] != "merchant" || parts[3] != "webhooks" || parts[5] != "retry" || !identifierRE.MatchString(parts[4]) {
			return nil, unresolved()
		}
		var input struct {
			Reason         string `json:"reason"`
			IdempotencyKey string `json:"idempotencyKey"`
		}
		if strictJSON([]byte(in.OriginalBody), &input) != nil {
			return nil, unresolved()
		}
		permission, scope, key, requestHash = "webhook", "webhook-replay", input.IdempotencyKey, hashJSON(map[string]string{"deliveryId": parts[4], "reason": input.Reason})
	}
	if !roleAllows(p.Role, permission) {
		return nil, merchantDenied("MERCHANT_MEMBERSHIP_REQUIRED", 403)
	}
	validated, err := validKey(key)
	if err != nil || validated != key {
		return nil, unresolved()
	}
	var result any
	err = s.store.View(func(data Snapshot) error {
		rec, ok := data.Idempotency[scope+":"+p.Merchant.ID+":"+key]
		if !ok || rec.Scope != scope || rec.Key != key || rec.RequestHash != requestHash || rec.OriginalAccount != p.Account || rec.OriginalBodyDigest != hexSHA([]byte(in.OriginalBody)) {
			return unresolved()
		}
		switch scope {
		case "catalog":
			item, ok := data.Catalog[rec.ObjectID]
			if !ok || item.MerchantID != p.Merchant.ID {
				return unresolved()
			}
			result = item
		case "invoice":
			item, ok := data.Invoices[rec.ObjectID]
			if !ok || item.MerchantID != p.Merchant.ID {
				return unresolved()
			}
			result = item
		case "recurring-draft":
			item, ok := data.RecurringDrafts[rec.ObjectID]
			if !ok || item.MerchantID != p.Merchant.ID {
				return unresolved()
			}
			result = item
		case "webhook-replay":
			item, ok := data.Deliveries[rec.ObjectID]
			if !ok || item.MerchantID != p.Merchant.ID || item.ReplayedBy != p.Account || item.ParentDeliveryID != strings.Split(in.Path, "/")[4] {
				return unresolved()
			}
			result = item
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"account": p.Account, "merchantId": p.Merchant.ID, "method": in.Method, "path": in.Path, "idempotencyKey": key, "result": result}, nil
}
