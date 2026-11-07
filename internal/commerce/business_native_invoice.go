package commerce

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"time"
)

// This is the original approved pricing/bill DATA port, not an authority port.
// Its implementation cannot grant merchant membership, choose CORE terms or
// authorize a signature/send: P06's real joint Source independently does that.
type OriginalShopNativeInvoiceDATAReader interface {
	ReadOriginalShopInvoiceDATA(context.Context, ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error)
}
type ShopNativeInvoiceSelectionDATA struct {
	Order         Order
	WalletAccount string
	FrozenBill    json.RawMessage
}
type ShopNativeInvoicePriceDATA struct {
	Merchant, Recipient, Genesis, NativeChainID, AssetID, UnitVersion, AmountAtoms, PriceApprovalRef string
}
type nativeInvoiceInput struct {
	Order          Order
	Origin         string
	Request        NativeShopInvoiceRequestDATA
	OriginalEffect string `json:",omitempty"`
}

// Original product resource DATA for Main/Pay's Source-owned
// readOriginalInvoiceIntent({productId,sourceOrder},current). The caller must
// separately hold its real Source/current; this method grants no authority.
// Read the captured original, never regenerate it from today's catalog/price.
func (s *Store) ReadOriginalShopNativeInvoiceRequestDATA(actor, role, orderID string) (NativeShopInvoiceRequestDATA, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readOriginalShopNativeInvoiceRequestLocked(actor, role, orderID)
}

func (s *Store) readOriginalShopNativeInvoiceRequestLocked(actor, role, orderID string) (NativeShopInvoiceRequestDATA, error) {
	// The original permission/object selection and captured request share one
	// original Store lock; a role revocation cannot slip between two reads.
	staged := &Store{s: s.s, now: s.now}
	order, e := staged.Order(actor, role, orderID)
	if e != nil {
		return NativeShopInvoiceRequestDATA{}, e
	}
	for _, record := range s.s.BusinessEffects {
		if record.Kind != "pay.native-create" || record.Target != orderID {
			continue
		}
		var saved nativeInvoiceInput
		if e := decodeEffect(record.Input, &saved); e != nil {
			return NativeShopInvoiceRequestDATA{}, e
		}
		if !sameNativeInvoiceBill(order, saved.Order) || saved.Request.ProductID != "shop.order" || saved.Request.SourceOrder != order.ID || saved.Request.StoreID != order.StoreID {
			return NativeShopInvoiceRequestDATA{}, ErrConflict
		}
		saved.Request.DomainData = bytes.Clone(saved.Request.DomainData)
		return saved.Request, nil
	}
	return NativeShopInvoiceRequestDATA{}, ErrNotFound
}

// No current catalog lookup or decimal->atom conversion occurs on this path.
// The exact checkout and separate approved Native price DATA are retained.
func nativeInvoiceBillDATA(o Order) (json.RawMessage, error) {
	return json.Marshal(struct {
		ID, Buyer, StoreID, Currency                   string
		Lines                                          []OrderLine
		Address                                        Address
		SubtotalYNXT, ShippingYNXT, TaxYNXT, TotalYNXT int64
		CreatedAt                                      time.Time
		NativePrice                                    *NativeOrderPriceDATA `json:",omitempty"`
	}{o.ID, o.Buyer, o.StoreID, o.Currency, o.Lines, o.Address, o.SubtotalYNXT, o.ShippingYNXT, o.TaxYNXT, o.TotalYNXT, o.CreatedAt, o.NativePrice})
}
func sameNativeInvoiceBill(a, b Order) bool {
	x, e := nativeInvoiceBillDATA(a)
	y, f := nativeInvoiceBillDATA(b)
	return e == nil && f == nil && bytes.Equal(x, y)
}

