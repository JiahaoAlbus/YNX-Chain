package commerce

import (
	"bytes"
	"context"
	"math"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// Explicit seller DATA in the existing authenticated catalog/profile mutation.
// These are not converted PriceYNXT values or a new approval/Source authority.
type NativePriceDATA struct{ Genesis, NativeChainID, AssetID, UnitVersion, AmountAtoms string }
type NativeChargesDATA struct{ Genesis, NativeChainID, AssetID, UnitVersion, ShippingAtoms, TaxAtoms string }
type NativeOrderLinePriceDATA struct {
	NativePriceDATA
	ApprovalRef string
}
type NativeOrderPriceDATA struct {
	Price                                 ShopNativeInvoicePriceDATA
	Charges                               NativeChargesDATA
	ChargesApprovalRef, OrderMutationHash string
}

func copyNativePrice(p *NativePriceDATA) *NativePriceDATA {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}
func copyNativeCharges(p *NativeChargesDATA) *NativeChargesDATA {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}
func cloneStoreProfile(s StoreProfile) StoreProfile {
	s.NativeCharges = copyNativeCharges(s.NativeCharges)
	return s
}
func nativePriceNetwork(genesis, chain, asset, unit string) bool {
	n, e := strconv.ParseUint(chain, 10, 64)
	return nativeReceiptHex(genesis, false) && e == nil && n > 0 && strconv.FormatUint(n, 10) == chain && asset == "YNXT" && unit == "1"
}
func validateNativePrice(p *NativePriceDATA) error {
	if p == nil {
		return nil
	}
	n, e := nativeReceiptAtoms(p.AmountAtoms)
	if e != nil || n == 0 || !nativePriceNetwork(p.Genesis, p.NativeChainID, p.AssetID, p.UnitVersion) {
		return ErrInvalidState
	}
	return nil
}
func validateNativeCharges(p *NativeChargesDATA) error {
	if p == nil {
		return nil
	}
	_, a := nativeReceiptAtoms(p.ShippingAtoms)
	_, b := nativeReceiptAtoms(p.TaxAtoms)
	if a != nil || b != nil || !nativePriceNetwork(p.Genesis, p.NativeChainID, p.AssetID, p.UnitVersion) {
		return ErrInvalidState
	}
	return nil
}
func copyVariants(v []Variant) []Variant {
	out := append([]Variant(nil), v...)
	for i := range out {
		out[i].NativePrice = copyNativePrice(out[i].NativePrice)
	}
	return out
}

// Reference an actual existing catalog revision containing the same explicit
// native quote. Publication/inventory changes do not invent a new price action.
func nativeVariantApproval(p Product, v Variant) string {
	if v.NativePrice == nil {
		return ""
	}
	for i := len(p.EditHistory) - 1; i >= 0; i-- {
		r := p.EditHistory[i]
		if r.Action != "updated" && r.Action != "created" {
			continue
		}
		for _, old := range r.Variants {
			if old.ID == v.ID && old.NativePrice != nil && *old.NativePrice == *v.NativePrice && nativeReceiptHex(r.RequestHash, false) {
				return "shop.price/" + p.ID + "/" + strconv.FormatInt(r.Revision, 10) + "/" + r.RequestHash
			}
		}
	}
	return ""
}
func computeNativeOrderPrice(o Order, charges NativeChargesDATA, chargeRef, mutation, merchant, recipient string) (*NativeOrderPriceDATA, error) {
	if validateNativeCharges(&charges) != nil || chargeRef == "" || len(chargeRef) > 256 || !nativeReceiptHex(mutation, false) {
		return nil, ErrUnavailable
	}
	var amount uint64
	for _, line := range o.Lines {
		p := line.NativePrice
		if p == nil || validateNativePrice(&p.NativePriceDATA) != nil || p.ApprovalRef == "" || len(p.ApprovalRef) > 256 || line.Quantity <= 0 || p.Genesis != charges.Genesis || p.NativeChainID != charges.NativeChainID || p.AssetID != charges.AssetID || p.UnitVersion != charges.UnitVersion {
			return nil, ErrUnavailable
		}
		n, _ := nativeReceiptAtoms(p.AmountAtoms)
		q := uint64(line.Quantity)
		if n > math.MaxUint64/q || amount > math.MaxUint64-n*q {
			return nil, ErrConflict
		}
		amount += n * q
	}
	shipping, _ := nativeReceiptAtoms(charges.ShippingAtoms)
	tax, _ := nativeReceiptAtoms(charges.TaxAtoms)
	if amount > math.MaxUint64-shipping {
		return nil, ErrConflict
	}
	amount += shipping
	if amount > math.MaxUint64-tax {
		return nil, ErrConflict
	}
	amount += tax
	if amount == 0 {
		return nil, ErrInvalidState
	}
	// This is a reference to frozen existing order/catalog/profile mutation DATA,
	// never an approval token or an independently minted price ledger.
	ref := "shop.order.price/" + o.ID + "/" + requestHash(struct {
		Lines                                         []OrderLine
		Charges                                       NativeChargesDATA
		ChargeRef, OrderMutation, Merchant, Recipient string
	}{o.Lines, charges, chargeRef, mutation, merchant, recipient})
	price := ShopNativeInvoicePriceDATA{Merchant: merchant, Recipient: recipient, Genesis: charges.Genesis, NativeChainID: charges.NativeChainID, AssetID: charges.AssetID, UnitVersion: charges.UnitVersion, AmountAtoms: strconv.FormatUint(amount, 10), PriceApprovalRef: ref}
	if _, e := nativeInvoiceRequestDATA(o, price); e != nil {
		return nil, e
	}
	return &NativeOrderPriceDATA{Price: price, Charges: charges, ChargesApprovalRef: chargeRef, OrderMutationHash: mutation}, nil
}
func (s *Store) captureNativeOrderPriceLocked(o Order, mutation string) (*NativeOrderPriceDATA, error) {
	st, ok := s.s.Stores[o.StoreID]
	if !ok || st.NativeCharges == nil {
		return nil, ErrUnavailable
	}
	merchant, e := accountaddress.Normalize(st.Owner)
	if e != nil {
		return nil, ErrUnavailable
	}
	recipient, e := accountaddress.Normalize(st.SettlementAccount)
	if e != nil {
		return nil, ErrUnavailable
	}
	return computeNativeOrderPrice(o, *st.NativeCharges, st.NativeChargesApprovalRef, mutation, merchant, recipient)
}

// Concrete normal DATA producer. It reads the exact native representation
// frozen by the original authenticated checkout, not today's prices or catalog.
// The server retains its original action/current checks before and after this
// method; returning DATA here cannot create a qualified Source or a Pay grant.
func (s *Store) ReadOriginalShopInvoiceDATA(ctx context.Context, selection ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error) {
	if ctx == nil {
		return ShopNativeInvoicePriceDATA{}, ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return ShopNativeInvoicePriceDATA{}, e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.s.Orders[selection.Order.ID]
	if !ok {
		return ShopNativeInvoicePriceDATA{}, ErrNotFound
	}
	if !sameBusinessAccount(o.Buyer, selection.WalletAccount) {
		return ShopNativeInvoicePriceDATA{}, ErrUnauthorized
	}
	bill, e := nativeInvoiceBillDATA(o)
	if e != nil || !sameNativeInvoiceBill(o, selection.Order) || !bytes.Equal(bill, selection.FrozenBill) {
		return ShopNativeInvoicePriceDATA{}, ErrConflict
	}
	q := o.NativePrice
	if q == nil {
		return ShopNativeInvoicePriceDATA{}, ErrUnavailable
	}
	expected, e := computeNativeOrderPrice(o, q.Charges, q.ChargesApprovalRef, q.OrderMutationHash, q.Price.Merchant, q.Price.Recipient)
	if e != nil || expected.Price != q.Price {
		return ShopNativeInvoicePriceDATA{}, ErrConflict
	}
	original := false
	for _, r := range s.s.Idempotency {
		if r.Actor == o.Buyer && r.Route == "order.create" && r.ObjectID == o.ID && r.RequestHash == q.OrderMutationHash {
			original = true
			break
		}
	}
	if !original {
		return ShopNativeInvoicePriceDATA{}, ErrConflict
	}
	if e = ctx.Err(); e != nil {
		return ShopNativeInvoicePriceDATA{}, e
	}
	return q.Price, nil
}

var _ OriginalShopNativeInvoiceDATAReader = (*Store)(nil)

func validateNativeOrderPrices(snapshot Snapshot) error {
	for _, o := range snapshot.Orders {
		if q := o.NativePrice; q != nil {
			expected, e := computeNativeOrderPrice(o, q.Charges, q.ChargesApprovalRef, q.OrderMutationHash, q.Price.Merchant, q.Price.Recipient)
			if e != nil || expected.Price != q.Price {
				return ErrInvalidState
			}
		}
	}
	return nil
}
func sameNativeCharges(a, b *NativeChargesDATA) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
