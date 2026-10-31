package payproduct

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// PaymentReview is a display of existing signed terms, never a replacement for
// CORE's issuer/unit/checkpoint commitment or Wallet's current approval policy.
type PaymentReview struct {
	Invoice           Invoice   `json:"invoice"`
	Principal         int64     `json:"principal"`
	Fee               int64     `json:"fee"`
	Total             int64     `json:"total"`
	Recipient         string    `json:"recipient"`
	ExpiresAt         time.Time `json:"expiresAt"`
	ApprovalAvailable bool      `json:"approvalAvailable"`
	UnavailableReason string    `json:"unavailableReason"`
}

func (s *Service) ReviewPayment(ctx context.Context, id string) (PaymentReview, error) {
	var invoice Invoice
	var merchant Merchant
	err := s.store.View(func(data Snapshot) error {
		var ok bool
		invoice, ok = data.Invoices[id]
		if !ok {
			return errors.New("invoice not found")
		}
		merchant = data.Merchants[invoice.MerchantID]
		return nil
	})
	if err != nil {
		return PaymentReview{}, err
	}
	if err = verifyRegisteredInvoice(invoice, merchant); err != nil {
		return PaymentReview{}, err
	}
	if invoice.Status != "pending" || !s.now().Before(invoice.ExpiresAt) {
		return PaymentReview{}, errors.New("invoice is not open for a new review")
	}
	central, err := s.pay.Invoice(ctx, invoice.CentralID)
	if err != nil {
		return PaymentReview{}, err
	}
	if central.ID != invoice.CentralID || central.IntentID != invoice.IntentID || central.Merchant != merchant.CentralMerchantID || central.PayoutAddress != invoice.PayoutAddress || central.Amount != invoice.Amount || central.Currency != invoice.Asset || central.Status != "issued" || central.DueAt.Before(invoice.ExpiresAt) {
		return PaymentReview{}, errors.New("current central invoice terms do not match original signed registration")
	}
	// The await may have outlived expiry or changed the original registration.
	err = s.store.View(func(data Snapshot) error {
		current, ok := data.Invoices[id]
		if !ok || current.Signature != invoice.Signature || current.Status != "pending" || !s.now().Before(current.ExpiresAt) {
			return errors.New("original invoice changed or expired during review")
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		return verifyRegisteredInvoice(current, data.Merchants[current.MerchantID])
	})
	if err != nil {
		return PaymentReview{}, err
	}
	return PaymentReview{Invoice: publicInvoice(invoice), Principal: invoice.Amount, Fee: invoice.Fee, Total: invoice.Amount + invoice.Fee, Recipient: invoice.PayoutAddress, ExpiresAt: invoice.ExpiresAt, ApprovalAvailable: false, UnavailableReason: "V5_CORE_CHECKPOINT_UNIT_ISSUER_AND_CURRENT_WALLET_POLICY_NOT_SUPPLIED"}, nil
}

func (s *Server) paymentReview(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength > 0 || r.URL.RawQuery != "" {
		writeError(w, http.StatusBadRequest, "review requires exact empty-body route")
		return
	}
	out, err := s.service.ReviewPayment(r.Context(), r.PathValue("id"))
	respond(w, http.StatusOK, out, err)
}