func nativeInvoiceRequestDATA(o Order, p ShopNativeInvoicePriceDATA) (NativeShopInvoiceRequestDATA, error) {
	var zero NativeShopInvoiceRequestDATA
	account := func(v string) bool {
		raw, e := hex.DecodeString(vPrefix(v, "0x"))
		return len(v) == 42 && len(raw) == 20 && e == nil && "0x"+hex.EncodeToString(raw) == v
	}
	gen, e := hex.DecodeString(p.Genesis)
	n, ne := strconv.ParseUint(p.NativeChainID, 10, 64)
	amount, ae := strconv.ParseUint(p.AmountAtoms, 10, 64)
	if !account(p.Merchant) || !account(p.Recipient) || e != nil || len(gen) != 32 || hex.EncodeToString(gen) != p.Genesis || ne != nil || strconv.FormatUint(n, 10) != p.NativeChainID || ae != nil || amount == 0 || strconv.FormatUint(amount, 10) != p.AmountAtoms || p.AssetID != "YNXT" || p.UnitVersion != "1" || len(p.PriceApprovalRef) == 0 || len(p.PriceApprovalRef) > 256 {
		return zero, ErrInvalidState
	}
	bill, e := nativeInvoiceBillDATA(o)
	if e != nil {
		return zero, e
	}
	domain, e := json.Marshal(struct {
		Schema string                     `json:"schema"`
		Order  json.RawMessage            `json:"order"`
		Price  ShopNativeInvoicePriceDATA `json:"approvedNativePrice"`
	}{"ynx.shop.order.invoice/v1", bill, p})
	if e != nil || len(domain) > 64<<10 {
		return zero, ErrInvalidState
	}
	return NativeShopInvoiceRequestDATA{"shop.order", o.StoreID, o.ID, p.Merchant, p.Recipient, p.Genesis, p.NativeChainID, p.AssetID, p.UnitVersion, p.AmountAtoms, domain}, nil
}
func vPrefix(v, p string) string {
	if len(v) >= len(p) && v[:len(p)] == p {
		return v[len(p):]
	}
	return ""
}

func nativeInvoiceReply(saved nativeInvoiceInput, raw json.RawMessage, query bool) (NativeShopIntentObservation, PayInvoiceHandoff, error) {
	var v struct {
		IntentID          string                       `json:"intentId"`
		OriginalOperation string                       `json:"originalOperation"`
		Request           NativeShopInvoiceRequestDATA `json:"request"`
		Merchant          string                       `json:"merchant"`
		State             string                       `json:"state"`
		Phase             string                       `json:"phase"`
		Terms             NativeShopPayTerms           `json:"terms"`
	}
	var zero NativeShopIntentObservation
	if json.Unmarshal(raw, &v) != nil {
		return zero, PayInvoiceHandoff{}, ErrInvalidState
	}
	want, e := json.Marshal(saved.Request)
	got, f := json.Marshal(v.Request)
	if e != nil || f != nil || !bytes.Equal(want, got) || v.IntentID != v.OriginalOperation || v.Merchant != saved.Request.Merchant || v.Terms.Recipient != saved.Request.Recipient || !invoiceRecoveryID.MatchString(v.Terms.InvoiceID) {
		return zero, PayInvoiceHandoff{}, ErrConflict
	}
	if _, e := originalNativeShopPayIntentPath(v.IntentID); e != nil {
		return zero, PayInvoiceHandoff{}, e
	}
	positive := func(value string) bool {
		n, e := strconv.ParseUint(value, 10, 64)
		return e == nil && n > 0 && strconv.FormatUint(n, 10) == value
	}
	if !invoiceRecoveryID.MatchString(v.Terms.SessionID) || v.Terms.AssetID != saved.Request.AssetID || v.Terms.UnitVersion != saved.Request.UnitVersion || v.Terms.AmountAtoms != saved.Request.AmountAtoms || v.Terms.FeeRule != "native-transfer-fee-one/v1" || v.Terms.MaxFeeAtoms != "1" || !positive(v.Terms.KeyEpoch) || !positive(v.Terms.Revision) || !positive(v.Terms.ExpiresAtHeight) {
		return zero, PayInvoiceHandoff{}, ErrConflict
	}
	bound := saved.Order
	bound.PayIntentID = v.IntentID
	bound.InvoiceID = v.Terms.InvoiceID
	bound.PayMerchant = v.Merchant
	bound.PayPayoutAddress = v.Terms.Recipient
	observation, e := originalNativeIntentObservation(bound, raw)
	if e != nil {
		return zero, PayInvoiceHandoff{}, e
	}
	observation.QueryOnly = query
	return observation, PayInvoiceHandoff{InvoiceID: v.Terms.InvoiceID, IntentID: v.IntentID, Merchant: v.Merchant, PayoutAddress: v.Terms.Recipient}, nil
}

