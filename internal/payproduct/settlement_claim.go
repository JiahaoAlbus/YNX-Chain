package payproduct

import (
	"bytes"
	"errors"
)

// This is the original single-transfer Pay receipt port, not a batch member or
// independent finality verifier. A future multi-member port needs CORE's exact
// genesis/tx/member/event key; this legacy DTO supplies no such membership.
func claimLegacySettlement(data *Snapshot, incoming Invoice) (Invoice, bool, error) {
	current, ok := data.Invoices[incoming.ID]
	if !ok || current.Signature != incoming.Signature || !bytes.Equal(invoiceSigningMaterial(current), invoiceSigningMaterial(incoming)) {
		return Invoice{}, false, errors.New("original invoice registration changed before settlement claim")
	}
	evidence := incoming.Settlement
	if current.Settlement != nil {
		original := *current.Settlement
		observed := *evidence
		// Wallet proof metadata is appended by the original signed-result flow and
		// must survive a repeated observation of the same immutable money receipt.
		original.IntentDigest, original.RequestNonce = "", ""
		observed.IntentDigest, observed.RequestNonce = "", ""
		if hashJSON(original) != hashJSON(observed) {
			return Invoice{}, false, errors.New("invoice already has a different settlement receipt")
		}
		return current, true, nil
	}
	for id, other := range data.Invoices {
		if id == incoming.ID || other.Settlement == nil {
			continue
		}
		if other.Settlement.ID == evidence.ID || other.Settlement.TransactionHash == evidence.TransactionHash {
			return Invoice{}, false, errors.New("legacy settlement receipt is already claimed by another invoice")
		}
	}
	return incoming, false, nil
}
