package productreadsource

import "encoding/json"

// Consume only the actual original SDK projection. This typed adoption does
// not independently verify or qualify it; runtime must first complete the
// fixed pinned verifier and both physical/current checks.
func readOriginalSDKProjection(p map[string]json.RawMessage, r release) (ScopeDATA, previous, int64, error) {
	var empty ScopeDATA
	var next previous
	var status, id, subject string
	var only, admitted bool
	var expires int64
	get := func(k string, v any) bool { return json.Unmarshal(p[k], v) == nil }
	if !get("status", &status) || !get("sourceId", &id) || !get("subjectOwner", &subject) || !get("dataOnly", &only) || !get("nativeAdmission", &admitted) || !get("expiresAtMs", &expires) || status != "active" || id != r.sourceID || !owner.MatchString(subject) || !only || admitted {
		return empty, next, 0, ErrDenied
	}
	var selected map[string]json.RawMessage
	if decode(p["selection"], &selected) != nil {
		return empty, next, 0, ErrDenied
	}
	var scope ScopeDATA
	if decode(selected[SelectionKey], &scope) != nil || validateScope(scope) != nil || scope.Account != subject || scope.ProtectedResourceRef != r.resourceRef {
		return empty, next, 0, ErrDenied
	}
	if !get("sequence", &next.Sequence) || !get("floor", &next.Floor) || !get("head", &next.Head) || !get("timeFloor", &next.TimeFloor) || !get("executionHeight", &next.ExecutionHeight) || next.Floor > next.Sequence || !network.MatchString(next.Head) || next.ExecutionHeight == "" {
		return empty, next, 0, ErrDenied
	}
	return scope, next, expires, nil
}
