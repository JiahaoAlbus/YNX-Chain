package commerce

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// These are original Shop warehouse facts, not Pay/Chain proofs. Explicit
// current fulfillment and inventory actions remain separate from refunds.
type ReturnItem struct{ ProductID, VariantID, Quantity string }
type ReturnReceipt struct {
	ID, ReturnID, ReceivedBy, EvidenceReference, RequestHash string
	Items                                                    []ReturnItem
	ReceivedAt                                               time.Time
	RestockedBy                                              string     `json:",omitempty"`
	RestockedAt                                              *time.Time `json:",omitempty"`
}
type ReceiveReturnInput struct {
	ReturnID, EvidenceReference, IdempotencyKey string
	Items                                       []ReturnItem
}
type RestockReturnInput struct{ ReceiptID, IdempotencyKey string }
type returnSKU struct{ product, variant string }

func returnQuantity(value string) (int64, error) {
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil || n <= 0 || strconv.FormatInt(n, 10) != value {
		return 0, fmt.Errorf("%w: canonical positive return quantity required", ErrInvalidState)
	}
	return n, nil
}

// A return is the original server-created request event, followed by its
// original approval, not a caller-provided replacement case or refund state.
func approvedReturn(order Order, id string) bool {
	if !invoiceRecoveryID.MatchString(id) {
		return false
	}
	requested := false
	for _, event := range order.Timeline {
		if event.Action != "order_transition" {
			continue
		}
		if event.Status == "return_requested" {
			requested = event.ID == id
		}
		if requested && event.Status == "return_rejected" {
			return false
		}
		if requested && event.Status == "return_approved" {
			return true
		}
	}
	return false
}

func returnRemaining(order Order) (map[returnSKU]int64, error) {
	remaining := make(map[returnSKU]int64)
	if len(order.Lines) == 0 {
		return nil, ErrInvalidState
	}
	for _, line := range order.Lines {
		key := returnSKU{line.ProductID, line.VariantID}
		if line.ProductID == "" || line.VariantID == "" || line.Quantity <= 0 || remaining[key] != 0 {
			return nil, ErrInvalidState
		}
		remaining[key] = line.Quantity
	}
	ids := make(map[string]bool)
	references := make(map[string]bool)
	for _, receipt := range order.ReturnReceipts {
		if receipt.ID == "" || ids[receipt.ID] || !invoiceRecoveryID.MatchString(receipt.EvidenceReference) || references[receipt.EvidenceReference] || receipt.ReceivedBy == "" || receipt.ReceivedAt.IsZero() || len(receipt.Items) == 0 || len(receipt.Items) > 50 || !approvedReturn(order, receipt.ReturnID) {
			return nil, ErrInvalidState
		}
		if receipt.RestockedAt != nil && (receipt.RestockedAt.IsZero() || receipt.RestockedBy == "") {
			return nil, ErrInvalidState
		}
		ids[receipt.ID] = true
		references[receipt.EvidenceReference] = true
		seen := make(map[returnSKU]bool)
		for _, item := range receipt.Items {
			key := returnSKU{item.ProductID, item.VariantID}
			n, err := returnQuantity(item.Quantity)
			if err != nil || seen[key] || remaining[key] < n {
				return nil, ErrInvalidState
			}
			seen[key] = true
			remaining[key] -= n
		}
	}
	return remaining, nil
}

func (s *Store) ReceiveReturn(actor, id string, in ReceiveReturnInput) (Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.s.Orders[id]
	if !ok {
		return Order{}, ErrNotFound
	}
	if err := s.requireSellerPermissionLocked(o.StoreID, actor, permissionFulfillmentWrite); err != nil {
		return Order{}, err
	}
	route := "return.receive." + id
	h, replay, err := s.idempotencyLocked(actor, route, in.IdempotencyKey, in)
	if err != nil {
		return Order{}, err
	}
	if replay {
		if h != id {
			return Order{}, ErrConflict
		}
		return cloneOrder(o), nil
	}
	if !approvedReturn(o, in.ReturnID) || o.Shipment == nil || o.Settlement == nil || !settlementMatchesOrder(o, *o.Settlement) {
		return Order{}, fmt.Errorf("%w: original approved fulfilled return required", ErrInvalidState)
	}
	if !invoiceRecoveryID.MatchString(in.EvidenceReference) || len(in.Items) == 0 || len(in.Items) > 50 || len(o.ReturnReceipts) >= 1000 {
		return Order{}, ErrInvalidState
	}
	// The warehouse reference must identify this receipt, not another order's
	// physical goods. A batch reference needs distinct explicit order suffixes.
	for _, existing := range s.s.Orders {
		if existing.StoreID == o.StoreID {
			for _, receipt := range existing.ReturnReceipts {
				if receipt.EvidenceReference == in.EvidenceReference {
					return Order{}, ErrConflict
				}
			}
		}
	}
	remaining, err := returnRemaining(o)
	if err != nil {
		return Order{}, err
	}
	seen := make(map[returnSKU]bool)
	for _, item := range in.Items {
		key := returnSKU{item.ProductID, item.VariantID}
		n, err := returnQuantity(item.Quantity)
		if err != nil || seen[key] || remaining[key] < n {
			return Order{}, fmt.Errorf("%w: return exceeds original remaining quantity", ErrInvalidState)
		}
		seen[key] = true
	}
	before, err := cloneSnapshot(s.s)
	if err != nil {
		return Order{}, err
	}
	o = cloneOrder(o)
	when := s.now()
	receipt := ReturnReceipt{ID: newID("return_receipt"), ReturnID: in.ReturnID, ReceivedBy: actor, EvidenceReference: in.EvidenceReference, RequestHash: requestHash(in), Items: append([]ReturnItem(nil), in.Items...), ReceivedAt: when}
	o.ReturnReceipts = append(o.ReturnReceipts, receipt)
	o.UpdatedAt = when
	s.orderEventLocked(&o, actor, "seller", "return_received", o.Status, receipt.ID)
	s.s.Orders[id] = o
	s.recordIdempotencyLocked(actor, route, in.IdempotencyKey, h, id)
	s.auditLocked(actor, "seller", "return_received", "order", id, "seller_confirmed", receipt.ID)
	if err = s.persistLocked(); err != nil {
		s.s = before
		return Order{}, err
	}
	return cloneOrder(o), nil
}

