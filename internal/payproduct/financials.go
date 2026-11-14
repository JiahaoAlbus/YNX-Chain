package payproduct

import "errors"

type PaymentFinancials struct {
	Asset             string `json:"asset"`
	InvoicePrincipal  int64  `json:"invoicePrincipal"`
	PaidPrincipal     int64  `json:"paidPrincipal"`
	RefundedPrincipal int64  `json:"refundedPrincipal"`
	NetPrincipal      int64  `json:"netPrincipal"`
	NetworkFeeQuoted  int64  `json:"networkFeeQuoted"`
	ActualFeeKnown    bool   `json:"actualFeeKnown"`
	RefundStatus      string `json:"refundStatus"`
}

func paymentFinancials(data Snapshot, invoice Invoice) (PaymentFinancials, error) {
	out := PaymentFinancials{Asset: invoice.Asset, InvoicePrincipal: invoice.Amount, NetworkFeeQuoted: invoice.Fee, RefundStatus: "none"}
	if invoice.Settlement == nil {
		return out, nil
	}
	out.PaidPrincipal = invoice.Settlement.Amount
	for _, refund := range data.Refunds {
		if refund.InvoiceID != invoice.ID || refund.Status != "refunded" || refund.Evidence == nil {
			continue
		}
		if refund.Amount <= 0 || refund.Amount > out.PaidPrincipal-out.RefundedPrincipal {
			return PaymentFinancials{}, errors.New("original refund totals require reconciliation")
		}
		out.RefundedPrincipal += refund.Amount
	}
	out.NetPrincipal = out.PaidPrincipal - out.RefundedPrincipal
	if out.RefundedPrincipal > 0 {
		out.RefundStatus = "partial_refund"
	}
	if out.PaidPrincipal > 0 && out.RefundedPrincipal == out.PaidPrincipal {
		out.RefundStatus = "refunded"
	}
	return out, nil
}
