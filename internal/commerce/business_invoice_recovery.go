package commerce

import (
	"context"
	"errors"
	"regexp"
)

var errInvoiceNotBound = errors.New("original invoice not yet bound")
var invoiceRecoveryID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

// Existing invoice recovery is a local read under the original action nonce
// transaction. It cannot create another Pay intent or grant settlement.
func boundInvoiceHandoff(order Order) (PayInvoiceHandoff, error) {
	if order.InvoiceID == "" {
		return PayInvoiceHandoff{}, errInvoiceNotBound
	}
	if order.Status != "payment_pending" || !invoiceRecoveryID.MatchString(order.InvoiceID) || order.PayIntentID == "" || order.PayMerchant == "" || order.PayPayoutAddress == "" {
		return PayInvoiceHandoff{}, ErrInvalidState
	}
	return PayInvoiceHandoff{InvoiceID: order.InvoiceID, IntentID: order.PayIntentID, Merchant: order.PayMerchant, PayoutAddress: order.PayPayoutAddress, DeepLink: "ynxpay://invoice/" + order.InvoiceID}, nil
}

func (s *Server) recoverBusinessInvoice(ctx context.Context, verified *verifiedBusinessRequest, target string, body []byte) (any, error) {
	var in struct{ IdempotencyKey string }
	if err := decodeBusinessBody(body, &in); err != nil {
		return nil, err
	}
	if len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 {
		return nil, ErrInvalidState
	}
	var result any
	err := s.store.withBusinessAction(ctx, verified.proof, func() error { return verified.current(ctx) }, func(tx *Store) error {
		actor := verified.principal.Account
		if verified.walletAccount != "" {
			var err error
			actor, err = tx.resolveBusinessActor(verified.walletAccount)
			if err != nil {
				return err
			}
		}
		order, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return err
		}
		handoff, err := boundInvoiceHandoff(order)
		if err != nil {
			return err
		}
		result = invoiceEffectResponse(order, handoff)
		return nil
	})
	return result, err
}
