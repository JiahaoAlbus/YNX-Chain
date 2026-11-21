package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"
)

// A bounded observation of the original Pay intent. This DTO deliberately has
// no paid/refunded amount, signing Member, invoice link or private DomainData.
// Only the independent original Core funds proof can change Shop settlement.
type NativeShopIntentObservation struct {
	OrderID           string `json:"orderId"`
	OriginalOperation string `json:"originalOperation"`
	State             string `json:"state"`
	Phase             string `json:"phase"`
	QueryOnly         bool   `json:"queryOnly"`
	FundsVerified     bool   `json:"fundsVerified"`
}

type nativeIntentObservationInput struct {
	Order           Order
	Origin          string
	OriginalRequest *NativeShopInvoiceRequestDATA `json:",omitempty"`
	OriginalSession string                        `json:",omitempty"`
}

// A bound order may be observed only against the session from its own retained
// original creation or recovered creation response, never a later Pay reply.
func originalNativeIntentSession(tx *Store, order Order, origin string, request NativeShopInvoiceRequestDATA) (string, error) {
	for _, record := range tx.s.BusinessEffects {
		if record.Kind != "pay.native-create" || record.Target != order.ID {
			continue
		}
		var original nativeInvoiceInput
		if err := decodeEffect(record.Input, &original); err != nil {
			return "", err
		}
		if original.Origin != origin {
			return "", ErrConflict
		}
		want, e := json.Marshal(request)
		got, f := json.Marshal(original.Request)
		if e != nil || f != nil || !bytes.Equal(want, got) {
			return "", ErrConflict
		}
		_, binding, err := nativeInvoiceReply(original, record.Result, true)
		if err != nil {
			return "", err
		}
		if binding.IntentID != order.PayIntentID || binding.InvoiceID != order.InvoiceID || binding.Merchant != order.PayMerchant || binding.PayoutAddress != order.PayPayoutAddress {
			return "", ErrConflict
		}
		var view struct {
			Terms NativeShopPayTerms `json:"terms"`
		}
		if err := json.Unmarshal(record.Result, &view); err != nil || view.Terms.SessionID == "" {
			return "", ErrInvalidState
		}
		return view.Terms.SessionID, nil
	}
	return "", ErrNotFound
}

func originalNativeIntentObservation(order Order, raw json.RawMessage) (NativeShopIntentObservation, error) {
	var view struct {
		IntentID          string `json:"intentId"`
		OriginalOperation string `json:"originalOperation"`
		State             string `json:"state"`
		Phase             string `json:"phase"`
		Merchant          string `json:"merchant"`
		Request           struct {
			ProductID   string `json:"productId"`
			StoreID     string `json:"storeId"`
			SourceOrder string `json:"sourceOrder"`
			Merchant    string `json:"merchant"`
			Recipient   string `json:"recipient"`
		} `json:"request"`
		Terms struct {
			InvoiceID string `json:"invoiceId"`
			Recipient string `json:"recipient"`
		} `json:"terms"`
	}
	if err := json.Unmarshal(raw, &view); err != nil {
		return NativeShopIntentObservation{}, ErrInvalidState
	}
	if view.IntentID != order.PayIntentID || view.OriginalOperation != order.PayIntentID ||
		view.Request.ProductID != "shop.order" || view.Request.StoreID != order.StoreID ||
		view.Request.SourceOrder != order.ID || view.Request.Merchant != order.PayMerchant ||
		view.Merchant != order.PayMerchant || view.Request.Recipient != order.PayPayoutAddress ||
		view.Terms.Recipient != order.PayPayoutAddress || view.Terms.InvoiceID != order.InvoiceID ||
		(view.State != "PREPARED" && view.State != "ISSUED") || !nativeShopPaySegment(view.Phase) || len(view.Phase) > 96 {
		return NativeShopIntentObservation{}, ErrConflict
	}
	return NativeShopIntentObservation{OrderID: order.ID, OriginalOperation: order.PayIntentID,
		State: view.State, Phase: view.Phase, QueryOnly: true, FundsVerified: false}, nil
}

