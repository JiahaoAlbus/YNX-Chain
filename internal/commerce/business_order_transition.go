package commerce

import (
	"context"
	"strings"
)

type orderTransitionInput struct {
	Action, Carrier, TrackingNumber, Reason, Explanation, Body, IdempotencyKey string
	OriginalReturnID                                                           string
	Rating                                                                     int
}

// Preserve the exact legacy semantic request when no original return selector is
// supplied. The optional selector only narrows the existing Seller transition.
type orderTransitionRequest struct {
	OrderID, Next    string
	Shipment         *Shipment
	Resolution       *Resolution
	Review           *Review
	OriginalReturnID string `json:",omitempty"`
}

func originalTransitionRequest(id, next string, ship *Shipment, res *Resolution, review *Review, returnID string) orderTransitionRequest {
	return orderTransitionRequest{id, next, ship, res, review, returnID}
}

func (in orderTransitionInput) parts() (*Shipment, *Resolution, *Review) {
	var ship *Shipment
	var res *Resolution
	var review *Review
	if in.Action == "shipped" {
		ship = &Shipment{Carrier: in.Carrier, TrackingNumber: in.TrackingNumber}
	}
	if strings.Contains(in.Action, "return") || strings.Contains(in.Action, "refund") || in.Action == "disputed" {
		res = &Resolution{Kind: strings.Split(in.Action, "_")[0], Reason: in.Reason, Explanation: in.Explanation}
	}
	if in.Action == "reviewed" {
		review = &Review{Rating: in.Rating, Body: in.Body}
	}
	return ship, res, review
}

func (s *Server) runBusinessOrderTransition(ctx context.Context, verified *verifiedBusinessRequest, target string, body []byte) (Order, error) {
	var in orderTransitionInput
	if err := decodeBusinessBody(body, &in); err != nil {
		return Order{}, err
	}
	// The route handles pure original transitions now. External Trust submission
	// needs its durable provider adapter; refunds need exact Wallet approval.
	if in.Action == "disputed" {
		return Order{}, &businessHTTPError{"BUSINESS_EXTERNAL_ADMISSION_REQUIRED", 503}
	}
	if in.Action == "refund_approved" {
		return Order{}, &businessHTTPError{"WALLET_SENSITIVE_APPROVAL_REQUIRED", 409}
	}
	var result Order
	err := s.store.withBusinessAction(ctx, verified.proof, func() error { return verified.current(ctx) }, func(tx *Store) error {
		actor := verified.principal.Account
		if verified.walletAccount != "" {
			var err error
			actor, err = tx.resolveBusinessActor(verified.walletAccount)
			if err != nil {
				return err
			}
		}
		ship, res, review := in.parts()
		var err error
		result, err = tx.transitionOriginalReturn(actor, verified.principal.Role, target, in.Action, ship, res, review, in.OriginalReturnID, in.IdempotencyKey)
		return err
	})
	return result, err
}
