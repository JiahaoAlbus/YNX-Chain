package commerce

import (
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

type CreateStoreInput struct{ Name, Description, Policy, TrustURL, SettlementAccount, IdempotencyKey string }
type CreateProductInput struct {
	StoreID, Title, Description, Category, IdempotencyKey string
	Variants                                              []Variant
}
type InventoryInput struct {
	StoreID, ProductID, VariantID string
	Inventory                     int64
	IdempotencyKey                string
}
type OrderInput struct {
	StoreID        string
	Items          []CartItem
	Address        Address
	IdempotencyKey string
}

func (s *Store) CreateStore(actor string, in CreateStoreInput) (StoreProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := validateStoreFields(in.Name, in.Description, in.Policy, in.TrustURL, in.SettlementAccount); err != nil {
		return StoreProfile{}, err
	}
	h, replay, err := s.idempotencyLocked(actor, "store.create", in.IdempotencyKey, in)
	if err != nil {
		return StoreProfile{}, err
	}
	if replay {
		v, ok := s.s.Stores[h]
		if !ok {
			return StoreProfile{}, ErrConflict
		}
		return v, nil
	}
	now := s.now()
	v := StoreProfile{ID: newID("store"), Owner: actor, Name: strings.TrimSpace(in.Name), Description: in.Description, Policy: in.Policy, TrustURL: in.TrustURL, SettlementAccount: in.SettlementAccount, Status: "onboarding", CreatedAt: now, UpdatedAt: now}
	s.s.Stores[v.ID] = v
	s.s.SellerRoles[v.ID] = map[string]string{actor: "owner"}
	s.recordIdempotencyLocked(actor, "store.create", in.IdempotencyKey, h, v.ID)
	s.auditLocked(actor, "seller", "store_created", "store", v.ID, "onboarding", "publication requires explicit owner approval")
	if err := s.persistLocked(); err != nil {
		return StoreProfile{}, err
	}
	return v, nil
}

func (s *Store) sellerRoleLocked(storeID, actor string) (string, bool) {
	roles := s.s.SellerRoles[storeID]
	role, ok := roles[actor]
	return role, ok
}
func (s *Store) requireSellerLocked(storeID, actor string, allowed ...string) error {
	role, ok := s.sellerRoleLocked(storeID, actor)
	if !ok {
		return ErrUnauthorized
	}
	for _, v := range allowed {
		if role == v {
			return nil
		}
	}
	return ErrUnauthorized
}

func (s *Store) ActivateStore(actor, id string) (StoreProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.s.Stores[id]
	if !ok {
		return StoreProfile{}, ErrNotFound
	}
	if err := s.requireSellerLocked(id, actor, "owner"); err != nil {
		return StoreProfile{}, err
	}
	if strings.TrimSpace(v.Policy) == "" {
		return StoreProfile{}, errors.New("seller policy required before activation")
	}
	v.Status = "active"
	v.UpdatedAt = s.now()
	s.s.Stores[id] = v
	s.auditLocked(actor, "seller", "store_activated", "store", id, "approved", "explicit owner action")
	if err := s.persistLocked(); err != nil {
		return StoreProfile{}, err
	}
	return v, nil
}

func (s *Store) CreateProduct(actor string, in CreateProductInput) (Product, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requireSellerLocked(in.StoreID, actor, "owner", "manager"); err != nil {
		return Product{}, err
	}
	if strings.TrimSpace(in.Title) == "" || len(in.Title) > 160 || len(in.Description) > 5000 || len(in.Category) > 80 || len(in.Variants) == 0 || len(in.Variants) > 50 {
		return Product{}, errors.New("title and variants required")
	}
	for i := range in.Variants {
		v := &in.Variants[i]
		if v.ID == "" {
			v.ID = newID("variant")
		}
		if v.Name == "" || len(v.Name) > 120 || v.SKU == "" || len(v.SKU) > 80 || v.PriceYNXT <= 0 || v.Inventory < 0 {
			return Product{}, errors.New("valid variant name, SKU, price and inventory required")
		}
		v.Reserved = 0
	}
	h, replay, err := s.idempotencyLocked(actor, "product.create", in.IdempotencyKey, in)
	if err != nil {
		return Product{}, err
	}
	if replay {
		return s.s.Products[h], nil
	}
	now := s.now()
	p := Product{ID: newID("product"), StoreID: in.StoreID, Title: in.Title, Description: in.Description, Category: in.Category, Variants: in.Variants, CreatedAt: now, UpdatedAt: now}
	s.s.Products[p.ID] = p
	s.recordIdempotencyLocked(actor, "product.create", in.IdempotencyKey, h, p.ID)
	s.auditLocked(actor, "seller", "catalog_draft_created", "product", p.ID, "draft", "not published")
	if err := s.persistLocked(); err != nil {
		return Product{}, err
	}
	return p, nil
}

func (s *Store) PublishProduct(actor, id string) (Product, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.s.Products[id]
	if !ok {
		return Product{}, ErrNotFound
	}
	if err := s.requireSellerLocked(p.StoreID, actor, "owner", "manager"); err != nil {
		return Product{}, err
	}
	st := s.s.Stores[p.StoreID]
	if st.Status != "active" {
		return Product{}, errors.New("active store required")
	}
	p.Published = true
	p.UpdatedAt = s.now()
	s.s.Products[id] = p
	s.auditLocked(actor, "seller", "product_published", "product", id, "approved", "explicit seller action")
	if err := s.persistLocked(); err != nil {
		return Product{}, err
	}
	return p, nil
}

func (s *Store) SetInventory(actor string, in InventoryInput) (Product, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.s.Products[in.ProductID]
	if !ok || p.StoreID != in.StoreID {
		return Product{}, ErrNotFound
	}
	if err := s.requireSellerLocked(in.StoreID, actor, "owner", "manager", "fulfillment"); err != nil {
		return Product{}, err
	}
	if in.Inventory < 0 {
		return Product{}, errors.New("inventory cannot be negative")
	}
	h, replay, err := s.idempotencyLocked(actor, "inventory.set", in.IdempotencyKey, in)
	if err != nil {
		return Product{}, err
	}
	if replay {
		return p, nil
	}
	found := false
	for i := range p.Variants {
		if p.Variants[i].ID == in.VariantID {
			if in.Inventory < p.Variants[i].Reserved {
				return Product{}, ErrInventory
			}
			p.Variants[i].Inventory = in.Inventory
			found = true
		}
	}
	if !found {
		return Product{}, ErrNotFound
	}
	p.UpdatedAt = s.now()
	s.s.Products[p.ID] = p
	s.recordIdempotencyLocked(actor, "inventory.set", in.IdempotencyKey, h, p.ID)
	s.auditLocked(actor, "seller", "inventory_set", "product", p.ID, "approved", fmt.Sprintf("available=%d", in.Inventory))
	if err := s.persistLocked(); err != nil {
		return Product{}, err
	}
	return p, nil
}

func (s *Store) CreateOrder(actor string, in OrderInput) (Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.recoverExpiredLocked() {
		if err := s.persistLocked(); err != nil {
			return Order{}, err
		}
	}
	if len(in.Items) == 0 || len(in.Items) > 50 {
		return Order{}, errors.New("one to fifty cart items required")
	}
	if in.Address.Recipient == "" || in.Address.Line1 == "" || in.Address.Country == "" || len(in.Address.Recipient) > 120 || len(in.Address.Line1) > 240 || len(in.Address.City) > 120 || len(in.Address.Region) > 120 || len(in.Address.PostalCode) > 40 || len(in.Address.Country) > 80 {
		return Order{}, errors.New("complete shipping address required")
	}
	h, replay, err := s.idempotencyLocked(actor, "order.create", in.IdempotencyKey, in)
	if err != nil {
		return Order{}, err
	}
	if replay {
		return s.s.Orders[h], nil
	}
	lines := []OrderLine{}
	var total int64
	seen := map[string]bool{}
	for _, item := range in.Items {
		if item.Quantity <= 0 || item.Quantity > 20 {
			return Order{}, errors.New("quantity must be 1 to 20")
		}
		key := item.ProductID + "/" + item.VariantID
		if seen[key] {
			return Order{}, errors.New("duplicate cart line")
		}
		seen[key] = true
		p, ok := s.s.Products[item.ProductID]
		if !ok || !p.Published || p.StoreID != in.StoreID {
			return Order{}, ErrNotFound
		}
		found := false
		for _, v := range p.Variants {
			if v.ID == item.VariantID {
				if v.Inventory-v.Reserved < item.Quantity {
					return Order{}, ErrInventory
				}
				if v.PriceYNXT > 0 && item.Quantity > (1<<62)/v.PriceYNXT {
					return Order{}, errors.New("order total overflow")
				}
				total += v.PriceYNXT * item.Quantity
				lines = append(lines, OrderLine{ProductID: p.ID, VariantID: v.ID, Title: p.Title, VariantName: v.Name, Quantity: item.Quantity, UnitPriceYNXT: v.PriceYNXT})
				found = true
			}
		}
		if !found {
			return Order{}, ErrNotFound
		}
	}
	for _, line := range lines {
		p := s.s.Products[line.ProductID]
		for i := range p.Variants {
			if p.Variants[i].ID == line.VariantID {
				p.Variants[i].Reserved += line.Quantity
			}
		}
		s.s.Products[p.ID] = p
	}
	now := s.now()
	o := Order{ID: newID("order"), Buyer: actor, StoreID: in.StoreID, Status: "payment_pending", Currency: NativeSymbol, Lines: lines, Address: in.Address, SubtotalYNXT: total, TotalYNXT: total, TaxStatus: "unavailable_no_tax_service", LogisticsStatus: "unavailable_no_logistics_provider", ReservationExpiresAt: now.Add(30 * time.Minute), CreatedAt: now, UpdatedAt: now}
	s.s.Orders[o.ID] = o
	s.recordIdempotencyLocked(actor, "order.create", in.IdempotencyKey, h, o.ID)
	s.auditLocked(actor, "buyer", "order_created", "order", o.ID, "payment_pending", "inventory reserved; Pay invoice handoff required")
	if err := s.persistLocked(); err != nil {
		return Order{}, err
	}
	return o, nil
}

func (s *Store) BindInvoice(actor, orderID, invoiceID string) (Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.s.Orders[orderID]
	if !ok {
		return Order{}, ErrNotFound
	}
	if o.Buyer != actor {
		return Order{}, ErrUnauthorized
	}
	if o.Status != "payment_pending" || invoiceID == "" {
		return Order{}, ErrInvalidState
	}
	if o.InvoiceID != "" && o.InvoiceID != invoiceID {
		return Order{}, ErrConflict
	}
	o.InvoiceID = invoiceID
	o.UpdatedAt = s.now()
	s.s.Orders[o.ID] = o
	s.auditLocked(actor, "buyer", "pay_invoice_bound", "order", o.ID, "pending", "awaiting authoritative settlement")
	if err := s.persistLocked(); err != nil {
		return Order{}, err
	}
	return o, nil
}

func (s *Store) ConfirmSettlement(orderID string, e SettlementEvidence) (Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.s.Orders[orderID]
	if !ok {
		return Order{}, ErrNotFound
	}
	if o.Status == "paid" && o.Settlement != nil && o.Settlement.TransactionHash == e.TransactionHash {
		return o, nil
	}
	if o.Status != "payment_pending" || o.InvoiceID == "" || e.InvoiceID != o.InvoiceID || e.Status != "paid" || e.TransactionHash == "" || e.BlockHeight == 0 || e.AmountYNXT != o.TotalYNXT {
		return Order{}, fmt.Errorf("%w: settlement evidence mismatch", ErrInvalidState)
	}
	for _, line := range o.Lines {
		p := s.s.Products[line.ProductID]
		for i := range p.Variants {
			if p.Variants[i].ID == line.VariantID {
				if p.Variants[i].Reserved < line.Quantity || p.Variants[i].Inventory < line.Quantity {
					return Order{}, ErrInventory
				}
				p.Variants[i].Reserved -= line.Quantity
				p.Variants[i].Inventory -= line.Quantity
			}
		}
		s.s.Products[p.ID] = p
	}
	o.Status = "paid"
	o.Settlement = &e
	o.UpdatedAt = s.now()
	s.s.Orders[o.ID] = o
	s.auditLocked("pay-settlement-verifier", "system", "settlement_confirmed", "order", o.ID, "paid", e.TransactionHash)
	if err := s.persistLocked(); err != nil {
		return Order{}, err
	}
	return o, nil
}

func (s *Store) Order(actor, role, id string) (Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.s.Orders[id]
	if !ok {
		return Order{}, ErrNotFound
	}
	if role == "buyer" && o.Buyer != actor {
		return Order{}, ErrUnauthorized
	}
	if role == "seller" {
		if _, ok := s.s.SellerRoles[o.StoreID][actor]; !ok {
			return Order{}, ErrUnauthorized
		}
	}
	return o, nil
}
func (s *Store) Orders(actor, role string) []Order {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Order{}
	for _, o := range s.s.Orders {
		if (role == "buyer" && o.Buyer == actor) || (role == "seller" && s.s.SellerRoles[o.StoreID][actor] != "") {
			out = append(out, o)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

func (s *Store) transition(actor, role, id, next string, shipment *Shipment, res *Resolution, review *Review, idempotencyKeys ...string) (Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if shipment != nil && (len(shipment.Carrier) > 120 || len(shipment.TrackingNumber) > 200) {
		return Order{}, errors.New("shipment fields exceed limits")
	}
	if res != nil && (len(res.Reason) > 1000 || len(res.Explanation) > 5000) {
		return Order{}, errors.New("resolution fields exceed limits")
	}
	if review != nil && len(review.Body) > 5000 {
		return Order{}, errors.New("review exceeds limits")
	}
	request := struct {
		OrderID, Next string
		Shipment      *Shipment
		Resolution    *Resolution
		Review        *Review
	}{id, next, shipment, res, review}
	requestDigest := ""
	if len(idempotencyKeys) > 0 {
		var replay bool
		var err error
		requestDigest, replay, err = s.idempotencyLocked(actor, "order.transition."+id, idempotencyKeys[0], request)
		if err != nil {
			return Order{}, err
		}
		if replay {
			existing, ok := s.s.Orders[requestDigest]
			if !ok {
				return Order{}, ErrConflict
			}
			return existing, nil
		}
	}
	o, ok := s.s.Orders[id]
	if !ok {
		return Order{}, ErrNotFound
	}
	buyer := role == "buyer" && o.Buyer == actor
	sellerRole := ""
	if role == "seller" {
		sellerRole = s.s.SellerRoles[o.StoreID][actor]
	}
	canFulfill := sellerRole == "owner" || sellerRole == "manager" || sellerRole == "fulfillment"
	canResolveReturn := sellerRole == "owner" || sellerRole == "manager" || sellerRole == "support"
	canApproveRefund := sellerRole == "owner" || sellerRole == "manager"
	allowed := false
	switch next {
	case "cancelled":
		allowed = buyer && o.Status == "payment_pending"
	case "shipped":
		allowed = canFulfill && o.Status == "paid" && shipment != nil && shipment.Carrier != "" && shipment.TrackingNumber != ""
	case "delivered":
		allowed = (buyer || canFulfill) && o.Status == "shipped"
	case "return_requested":
		allowed = buyer && (o.Status == "delivered" || o.Status == "reviewed") && res != nil
	case "refund_requested":
		allowed = buyer && (o.Status == "paid" || o.Status == "return_requested" || o.Status == "return_approved") && res != nil
	case "disputed":
		allowed = buyer && (o.Status == "paid" || o.Status == "shipped" || o.Status == "delivered" || o.Status == "reviewed" || o.Status == "return_requested" || o.Status == "return_approved" || o.Status == "refund_requested") && res != nil
	case "reviewed":
		allowed = buyer && o.Status == "delivered" && review != nil && review.Rating >= 1 && review.Rating <= 5
	case "return_approved", "return_rejected", "refund_approved", "refund_rejected":
		allowed = (strings.HasPrefix(next, "return") && canResolveReturn && o.Status == "return_requested") || (strings.HasPrefix(next, "refund") && canApproveRefund && o.Status == "refund_requested")
	}
	if !allowed {
		return Order{}, ErrInvalidState
	}
	if next == "cancelled" {
		for _, line := range o.Lines {
			p := s.s.Products[line.ProductID]
			for i := range p.Variants {
				if p.Variants[i].ID == line.VariantID {
					p.Variants[i].Reserved -= line.Quantity
				}
			}
			s.s.Products[p.ID] = p
		}
	}
	now := s.now()
	if shipment != nil {
		shipment.Status = next
		shipment.UpdatedAt = now
		o.Shipment = shipment
	}
	if res != nil {
		res.Status = next
		if res.RequestedAt.IsZero() {
			res.RequestedAt = now
		}
		res.UpdatedAt = now
		o.Resolution = res
	}
	if review != nil {
		review.CreatedAt = now
		o.Review = review
	}
	o.Status = next
	o.UpdatedAt = now
	s.s.Orders[id] = o
	if len(idempotencyKeys) > 0 {
		s.recordIdempotencyLocked(actor, "order.transition."+id, idempotencyKeys[0], requestDigest, id)
	}
	s.auditLocked(actor, role, "order_transition", "order", id, next, "explicit authorized action")
	if err := s.persistLocked(); err != nil {
		return Order{}, err
	}
	return o, nil
}

func validateStoreFields(name, description, policy, trustURL, settlementAccount string) error {
	if strings.TrimSpace(name) == "" || len(name) > 100 || len(description) > 3000 || len(policy) > 5000 || len(trustURL) > 500 {
		return errors.New("store profile fields exceed limits or name is missing")
	}
	if trustURL != "" {
		parsed, err := url.Parse(trustURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
			return errors.New("Trust evidence URL must be absolute HTTPS")
		}
	}
	if settlementAccount != "" && !consensus.IsNativeAddress(settlementAccount) {
		return errors.New("settlement account must be canonical ynx1 address")
	}
	return nil
}
