package commerce

import (
	"bytes"
	"encoding/json"
	"net/http"
)

// Preserve the original stored Buyer representation. Expose its already verified
// Wallet representation only when this response actually names the current actor.
// This is a response hint, never a role, grant, alias record or authorization input.
func buyerWalletWire(value any, verified *verifiedBusinessRequest) any {
	if verified == nil || verified.walletAccount == "" || verified.principal.Role != "buyer" {
		return value
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var out any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&out) != nil {
		return value
	}
	var project func(any)
	project = func(node any) {
		switch v := node.(type) {
		case map[string]any:
			if buyer, ok := v["Buyer"].(string); ok && (buyer == verified.principal.Account || buyer == verified.walletAccount) {
				v["WalletBuyer"] = verified.walletAccount
			}
			for _, child := range v {
				project(child)
			}
		case []any:
			for _, child := range v {
				project(child)
			}
		}
	}
	project(out)
	return out
}
func writeBuyerBusiness(w http.ResponseWriter, code int, value any, verified *verifiedBusinessRequest) {
	write(w, code, buyerWalletWire(value, verified))
}

// Read only the original durable bound invoice. Unknown provider creation is
// not redispatched and cannot be converted into a new invoice by this route.
func (s *Server) invoiceReference(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "buyer")
	if !ok {
		return
	}
	order, err := s.store.Order(actor.Account, "buyer", r.PathValue("id"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	reference, err := boundInvoiceHandoff(order)
	if err != nil {
		failBusiness(w, &businessHTTPError{"INVOICE_REFERENCE_NOT_READY", 409})
		return
	}
	write(w, 200, invoiceEffectResponse(order, reference))
}
