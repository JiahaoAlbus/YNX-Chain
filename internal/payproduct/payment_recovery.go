package payproduct

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

type paymentDispatch struct {
	Provider        string              `json:"provider"`
	InvoiceID       string              `json:"invoiceId"`
	Payer           string              `json:"payer"`
	TransactionHash string              `json:"transactionHash"`
	IntentDigest    string              `json:"intentDigest"`
	RequestNonce    string              `json:"requestNonce"`
	Key             string              `json:"key"`
	RequestHash     string              `json:"requestHash"`
	Intent          SignedPaymentIntent `json:"intent"`
	Result          WalletPaymentResult `json:"result"`
}

type PaymentOutcome struct {
	Financials      PaymentFinancials `json:"financials"`
	InvoiceID       string            `json:"invoiceId"`
	Status          string            `json:"status"`
	TransactionHash string            `json:"transactionHash"`
	Invoice         Invoice           `json:"invoice"`
}

func paymentDispatchSlot(invoiceID string) string {
	return hashString("YNX_PAY_ORIGINAL_SETTLEMENT_DISPATCH_V1", invoiceID)
}
func (s *Service) paymentDispatch(data Snapshot, invoiceID string) (paymentDispatch, BusinessDispatchRecord, bool, error) {
	record, found := data.BusinessDispatches[paymentDispatchSlot(invoiceID)]
	if !found {
		return paymentDispatch{}, record, false, nil
	}
	raw, err := s.open(record.ResultCipher)
	var p paymentDispatch
	if err != nil || strictJSON([]byte(raw), &p) != nil || p.InvoiceID != invoiceID || record.Operation != "payment.settle" || record.Account != p.Payer || record.RequestHash != p.RequestHash || record.IdempotencyKey != p.Key {
		return p, record, true, errors.New("original payment dispatch requires recovery")
	}
	return p, record, true, nil
}

func (s *Service) reservePaymentDispatch(ctx context.Context, invoice Invoice, session WalletSession, intent SignedPaymentIntent, result WalletPaymentResult, key string) (bool, error) {
	if _, err := validKey(key); err != nil {
		return false, err
	}
	p := paymentDispatch{Provider: payProviderIdentity(s.pay), InvoiceID: invoice.ID, Payer: session.Account, TransactionHash: result.TransactionHash, IntentDigest: result.IntentDigest, RequestNonce: result.RequestID, Key: key, RequestHash: hashCanonical(map[string]any{"intent": intent, "result": result}), Intent: intent, Result: result}
	raw, err := json.Marshal(p)
	if err != nil {
		return false, err
	}
	fresh := false
	err = s.store.Update(func(data *Snapshot) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		old, _, found, err := s.paymentDispatch(*data, invoice.ID)
		if err != nil {
			return err
		}
		if found {
			if old.Provider != payProviderIdentity(s.pay) {
				return errors.New("original payment provider changed; reconcile against original service")
			}
			if old.RequestHash != p.RequestHash || old.Payer != p.Payer || old.TransactionHash != p.TransactionHash {
				return errors.New("invoice already has an original payment operation; reconcile it")
			}
			return nil
		}
		current, ok := data.Invoices[invoice.ID]
		if !ok || current.Signature != invoice.Signature {
			return errors.New("original invoice changed")
		}
		for _, record := range data.BusinessDispatches {
			if record.Operation == "payment.settle" && record.Account == p.Payer {
				text, err := s.open(record.ResultCipher)
				var other paymentDispatch
				if err != nil || strictJSON([]byte(text), &other) != nil {
					return errors.New("original payment journal requires recovery")
				}
				if other.TransactionHash == p.TransactionHash {
					return errors.New("original payment transaction already belongs to another invoice")
				}
			}
		}
		if data.BusinessDispatches == nil {
			data.BusinessDispatches = map[string]BusinessDispatchRecord{}
		}
		data.BusinessDispatches[paymentDispatchSlot(invoice.ID)] = BusinessDispatchRecord{SessionBinding: session.SessionBinding, Account: session.Account, MerchantID: invoice.MerchantID, RequestHash: p.RequestHash, Operation: "payment.settle", IdempotencyKey: key, Phase: "unknown", ResultCipher: s.seal(string(raw)), UpdatedAt: s.now().UTC()}
		fresh = true
		return nil
	})
	return fresh, err
}

// ReconcilePaymentOutcome is a read of the same original operation. It never
// resubmits a payment, renews its old quote or changes its transaction/nonce.
func (s *Service) ReconcilePaymentOutcome(ctx context.Context, session WalletSession, invoiceID string) (PaymentOutcome, error) {
	if !hasScope(session.Scopes, "pay:settlement:submit") || session.Account == "" || !s.now().Before(session.ExpiresAt) {
		return PaymentOutcome{}, errors.New("active payer session required")
	}
	var invoice Invoice
	var p paymentDispatch
	var record BusinessDispatchRecord
	err := s.store.View(func(data Snapshot) error {
		var found bool
		var err error
		p, record, found, err = s.paymentDispatch(data, invoiceID)
		if err != nil {
			return err
		}
		if !found || p.Payer != session.Account {
			return errors.New("original payment operation unavailable for payer")
		}
		if p.Provider != payProviderIdentity(s.pay) {
			return errors.New("original payment provider unavailable")
		}
		invoice = data.Invoices[invoiceID]
		return nil
	})
	if err != nil {
		return PaymentOutcome{}, err
	}
	if record.Phase != "confirmed" {
		evidence, err := s.pay.Settlement(ctx, invoice.CentralID)
		if err == nil {
			var merchant Merchant
			if err = s.store.View(func(data Snapshot) error { merchant = data.Merchants[invoice.MerchantID]; return nil }); err != nil {
				return PaymentOutcome{}, err
			}
			invoice, err = s.acceptSettlement(invoice, merchant, evidence)
			if err != nil {
				return PaymentOutcome{}, err
			}
			record.Phase = "confirmed"
		}
	}
	status := "unknown"
	if record.Phase == "confirmed" {
		status = invoice.Status
	}
	var financials PaymentFinancials
	if err := s.store.View(func(data Snapshot) error {
		var err error
		financials, err = paymentFinancials(data, invoice)
		return err
	}); err != nil {
		return PaymentOutcome{}, err
	}
	return PaymentOutcome{Financials: financials, InvoiceID: invoiceID, Status: status, TransactionHash: p.TransactionHash, Invoice: publicInvoice(invoice)}, nil
}

func (s *Server) paymentOutcome(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1))
	if err != nil || len(body) != 0 || r.URL.RawQuery != "" {
		writeError(w, http.StatusBadRequest, "payment outcome requires exact empty-body route")
		return
	}
	session, err := s.service.VerifyPayGateway(r, body)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	out, err := s.service.ReconcilePaymentOutcome(r.Context(), session, r.PathValue("id"))
	respond(w, http.StatusOK, out, err)
}

func payProviderIdentity(api PayAPI) string {
	switch provider := api.(type) {
	case *HTTPPayAPI:
		return provider.BaseURL
	case *merchantGuardedPay:
		return payProviderIdentity(provider.original)
	default:
		return fmt.Sprintf("isolated-injected:%T", api)
	}
}
