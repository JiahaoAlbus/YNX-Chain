package ynxauth

import (
	"bytes"
	"regexp"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	ActionInvoiceTerms         = "invoice_terms"
	ActionInvoiceSettle        = "invoice_settle"
	ActionInvoiceRefund        = "invoice_refund"
	InvoiceTermsDomain         = "YNX-INVOICE-TERMS/v1"
	InvoiceSettleDomain        = "YNX-INVOICE-SETTLE/v1"
	InvoiceRefundDomain        = "YNX-INVOICE-REFUND/v1"
	InvoiceActionFee    uint64 = 1
)

var invoiceIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._:-]{0,63}$`)

// Merchant authority comes from the enclosing current account Action Member.
// These immutable terms are registered before a payer can occupy their slot.
// Expiry is an execution height, never the receiving machine's wall clock.
// Payer may be empty (any independently authorized payer). Every numeric terms
// field is in 1..MaxInt64; the enclosing Action keeps its existing nonce range.
// KeyEpoch and Revision are signed claims checked against committed ledger and
// account policy by execution, not authority established by this codec.
type InvoiceTermsPayload struct {
	InvoiceID, SessionID, Recipient, Payer, AssetID, UnitVersion, FeeRule string
	KeyEpoch, Revision, Amount, MaxFee, ExpiresAt                         uint64
}

type InvoiceSettlePayload struct {
	Merchant, InvoiceID string
	TermsHash           []byte
	Amount              uint64
}

// The recipient is deliberately absent: execution derives the original payer
// from the committed settlement. RefundID is unique within the merchant invoice.
type InvoiceRefundPayload struct {
	InvoiceID, RefundID       string
	TermsHash, SettlementHash []byte
	Amount                    uint64
}

func IsInvoiceAction(kind string) bool {
	return kind == ActionInvoiceTerms || kind == ActionInvoiceSettle || kind == ActionInvoiceRefund
}

func invoiceID(s string) bool {
	return len(s) >= 1 && len(s) <= 64 && invoiceIDPattern.MatchString(s)
}

func invoiceHash(b []byte) bool {
	var zero [32]byte
	return len(b) == len(zero) && !bytes.Equal(b, zero[:])
}

func invoiceActionSchema(kind string) (string, int) {
	switch kind {
	case ActionInvoiceTerms:
		return InvoiceTermsDomain, 19
	case ActionInvoiceSettle:
		return InvoiceSettleDomain, 7
	case ActionInvoiceRefund:
		return InvoiceRefundDomain, 8
	default:
		return "", 0
	}
}

func encodeInvoiceActionPayload(kind string, value any) ([]byte, error) {
	domain, count := invoiceActionSchema(kind)
	if count == 0 {
		return nil, ErrAction
	}
	f := [][]byte{[]byte(domain), ynxbatch.U32(1)}
	switch p := value.(type) {
	case InvoiceTermsPayload:
		if kind != ActionInvoiceTerms || !invoiceID(p.InvoiceID) || !invoiceID(p.SessionID) || !accountaddress.IsCanonical(p.Recipient) || (p.Payer != "" && !accountaddress.IsCanonical(p.Payer)) || p.AssetID != "YNXT" || p.UnitVersion != "1" || p.FeeRule != "native-transfer-fee-one/v1" || !actionPositive(p.KeyEpoch) || !actionPositive(p.Revision) || !actionPositive(p.Amount) || !actionPositive(p.MaxFee) || !actionPositive(p.ExpiresAt) {
			return nil, ErrAction
		}
		f = append(f, []byte(p.InvoiceID), []byte(p.SessionID), []byte(p.Recipient), []byte(p.Payer), []byte(p.AssetID), []byte(p.UnitVersion), []byte(p.FeeRule))
		f = append(f, pair(p.KeyEpoch)...)
		f = append(f, pair(p.Revision)...)
		f = append(f, pair(p.Amount)...)
		f = append(f, pair(p.MaxFee)...)
		f = append(f, pair(p.ExpiresAt)...)
	case InvoiceSettlePayload:
		if kind != ActionInvoiceSettle || !accountaddress.IsCanonical(p.Merchant) || !invoiceID(p.InvoiceID) || !invoiceHash(p.TermsHash) || !actionPositive(p.Amount) {
			return nil, ErrAction
		}
		f = append(f, []byte(p.Merchant), []byte(p.InvoiceID), p.TermsHash)
		f = append(f, pair(p.Amount)...)
	case InvoiceRefundPayload:
		if kind != ActionInvoiceRefund || !invoiceID(p.InvoiceID) || !invoiceID(p.RefundID) || !invoiceHash(p.TermsHash) || !invoiceHash(p.SettlementHash) || !actionPositive(p.Amount) {
			return nil, ErrAction
		}
		f = append(f, []byte(p.InvoiceID), []byte(p.RefundID), p.TermsHash, p.SettlementHash)
		f = append(f, pair(p.Amount)...)
	default:
		return nil, ErrAction
	}
	return ynxbatch.EncodeFields(f...)
}

func decodeInvoiceActionPayload(kind string, wire []byte) (any, error) {
	domain, count := invoiceActionSchema(kind)
	if count == 0 {
		return nil, ErrAction
	}
	f, err := frame(wire, count, MaxActionPayloadBytes)
	if err != nil || !bytes.Equal(f[0], []byte(domain)) || !bytes.Equal(f[1], ynxbatch.U32(1)) {
		return nil, ErrAction
	}
	r := actionReader{fields: f[2:]}
	var value any
	switch kind {
	case ActionInvoiceTerms:
		value = InvoiceTermsPayload{InvoiceID: r.text(), SessionID: r.text(), Recipient: r.text(), Payer: r.text(),
			AssetID: r.text(), UnitVersion: r.text(), FeeRule: r.text(),
			KeyEpoch: r.u64(), Revision: r.u64(), Amount: r.u64(), MaxFee: r.u64(), ExpiresAt: r.u64()}
	case ActionInvoiceSettle:
		value = InvoiceSettlePayload{Merchant: r.text(), InvoiceID: r.text(), TermsHash: r.field(), Amount: r.u64()}
	case ActionInvoiceRefund:
		value = InvoiceRefundPayload{InvoiceID: r.text(), RefundID: r.text(), TermsHash: r.field(), SettlementHash: r.field(), Amount: r.u64()}
	}
	if r.err != nil || r.index != count-2 {
		return nil, ErrAction
	}
	canonical, err := encodeInvoiceActionPayload(kind, value)
	if err != nil || !bytes.Equal(canonical, wire) {
		return nil, ErrAction
	}
	return value, nil
}
