package commerce

import (
	"context"
	"encoding/json"
	"reflect"
	"time"
)

// V2 needs a concrete HTTP client so every actual dispatch can be fenced and
// journaled. Arbitrary inherited implementations remain available only in v1.
func businessTrustGateway(g TrustGateway) (HTTPTrustGateway, bool) {
	switch gateway := g.(type) {
	case HTTPTrustGateway:
		return gateway, gateway.Available()
	case *HTTPTrustGateway:
		if gateway != nil {
			return *gateway, gateway.Available()
		}
	}
	return HTTPTrustGateway{}, false
}

type trustEffectInput struct {
	Order                       Order
	Key, BaseURL, PublicBaseURL string
}

func (s *Server) trustDisputeEffect(target string, body []byte) (businessEffectPlan, error) {
	var in orderTransitionInput
	if err := decodeBusinessBody(body, &in); err != nil {
		return businessEffectPlan{}, err
	}
	gateway, ok := businessTrustGateway(s.cfg.Trust)
	if !ok {
		return businessEffectPlan{}, ErrUnavailable
	}
	if in.Action != "disputed" || len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 {
		return businessEffectPlan{}, ErrInvalidState
	}
	gateway.Client = guardedEffectHTTPClient(gateway.Client, 10*time.Second)
	plan := businessEffectPlan{kind: "trust.dispute", target: target, key: in.IdempotencyKey, status: 200}
	plan.prepare = func(tx *Store, actor string) (json.RawMessage, error) {
		ship, resolution, review := in.parts()
		order, err := tx.transition(actor, "buyer", target, in.Action, ship, resolution, review, in.IdempotencyKey)
		if err != nil {
			return nil, err
		}
		if order.Status != "disputed" || order.TrustCase != nil || order.Resolution == nil || order.Resolution.Reason == "" {
			return nil, ErrInvalidState
		}
		return encodeEffect(trustEffectInput{order, in.IdempotencyKey, gateway.BaseURL, gateway.PublicBaseURL})
	}
	plan.check = func(tx *Store, actor string, record BusinessEffect) error {
		var saved trustEffectInput
		if err := decodeEffect(record.Input, &saved); err != nil {
			return err
		}
		current, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return err
		}
		// Any order change during await invalidates this submission's local
		// binding; the remote receipt is still retained for explicit recovery.
		if saved.BaseURL != gateway.BaseURL || saved.PublicBaseURL != gateway.PublicBaseURL || !reflect.DeepEqual(current, saved.Order) {
			return ErrConflict
		}
		return nil
	}
	plan.send = func(ctx context.Context, record BusinessEffect) (json.RawMessage, error) {
		var saved trustEffectInput
		if err := decodeEffect(record.Input, &saved); err != nil {
			return nil, err
		}
		evidence, err := gateway.SubmitDispute(ctx, saved.Order, saved.Key)
		if err != nil {
			return nil, err
		}
		return encodeEffect(evidence)
	}
	plan.finish = func(tx *Store, actor string, record BusinessEffect) (any, error) {
		var evidence TrustCaseEvidence
		if err := decodeEffect(record.Result, &evidence); err != nil {
			return nil, err
		}
		return tx.BindTrustCase(actor, target, &evidence, false)
	}
	plan.view = func(tx *Store, actor string, record BusinessEffect) (any, error) {
		var evidence TrustCaseEvidence
		if err := decodeEffect(record.Result, &evidence); err != nil {
			return nil, err
		}
		order, err := tx.Order(actor, "buyer", target)
		if err != nil {
			return nil, err
		}
		if order.TrustCase == nil || !reflect.DeepEqual(*order.TrustCase, evidence) {
			return nil, ErrConflict
		}
		return order, nil
	}
	return plan, nil
}
