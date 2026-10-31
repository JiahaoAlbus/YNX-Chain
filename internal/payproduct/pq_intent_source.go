//go:build pay_pq

package payproduct

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// One joint original Source snapshot: authenticated private caller, registered
// product/merchant/store association and immutable approved bill. Not an HTTP
// DTO. Current is synchronous and must be safe under the original Store lock.
type NativeInvoiceSourceSnapshot struct {
	Caller            string
	Intent            NativeInvoiceProductIntent
	ProductMerchantID string
	MerchantAccount   string
	StoreID           string
	Terms             ynxauth.InvoiceTermsPayload
	AllowedOperations []string
	Until             time.Time
	Current           func() error
}
type NativeInvoiceSourceReader interface {
	ReadInvoiceIntentSource(context.Context, NativeInvoiceIntentAccess) (NativeInvoiceSourceSnapshot, error)
}
type registeredNativeInvoiceIntentSource struct {
	parent *Service
	reader NativeInvoiceSourceReader
}

func NewRegisteredNativeInvoiceIntentSource(parent *Service, reader NativeInvoiceSourceReader) (NativeInvoiceIntentSource, error) {
	if parent == nil || parent.store == nil || reader == nil {
		return nil, ErrNativePayUnavailable
	}
	return &registeredNativeInvoiceIntentSource{parent, reader}, nil
}
func (s *registeredNativeInvoiceIntentSource) ResolveInvoiceIntent(ctx context.Context, a NativeInvoiceIntentAccess) (NativeInvoiceIntentBinding, error) {
	empty := NativeInvoiceIntentBinding{}
	if !slices.Contains([]string{"create", "read", "lookup", "merchant_review", "submit_merchant_member", "reconcile"}, a.Operation) {
		return empty, errors.New("unsupported original invoice intent operation")
	}
	original, err := s.reader.ReadInvoiceIntentSource(ctx, a)
	if err != nil {
		return empty, err
	}
	if original.Current == nil || original.Caller == "" || !s.parent.now().Before(original.Until) || !slices.Contains(original.AllowedOperations, a.Operation) {
		return empty, ErrNativePayUnavailable
	}
	if err = ctx.Err(); err != nil {
		return empty, err
	}
	if err = original.Current(); err != nil {
		return empty, err
	}
	if hashJSON(original.Intent) != hashJSON(a.Intent) || original.MerchantAccount != a.Intent.Merchant || original.ProductMerchantID == "" || original.Terms.Recipient != a.Intent.Recipient || original.StoreID != a.Intent.StoreID || (a.Intent.ProductID == "shop.order" && original.StoreID == "") {
		return empty, errors.New("current original product/merchant/store/bill binding unavailable")
	}
	// Source supplies the association; recipient equality cannot discover it.
	err = s.parent.store.View(func(data Snapshot) error {
		if err := original.Current(); err != nil {
			return err
		}
		merchant, ok := data.Merchants[original.ProductMerchantID]
		recipient, e := accountaddress.Normalize(merchant.PayoutAddress)
		if !ok || merchant.Status != "active" || e != nil || recipient != original.Terms.Recipient {
			return ErrNativePayUnavailable
		}
		if a.Operation == "merchant_review" || a.Operation == "submit_merchant_member" {
			account, e := accountaddress.Encode(original.Caller)
			member, ok := data.MerchantMembers[original.ProductMerchantID+":"+account]
			if e != nil || !ok || member.Status != "active" || !roleAllows(member.Role, "invoice") {
				return ErrNativePayUnavailable
			}
		}
		return nil
	})
	if err != nil {
		return empty, err
	}
	return NativeInvoiceIntentBinding{Caller: original.Caller, Merchant: original.MerchantAccount, Terms: original.Terms, Until: original.Until, Current: original.Current}, nil
}
