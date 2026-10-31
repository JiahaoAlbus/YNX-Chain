package commerce

import (
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
)

// OrderProjection is a local service DTO, not the SDK SourceRef or a task grant.
// Snapshot identifies the complete original order, including redacted fields;
// it is a content precondition, never a tenant, permission or SDK revision.
type OrderProjection struct {
	OrderID  string         `json:"orderId"`
	Snapshot string         `json:"snapshot"`
	Fields   []string       `json:"fields"`
	Data     map[string]any `json:"data"`
}

// ReadScopedOrder rechecks original buyer/seller permissions and creates a
// detached, allowlisted projection from one locked order snapshot. It does not
// authorize an AI task. A protected Auth resource/effect adapter must precede
// any use by shop.order.read; a human session cannot substitute for that grant.
func (s *Store) ReadScopedOrder(actor, role, id string, fields []string, snapshot string) (OrderProjection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.s.Orders[id]
	if !ok {
		return OrderProjection{}, ErrNotFound
	}
	allowed := role == "buyer" && o.Buyer == actor
	if role == "seller" {
		r, member := s.sellerRoleLocked(o.StoreID, actor)
		allowed = member && sellerRoleAllows(r, permissionSellerRead)
	}
	if !allowed {
		return OrderProjection{}, ErrUnauthorized
	}
	// Never project nested free text, address/contact, identifiers of accounts,
	// invoices, receipts, tracking or timelines into a model by default.
	values := map[string]any{
		"status": o.Status, "currency": o.Currency,
		"totalYNXT": strconv.FormatInt(o.TotalYNXT, 10), "subtotalYNXT": strconv.FormatInt(o.SubtotalYNXT, 10),
		"shippingYNXT": strconv.FormatInt(o.ShippingYNXT, 10), "taxYNXT": strconv.FormatInt(o.TaxYNXT, 10),
		"createdAt": o.CreatedAt, "updatedAt": o.UpdatedAt,
		"reservationExpiresAt": o.ReservationExpiresAt,
	}
	if len(fields) == 0 {
		fields = []string{"status", "currency", "totalYNXT"}
	}
	selected := make(map[string]any, len(fields))
	for _, field := range fields {
		v, valid := values[field]
		if !valid {
			return OrderProjection{}, fmt.Errorf("%w: unsupported order projection field", ErrInvalidState)
		}
		if _, duplicate := selected[field]; duplicate {
			return OrderProjection{}, fmt.Errorf("%w: duplicate order projection field", ErrInvalidState)
		}
		selected[field] = v
	}
	raw, err := json.Marshal(o)
	if err != nil {
		return OrderProjection{}, err
	}
	hash := sha512.Sum512(raw)
	version := hex.EncodeToString(hash[:])
	if snapshot != "" && snapshot != version {
		return OrderProjection{}, fmt.Errorf("%w: order snapshot changed", ErrConflict)
	}
	keys := make([]string, 0, len(selected))
	for key := range selected {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return OrderProjection{OrderID: o.ID, Snapshot: version, Fields: keys, Data: selected}, nil
}

// This session endpoint is for existing product clients. It is deliberately
// separate from the task endpoint and admits no caller-supplied actor/tenant.
func (s *Server) orderProjection(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	actor, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	var in struct {
		Fields   []string `json:"fields"`
		Snapshot string   `json:"snapshot"`
	}
	if !decode(w, r, &in) {
		return
	}
	projection, err := s.store.ReadScopedOrder(actor.Account, actor.Role, r.PathValue("id"), in.Fields, in.Snapshot)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, http.StatusOK, projection)
}

// The normal task path fails closed until original Auth supplies its protected
// Source/current resource fence and sole SDK codec. No request DTO, transport
// peer, model assertion or ordinary buyer login activates this authority.
func (s *Server) taskOrderRead(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	write(w, http.StatusServiceUnavailable, map[string]string{
		"code":  "SHOP_TASK_ORDER_READ_NOT_ADMITTED",
		"error": "protected task grant resource fence and sole SDK source codec not supplied",
	})
}
