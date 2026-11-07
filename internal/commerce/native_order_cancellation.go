package commerce

import "strings"

func (s *Store) orderCancellationProjectionLocked(o Order) Order {
	out := cloneOrder(o)
	out.LocalCancellationBlocked = s.nativeInvoiceCancellationBlockedLocked(o)
	return out
}

// The Store lock serializes local cancellation with durable original invoice
// admission. Neither an HTTP timeout, PREPARED state nor local stock expiry is a
// chain invoice-cancel operation. Only the original Pay/Source owner can prove
// a terminal nonpayment outcome; this product does not invent that authority.
func (s *Store) nativeInvoiceCancellationBlockedLocked(o Order) bool {
	if strings.HasPrefix(o.PayIntentID, "npi_") || o.NativePayment != nil {
		return true
	}
	for _, original := range s.s.BusinessEffects {
		if original.Target == o.ID && original.Kind == "pay.native-create" {
			return true
		}
	}
	return false
}
