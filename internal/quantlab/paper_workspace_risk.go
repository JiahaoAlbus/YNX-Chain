package quantlab

import (
	"encoding/json"
	"strings"
)

// These receipts belong to the already selected durable native workspace.
// They neither grant a tenant capability nor authorize live/Testnet execution.
type paperRiskReceipt struct {
	IdempotencyKey string     `json:"idempotencyKey"`
	Action         string     `json:"action"`
	RequestDigest  string     `json:"requestDigest"`
	Paper          PaperState `json:"paper"`
}

func (s *Service) submitPaperRisk(action, key, reason string, cash, position int64) (paperRiskReceipt, error) {
	if len(key) < 8 || len(key) > 128 || strings.TrimSpace(key) != key || (action != "kill" && action != "reconcile") || (action == "kill" && (len(strings.TrimSpace(reason)) < 3 || len(reason) > 500)) {
		return paperRiskReceipt{}, ErrInvalid
	}
	digest := hash(struct {
		Action, Reason string
		Cash, Position int64
	}{action, reason, cash, position})
	s.mu.Lock()
	defer s.mu.Unlock()
	release, err := s.lockAndReload()
	if err != nil {
		return paperRiskReceipt{}, err
	}
	defer release()
	storageKey := "native-paper-risk:v1:" + hashBytes([]byte(key))
	if stored, ok := s.state.Idempotency[storageKey]; ok {
		var prior paperRiskReceipt
		if json.Unmarshal([]byte(stored), &prior) != nil || prior.IdempotencyKey != key || prior.Action != action {
			return paperRiskReceipt{}, ErrConflict
		}
		if prior.RequestDigest != digest {
			return paperRiskReceipt{}, ErrConflict
		}
		prior.Paper = copyPaperObservation(prior.Paper)
		return prior, nil
	}
	count := 0
	for k := range s.state.Idempotency {
		if strings.HasPrefix(k, "native-paper-risk:v1:") {
			count++
		}
	}
	if count >= 10000 {
		return paperRiskReceipt{}, ErrUnavailable
	}
	var result PaperState
	if action == "kill" {
		result, err = s.killPaperLocked(reason)
	} else {
		result, err = s.reconcilePaperLocked(cash, position)
	}
	if err != nil {
		return paperRiskReceipt{}, err
	}
	// Receipt is a risk observation, not another copy of unbounded order history.
	// Orders remain readable through the owner's separate snapshot route.
	result.Orders = nil
	receipt := paperRiskReceipt{key, action, digest, result}
	encoded, err := json.Marshal(receipt)
	if err != nil {
		return paperRiskReceipt{}, err
	}
	next := make(map[string]string, len(s.state.Idempotency)+1)
	for k, v := range s.state.Idempotency {
		next[k] = v
	}
	next[storageKey] = string(encoded)
	s.state.Idempotency = next
	// Risk state, audit and idempotent receipt are committed in one CAS save.
	if err = s.save(); err != nil {
		return paperRiskReceipt{}, err
	}
	receipt.Paper = copyPaperObservation(receipt.Paper)
	return receipt, nil
}
