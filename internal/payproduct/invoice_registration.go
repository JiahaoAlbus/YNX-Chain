package payproduct

import "errors"

// Registration uses the original merchant record. The caller's merchant value
// cannot substitute a recipient, issuer or signing identity. The same check runs
// in the final Store transaction after the provider calls.
func registeredInvoiceMerchant(data Snapshot, supplied Merchant) (Merchant, error) {
	current, ok := data.Merchants[supplied.ID]
	if !ok || current.Status != "active" ||
		current.CentralMerchantID != supplied.CentralMerchantID ||
		current.PayoutAddress != supplied.PayoutAddress ||
		current.InvoiceSigningPublicKey != supplied.InvoiceSigningPublicKey ||
		current.InvoiceSigningPrivateCipher != supplied.InvoiceSigningPrivateCipher {
		return Merchant{}, errors.New("invoice merchant registration is inactive or changed")
	}
	return current, nil
}

// Reuse the original atomic Store and invoice fields as immutable alias slots;
// no separate invoice/intent authority or balance projection is created.
func claimInvoiceAliases(data *Snapshot, invoice Invoice) error {
	for _, old := range data.Invoices {
		// Legacy deep links accept any of these IDs without a kind tag. Keep
		// that namespace unambiguous across all fields and registered objects.
		for _, existing := range []string{old.ID, old.CentralID, old.IntentID} {
			for _, candidate := range []string{invoice.ID, invoice.CentralID, invoice.IntentID} {
				if existing != "" && existing == candidate {
					return errors.New("invoice alias is already bound to an immutable registration")
				}
			}
		}
	}
	data.Invoices[invoice.ID] = invoice
	return nil
}