func (s *Server) nativePayIntentObservation(target string, proof businessActionAuthorization) (businessEffectPlan, error) {
	if s.cfg.NativePay == nil || s.cfg.NativePay.client.Transport == nil || s.cfg.NativePay.origin == "" {
		return businessEffectPlan{}, ErrUnavailable
	}
	// Copy the supplied concrete consumer and wrap its exact original transport
	// in the existing durable dispatch/current guard. No default HTTP fallback.
	pay := *s.cfg.NativePay
	pay.client = *guardedEffectHTTPClient(&pay.client, 10*time.Second)
	plan := businessEffectPlan{kind: "pay.native-intent", target: target,
		key: businessNonceDigest(proof.SessionBinding, proof.Nonce), status: 200}
	plan.prepare = func(tx *Store, actor string) (json.RawMessage, error) {
		order, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return nil, err
		}
		if _, err := originalNativeShopPayIntentPath(order.PayIntentID); err != nil {
			return nil, err
		}
		if order.InvoiceID == "" || order.PayMerchant == "" || order.PayPayoutAddress == "" {
			return nil, ErrInvalidState
		}
		original, err := tx.readOriginalShopNativeInvoiceRequestLocked(actor, "buyer", target)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return nil, err
		}
		// Legacy bindings without a captured create record keep the existing
		// narrow read, but a priced Native order must have its original bill.
		if errors.Is(err, ErrNotFound) && order.NativePrice != nil {
			return nil, ErrNotFound
		}
		var request *NativeShopInvoiceRequestDATA
		var session string
		if err == nil {
			request = &original
			session, err = originalNativeIntentSession(tx, order, pay.origin, original)
			if err != nil {
				return nil, err
			}
		}
		return encodeEffect(nativeIntentObservationInput{Order: order, Origin: pay.origin, OriginalRequest: request, OriginalSession: session})
	}
	plan.check = func(tx *Store, actor string, record BusinessEffect) error {
		var saved nativeIntentObservationInput
		if err := decodeEffect(record.Input, &saved); err != nil {
			return err
		}
		order, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return err
		}
		old := saved.Order
		if saved.Origin != pay.origin || order.ID != old.ID || order.Buyer != old.Buyer ||
			order.StoreID != old.StoreID || order.InvoiceID != old.InvoiceID || order.PayIntentID != old.PayIntentID ||
			order.PayMerchant != old.PayMerchant || order.PayPayoutAddress != old.PayPayoutAddress {
			return ErrConflict
		}
		if saved.OriginalRequest != nil {
			original, err := tx.readOriginalShopNativeInvoiceRequestLocked(actor, "buyer", target)
			if err != nil {
				return err
			}
			want, e := json.Marshal(saved.OriginalRequest)
			got, f := json.Marshal(original)
			if e != nil || f != nil || !bytes.Equal(want, got) {
				return ErrConflict
			}
			session, err := originalNativeIntentSession(tx, order, pay.origin, original)
			if err != nil || session != saved.OriginalSession {
				return ErrConflict
			}
		}
		// Expired/cancelled orders still query their original operation. Current
		// catalog prices, stock and reservation deadlines cannot create a new one.
		return nil
	}
	plan.send = func(ctx context.Context, record BusinessEffect) (json.RawMessage, error) {
		var saved nativeIntentObservationInput
		if err := decodeEffect(record.Input, &saved); err != nil {
			return nil, err
		}
		exchange, err := pay.ReadOriginalInvoiceIntent(ctx, saved.Order.PayIntentID)
		if err != nil {
			return nil, err
		}
		return exchange.Response, nil
	}
	observe := func(tx *Store, actor string, record BusinessEffect) (any, error) {
		order, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return nil, err
		}
		var saved nativeIntentObservationInput
		if err := decodeEffect(record.Input, &saved); err != nil {
			return nil, err
		}
		if saved.OriginalRequest != nil {
			observation, binding, err := nativeInvoiceReply(nativeInvoiceInput{Order: saved.Order, Origin: saved.Origin, Request: *saved.OriginalRequest}, record.Result, true)
			if err != nil {
				return nil, err
			}
			if binding.IntentID != order.PayIntentID || binding.InvoiceID != order.InvoiceID || binding.Merchant != order.PayMerchant || binding.PayoutAddress != order.PayPayoutAddress {
				return nil, ErrConflict
			}
			var view struct {
				Terms NativeShopPayTerms `json:"terms"`
			}
			if json.Unmarshal(record.Result, &view) != nil || view.Terms.SessionID != saved.OriginalSession {
				return nil, ErrConflict
			}
			return observation, nil
		}
		return originalNativeIntentObservation(order, record.Result)
	}
	plan.finish, plan.view = observe, observe
	return plan, nil
}
