package payproduct

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

type PaymentSessionInput struct {
	InvoiceID   string `json:"invoiceId"`
	SourceOrder string `json:"sourceOrder"`
}

type PaymentSession struct {
	InvoiceAuthority string    `json:"invoiceAuthority"`
	Version          int       `json:"version"`
	Invoice          Invoice   `json:"invoice"`
	SignedPayload    string    `json:"signedPayload"`
	Signature        string    `json:"signature"`
	ID               string    `json:"id"`
	InvoiceID        string    `json:"invoiceId"`
	CentralInvoiceID string    `json:"centralInvoiceId"`
	MerchantID       string    `json:"merchantId"`
	SourceOrder      string    `json:"sourceOrder"`
	DeepLink         string    `json:"deepLink"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"createdAt"`
	ExpiresAt        time.Time `json:"expiresAt"`
}

func verifyRegisteredInvoice(invoice Invoice, merchant Merchant) error {
	public, err := hex.DecodeString(merchant.InvoiceSigningPublicKey)
	signature, sigErr := hex.DecodeString(invoice.Signature)
	if err != nil || sigErr != nil || len(public) != ed25519.PublicKeySize || len(signature) != ed25519.SignatureSize ||
		invoice.SigningPublicKey != merchant.InvoiceSigningPublicKey || invoice.SignatureAlgorithm != "ed25519" ||
		!identifierRE.MatchString(invoice.ID) || !identifierRE.MatchString(invoice.CentralID) || !identifierRE.MatchString(invoice.IntentID) ||
		invoice.MerchantID != merchant.ID || invoice.PayoutAddress != merchant.PayoutAddress ||
		invoice.Version < 1 || invoice.Version > 5 || invoice.Asset != NativeAsset || invoice.Network != ChainID ||
		invoice.Amount <= 0 || invoice.Fee < 0 || invoice.Amount > int64(^uint64(0)>>1)-invoice.Fee ||
		!ed25519.Verify(public, invoiceSigningMaterial(invoice), signature) {
		return errors.New("registered invoice signature or immutable terms are invalid")
	}
	return nil
}

// OpenPaymentSession reuses the original intent as the session identity and the
// original invoice deep link. Existing product/central/intent aliases are resolved
// without lowercasing or manufacturing a second payment intent. The original
// Store's idempotency table binds the authoritative order slot atomically; no
// new schema, balance table or cross-service transaction is introduced.
func (s *Service) OpenPaymentSession(ctx context.Context, merchant Merchant, input PaymentSessionInput) (PaymentSession, error) {
	if !identifierRE.MatchString(input.InvoiceID) || !identifierRE.MatchString(input.SourceOrder) {
		return PaymentSession{}, errors.New("canonical invoice and source order IDs are required")
	}
	var out PaymentSession
	err := s.store.Update(func(data *Snapshot) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		current, err := registeredInvoiceMerchant(*data, merchant)
		if err != nil {
			return err
		}
		var invoice Invoice
		matches := 0
		for _, candidate := range data.Invoices {
			if candidate.ID == input.InvoiceID || candidate.CentralID == input.InvoiceID || candidate.IntentID == input.InvoiceID {
				if candidate.MerchantID != current.ID {
					return errors.New("invoice is unavailable for this merchant")
				}
				invoice = candidate
				matches++
			}
		}
		if matches != 1 {
			return errors.New("invoice alias is unavailable or ambiguous")
		}
		if err := verifyRegisteredInvoice(invoice, current); err != nil {
			return err
		}
		scope := "payment-session:" + current.ID
		slot := scope + ":" + input.SourceOrder
		requestHash := hashJSON([]string{invoice.ID, invoice.CentralID, invoice.IntentID, input.SourceOrder, invoice.Signature})
		receipt, exists := data.Idempotency[slot]
		if exists {
			if receipt.Scope != scope || receipt.Key != input.SourceOrder || receipt.ObjectID != invoice.ID || receipt.RequestHash != requestHash {
				return errors.New("source order is already bound to another payment session")
			}
		} else {
			if !s.now().Before(invoice.ExpiresAt) || invoice.Status != "pending" {
				return errors.New("invoice is not open for a new payment session")
			}
			for _, old := range data.Idempotency {
				if old.Scope == scope && old.ObjectID == invoice.ID {
					return errors.New("invoice is already bound to another source order")
				}
			}
			receipt = IdempotencyRecord{Scope: scope, Key: input.SourceOrder, RequestHash: requestHash, ObjectID: invoice.ID, CreatedAt: s.now().UTC()}
			data.Idempotency[slot] = receipt
			appendAudit(data, current.ID, current.ID, "payment-session.open", invoice.ID, "committed", "", receipt.CreatedAt)
		}
		out, err = s.paymentSessionView(invoice, current, input.SourceOrder, receipt.CreatedAt)
		return err
	})
	if err != nil {
		return PaymentSession{}, err
	}
	return out, nil
}