func (s *Store) RestockReturn(actor, id string, in RestockReturnInput) (Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.s.Orders[id]
	if !ok {
		return Order{}, ErrNotFound
	}
	if err := s.requireSellerPermissionLocked(o.StoreID, actor, permissionInventoryWrite); err != nil {
		return Order{}, err
	}
	route := "return.restock." + id
	h, replay, err := s.idempotencyLocked(actor, route, in.IdempotencyKey, in)
	if err != nil {
		return Order{}, err
	}
	if replay {
		if h != id {
			return Order{}, ErrConflict
		}
		return cloneOrder(o), nil
	}
	if _, err := returnRemaining(o); err != nil {
		return Order{}, err
	}
	index := -1
	for i, receipt := range o.ReturnReceipts {
		if receipt.ID == in.ReceiptID {
			if index != -1 {
				return Order{}, ErrConflict
			}
			index = i
		}
	}
	if index == -1 {
		return Order{}, ErrNotFound
	}
	receipt := o.ReturnReceipts[index]
	if receipt.RestockedAt != nil {
		return Order{}, fmt.Errorf("%w: original return receipt already restocked", ErrConflict)
	}
	if receipt.ReceivedBy == "" || receipt.ReceivedAt.IsZero() || !approvedReturn(o, receipt.ReturnID) || len(receipt.Items) == 0 {
		return Order{}, ErrInvalidState
	}
	products := make(map[string]Product)
	seen := make(map[returnSKU]bool)
	for _, item := range receipt.Items {
		key := returnSKU{item.ProductID, item.VariantID}
		n, err := returnQuantity(item.Quantity)
		if err != nil || seen[key] {
			return Order{}, ErrInvalidState
		}
		seen[key] = true
		p, staged := products[item.ProductID]
		if !staged {
			original, ok := s.s.Products[item.ProductID]
			if !ok || original.ID != item.ProductID || original.StoreID != o.StoreID || original.Revision < 0 || original.Revision == math.MaxInt64 {
				return Order{}, ErrInventory
			}
			p = cloneProduct(original)
		}
		variant := -1
		for i, v := range p.Variants {
			if v.ID == item.VariantID {
				if variant != -1 {
					return Order{}, ErrInventory
				}
				variant = i
			}
		}
		if variant == -1 {
			return Order{}, ErrInventory
		}
		v := &p.Variants[variant]
		if v.Inventory < 0 || v.Reserved < 0 || v.Inventory < v.Reserved || n > math.MaxInt64-v.Inventory {
			return Order{}, ErrInventory
		}
		v.Inventory += n
		products[p.ID] = p
	}
	before, err := cloneSnapshot(s.s)
	if err != nil {
		return Order{}, err
	}
	for id, p := range products {
		p.Revision++
		p.UpdatedAt = s.now()
		s.s.Products[id] = p
	}
	o = cloneOrder(o)
	when := s.now()
	o.ReturnReceipts[index].RestockedAt = &when
	o.ReturnReceipts[index].RestockedBy = actor
	o.UpdatedAt = when
	s.orderEventLocked(&o, actor, "seller", "return_restocked", o.Status, receipt.ID)
	s.s.Orders[id] = o
	s.recordIdempotencyLocked(actor, route, in.IdempotencyKey, h, id)
	s.auditLocked(actor, "seller", "return_restocked", "order", id, "stock_only", receipt.ID)
	if err = s.persistLocked(); err != nil {
		s.s = before
		return Order{}, err
	}
	return cloneOrder(o), nil
}

func (s *Server) receiveReturn(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in ReceiveReturnInput
	if !decode(w, r, &in) {
		return
	}
	result, err := s.store.ReceiveReturn(actor.Account, r.PathValue("id"), in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, result)
}
func (s *Server) restockReturn(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in RestockReturnInput
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.ReceiptID) != in.ReceiptID {
		fail(w, 400, ErrInvalidState)
		return
	}
	result, err := s.store.RestockReturn(actor.Account, r.PathValue("id"), in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, result)
}