func (s *Server) nativeInvoicePreparation(ctx context.Context, target string, body []byte, v *verifiedBusinessRequest, recover bool) (businessEffectPlan, error) {
	var request struct{ IdempotencyKey string }
	if decodeBusinessBody(body, &request) != nil || len(request.IdempotencyKey) < 8 || !invoiceRecoveryID.MatchString(request.IdempotencyKey) {
		return businessEffectPlan{}, ErrInvalidState
	}
	if s.cfg.NativePay == nil || s.cfg.NativePay.client.Transport == nil || s.cfg.NativePay.origin == "" {
		return businessEffectPlan{}, ErrUnavailable
	}
	if e := v.current(ctx); e != nil {
		return businessEffectPlan{}, e
	}
	// Capture only this authenticated buyer's original order/intent, without
	// resolving or publishing a new account namespace outside its transaction.
	s.store.mu.Lock()
	o, exists := s.store.s.Orders[target]
	o = cloneOrder(o)
	account := v.principal.Account
	if v.walletAccount != "" {
		account = v.walletAccount
	}
	var original BusinessEffect
	var selectionErr error
	if !exists {
		selectionErr = ErrNotFound
	} else if v.principal.Role != "buyer" || !sameBusinessAccount(o.Buyer, account) {
		selectionErr = ErrUnauthorized
	}
	if selectionErr == nil {
		for _, record := range s.store.s.BusinessEffects {
			if record.Target != target {
				continue
			}
			if record.Kind == "pay.invoice" {
				selectionErr = ErrConflict
				break
			}
			if record.Kind == "pay.native-create" {
				if record.ID != effectDigest(o.Buyer, "buyer", "pay.native-create", target, request.IdempotencyKey) {
					selectionErr = ErrConflict
					break
				}
				original = record
				original.Input = bytes.Clone(record.Input)
			}
		}
	}
	s.store.mu.Unlock()
	if selectionErr != nil {
		return businessEffectPlan{}, selectionErr
	}
	if recover && original.ID == "" {
		if _, e := originalNativeShopPayIntentPath(o.PayIntentID); e == nil {
			return s.nativePayIntentObservation(target, v.proof)
		}
		return businessEffectPlan{}, ErrNotFound
	}
	var saved nativeInvoiceInput
	if original.ID != "" {
		if e := decodeEffect(original.Input, &saved); e != nil {
			return businessEffectPlan{}, e
		}
		if !sameNativeInvoiceBill(o, saved.Order) {
			return businessEffectPlan{}, ErrConflict
		}
	} else {
		if hasInvoiceBinding(o) || o.Status != "payment_pending" || !o.ReservationExpiresAt.After(s.store.now()) {
			return businessEffectPlan{}, ErrInvalidState
		}
		if s.cfg.NativeInvoiceDATA == nil {
			return businessEffectPlan{}, ErrUnavailable
		}
		bill, e := nativeInvoiceBillDATA(o)
		if e != nil {
			return businessEffectPlan{}, e
		}
		price, e := s.cfg.NativeInvoiceDATA.ReadOriginalShopInvoiceDATA(ctx, ShopNativeInvoiceSelectionDATA{cloneOrder(o), account, bytes.Clone(bill)})
		if e != nil {
			return businessEffectPlan{}, e
		}
		if e = v.current(ctx); e != nil {
			return businessEffectPlan{}, e
		}
		if o.NativePrice != nil && price != o.NativePrice.Price {
			return businessEffectPlan{}, ErrConflict
		}
		data, e := nativeInvoiceRequestDATA(o, price)
		if e != nil {
			return businessEffectPlan{}, e
		}
		saved = nativeInvoiceInput{Order: o, Origin: s.cfg.NativePay.origin, Request: data}
	}
	if saved.Origin != s.cfg.NativePay.origin {
		return businessEffectPlan{}, ErrConflict
	}
	pay := *s.cfg.NativePay
	pay.client = *guardedEffectHTTPClient(&pay.client, 15*time.Second)
	kind, key := "pay.native-create", request.IdempotencyKey
	if recover {
		kind, key = "pay.native-lookup", businessNonceDigest(v.proof.SessionBinding, v.proof.Nonce)
		saved.OriginalEffect = original.ID
	}
	plan := businessEffectPlan{kind: kind, target: target, key: key, status: 200}
	plan.prepare = func(tx *Store, actor string) (json.RawMessage, error) {
		current, e := tx.Order(actor, "buyer", target)
		if e != nil {
			return nil, e
		}
		if !sameNativeInvoiceBill(current, saved.Order) {
			return nil, ErrConflict
		}
		for _, r := range tx.s.BusinessEffects {
			if r.Target == target && (r.Kind == "pay.invoice" || r.Kind == "pay.native-create" && r.ID != original.ID) {
				return nil, ErrConflict
			}
		}
		return encodeEffect(saved)
	}
	plan.check = func(tx *Store, actor string, r BusinessEffect) error {
		var selected nativeInvoiceInput
		if e := decodeEffect(r.Input, &selected); e != nil {
			return e
		}
		current, e := tx.Order(actor, "buyer", target)
		if e != nil {
			return e
		}
		if selected.Origin != pay.origin || !sameNativeInvoiceBill(current, selected.Order) {
			return ErrConflict
		}
		if !recover && (current.Status != "payment_pending" || !current.ReservationExpiresAt.After(tx.now()) || hasInvoiceBinding(current)) {
			return ErrInvalidState
		}
		return nil
	}
	plan.send = func(ctx context.Context, r BusinessEffect) (json.RawMessage, error) {
		var selected nativeInvoiceInput
		if e := decodeEffect(r.Input, &selected); e != nil {
			return nil, e
		}
		var packet NativeShopPayExchange
		var e error
		if recover {
			packet, e = pay.LookupOriginalInvoiceIntentDATA(ctx, selected.Request)
		} else {
			packet, e = pay.CreateOriginalInvoiceIntentDATA(ctx, selected.Request)
		}
		return packet.Response, e
	}
	plan.finish = func(tx *Store, actor string, r BusinessEffect) (any, error) {
		var selected nativeInvoiceInput
		if e := decodeEffect(r.Input, &selected); e != nil {
			return nil, e
		}
		observation, binding, e := nativeInvoiceReply(selected, r.Result, recover)
		if e != nil {
			return nil, e
		}
		current, e := tx.Order(actor, "buyer", target)
		if e != nil {
			return nil, e
		}
		if hasInvoiceBinding(current) {
			if current.PayIntentID != binding.IntentID || current.InvoiceID != binding.InvoiceID || current.PayMerchant != binding.Merchant || current.PayPayoutAddress != binding.PayoutAddress {
				return nil, ErrConflict
			}
		} else if current.Status == "payment_pending" {
			// This is the verified response to the already captured original
			// operation, including an original-key lookup after a lost ACK.
			// Retaining its identifiers after a local stock deadline enables
			// receipt reconciliation; it extends no deadline and proves no funds.
			if _, e = tx.BindInvoice(actor, target, binding); e != nil {
				return nil, e
			}
		}
		if recover {
			prior, ok := tx.s.BusinessEffects[selected.OriginalEffect]
			if !ok || prior.Kind != "pay.native-create" || prior.Target != target {
				return nil, ErrConflict
			}
			prior.Result = bytes.Clone(r.Result)
			prior.Response, e = json.Marshal(observation)
			if e != nil {
				return nil, e
			}
			prior.Phase = "completed"
			prior.UpdatedAt = tx.now()
			tx.s.BusinessEffects[prior.ID] = prior
		}
		return observation, nil
	}
	plan.view = func(tx *Store, actor string, r BusinessEffect) (any, error) {
		if _, e := tx.Order(actor, "buyer", target); e != nil {
			return nil, e
		}
		var selected nativeInvoiceInput
		if e := decodeEffect(r.Input, &selected); e != nil {
			return nil, e
		}
		observation, _, e := nativeInvoiceReply(selected, r.Result, true)
		return observation, e
	}
	return plan, nil
}