func (s *Server) openPaymentSession(w http.ResponseWriter, r *http.Request) {
	principal, body, ok := s.merchantAuth(w, r, "invoice")
	if !ok {
		return
	}
	var input PaymentSessionInput
	if !decodeBytes(w, body, &input) {
		return
	}
	out, err := s.service.OpenPaymentSession(r.Context(), principal.Merchant, input)
	respond(w, http.StatusCreated, out, err)
}

// PaymentSession is an authenticated read of the original order binding; it
// cannot issue another intent or manufacture a missing original receipt.
func (s *Service) PaymentSession(ctx context.Context, merchant Merchant, sourceOrder string) (PaymentSession, error) {
	if !identifierRE.MatchString(sourceOrder) {
		return PaymentSession{}, errors.New("canonical source order ID is required")
	}
	var out PaymentSession
	err := s.store.View(func(data Snapshot) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		current, err := registeredInvoiceMerchant(data, merchant)
		if err != nil {
			return err
		}
		scope := "payment-session:" + current.ID
		receipt, ok := data.Idempotency[scope+":"+sourceOrder]
		if !ok || receipt.Scope != scope || receipt.Key != sourceOrder {
			return errors.New("original payment session requires recovery")
		}
		invoice, ok := data.Invoices[receipt.ObjectID]
		if !ok {
			return errors.New("original invoice receipt requires recovery")
		}
		if err := verifyRegisteredInvoice(invoice, current); err != nil {
			return err
		}
		requestHash := hashJSON([]string{invoice.ID, invoice.CentralID, invoice.IntentID, sourceOrder, invoice.Signature})
		if receipt.RequestHash != requestHash {
			return errors.New("original payment session binding changed")
		}
		out, err = s.paymentSessionView(invoice, current, sourceOrder, receipt.CreatedAt)
		return err
	})
	if err != nil {
		return PaymentSession{}, err
	}
	return out, nil
}

func (s *Service) paymentSessionView(invoice Invoice, current Merchant, sourceOrder string, createdAt time.Time) (PaymentSession, error) {
	status := "awaiting_wallet"
	if invoice.Status != "pending" {
		status = invoice.Status
	} else if !s.now().Before(invoice.ExpiresAt) {
		status = "expired"
	}
	out := PaymentSession{InvoiceAuthority: "legacy_ed25519_product_projection", Version: 1, Invoice: publicInvoice(invoice), ID: invoice.IntentID, InvoiceID: invoice.ID, CentralInvoiceID: invoice.CentralID, MerchantID: current.ID, SourceOrder: sourceOrder, DeepLink: "ynxpay://invoice/" + invoice.ID, Status: status, CreatedAt: createdAt, ExpiresAt: invoice.ExpiresAt}
	// Sign exact descriptor bytes including sourceOrder and original invoice
	// terms. The two signature fields are empty in this signed inner descriptor.
	privateText, err := s.open(current.InvoiceSigningPrivateCipher)
	if err != nil {
		return PaymentSession{}, errors.New("merchant session signing key unavailable")
	}
	privateKey, err := base64.RawStdEncoding.DecodeString(privateText)
	public, _ := hex.DecodeString(current.InvoiceSigningPublicKey)
	if err != nil || len(privateKey) != ed25519.PrivateKeySize || !ed25519.PrivateKey(privateKey).Public().(ed25519.PublicKey).Equal(ed25519.PublicKey(public)) {
		return PaymentSession{}, errors.New("merchant session signing key invalid")
	}
	defer clear(privateKey)
	payload, err := json.Marshal(struct {
		Domain  string         `json:"domain"`
		Session PaymentSession `json:"session"`
	}{"YNX_PAY_SESSION_V1", out})
	if err != nil {
		return PaymentSession{}, err
	}
	out.SignedPayload = base64.RawStdEncoding.EncodeToString(payload)
	out.Signature = hex.EncodeToString(ed25519.Sign(ed25519.PrivateKey(privateKey), payload))
	return out, nil
}

func (s *Server) paymentSession(w http.ResponseWriter, r *http.Request) {
	principal, _, ok := s.merchantAuth(w, r, "read")
	if !ok {
		return
	}
	out, err := s.service.PaymentSession(r.Context(), principal.Merchant, r.PathValue("sourceOrder"))
	respond(w, http.StatusOK, out, err)
}
