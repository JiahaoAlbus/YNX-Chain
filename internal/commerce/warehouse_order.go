package commerce

import (
	"net/http"
	"strconv"
)

// Warehouse DATA only, independent of payment/refund finality and approval.
type WarehouseOrderLine struct{ ProductID, VariantID, OrderedQuantity, ReceivedQuantity, RemainingQuantity string }
type WarehouseReceipt struct {
	ReceiptID, ReturnID, EvidenceReference string
	Items                                  []ReturnItem
	Restocked                              bool
}
type WarehouseOrderView struct {
	OrderID, StoreID, Status string
	ApprovedReturns          []string
	Lines                    []WarehouseOrderLine
	Receipts                 []WarehouseReceipt
	QueryOnly                bool
	FundsVerified            bool
}

func (s *Store) ReadWarehouseOrder(actor, orderID string) (WarehouseOrderView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.s.Orders[orderID]
	if !ok {
		return WarehouseOrderView{}, ErrNotFound
	}
	role, ok := s.sellerRoleLocked(o.StoreID, actor)
	if !ok || !(sellerRoleAllows(role, permissionFulfillmentWrite) || sellerRoleAllows(role, permissionInventoryWrite) || sellerRoleAllows(role, permissionReturnResolve)) {
		return WarehouseOrderView{}, ErrUnauthorized
	}
	remaining, err := returnRemaining(o)
	if err != nil {
		return WarehouseOrderView{}, err
	}
	v := WarehouseOrderView{OrderID: o.ID, StoreID: o.StoreID, Status: o.Status, ApprovedReturns: []string{}, Lines: []WarehouseOrderLine{}, Receipts: []WarehouseReceipt{}, QueryOnly: true, FundsVerified: false}
	for _, event := range o.Timeline {
		if event.Action == "order_transition" && event.Status == "return_requested" && approvedReturn(o, event.ID) {
			v.ApprovedReturns = append(v.ApprovedReturns, event.ID)
		}
	}
	for _, line := range o.Lines {
		left := remaining[returnSKU{line.ProductID, line.VariantID}]
		v.Lines = append(v.Lines, WarehouseOrderLine{line.ProductID, line.VariantID, strconv.FormatInt(line.Quantity, 10), strconv.FormatInt(line.Quantity-left, 10), strconv.FormatInt(left, 10)})
	}
	for _, receipt := range o.ReturnReceipts {
		v.Receipts = append(v.Receipts, WarehouseReceipt{receipt.ID, receipt.ReturnID, receipt.EvidenceReference, append([]ReturnItem(nil), receipt.Items...), receipt.RestockedAt != nil})
	}
	return v, nil
}

func (s *Server) warehouseOrder(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	// Fixed POST read: JSON cannot select an actor or alternate order/Source.
	var input struct{}
	if !decode(w, r, &input) {
		return
	}
	view, err := s.store.ReadWarehouseOrder(sess.Account, r.PathValue("id"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, view)
}
