package payproduct

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"reflect"
)

// VerifyPaymentSession verifies a legacy preview/recovery descriptor. The key
// must come from the caller's independently trusted merchant registration; the
// response's SigningPublicKey is never a trust root. This grants no funds right.
func VerifyPaymentSession(session PaymentSession, merchantID string, trustedKey ed25519.PublicKey) error {
	invalid := errors.New("legacy payment session signature or binding is invalid")
	if len(trustedKey) != ed25519.PublicKeySize || len(session.SignedPayload) > 2<<20 {
		return invalid
	}
	raw, err := base64.RawStdEncoding.DecodeString(session.SignedPayload)
	if err != nil {
		return invalid
	}
	signature, err := hex.DecodeString(session.Signature)
	if err != nil || !ed25519.Verify(trustedKey, raw, signature) {
		return invalid
	}
	var payload struct {
		Domain  string         `json:"domain"`
		Session PaymentSession `json:"session"`
	}
	if strictJSON(raw, &payload) != nil || payload.Domain != "YNX_PAY_SESSION_V1" {
		return invalid
	}
	outer := session
	outer.Signature = ""
	outer.SignedPayload = ""
	if !reflect.DeepEqual(outer, payload.Session) || session.Version != 1 || session.InvoiceAuthority != "legacy_ed25519_product_projection" || session.MerchantID != merchantID || session.ID != session.Invoice.IntentID || session.InvoiceID != session.Invoice.ID || session.CentralInvoiceID != session.Invoice.CentralID || session.DeepLink != "ynxpay://invoice/"+session.Invoice.ID || !identifierRE.MatchString(session.SourceOrder) || !session.ExpiresAt.Equal(session.Invoice.ExpiresAt) {
		return invalid
	}
	return verifyRegisteredInvoice(session.Invoice, Merchant{ID: merchantID, PayoutAddress: session.Invoice.PayoutAddress, InvoiceSigningPublicKey: hex.EncodeToString(trustedKey)})
}
