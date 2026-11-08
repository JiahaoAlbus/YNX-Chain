package productsessionv2

import (
	"bytes"
	"encoding/json"
	"slices"
)

// originalSessionFields validates one original session projection shared by
// the normal action and backend revalidation callers. It does NOT establish
// live authority: callers must still verify the original signed action or
// perform the existing fresh upstream read and their own current actor fence.
func (c *Client) originalSessionFields(original Session) (map[string]any, error) {
	if c == nil || (original.Version != "2" && original.Version != "3") ||
		original.ChainID != "ynx_6423-1" || original.Platform != c.policy.Platform ||
		original.DeviceAlgorithm != "p256-sha256" || !accountPattern.MatchString(original.Account) ||
		!validScopes(original.Scopes) || !validFiniteConsent(original) {
		return nil, fail("SESSION_BINDING_MISMATCH", 403)
	}
	raw, err := json.Marshal(original)
	if err != nil {
		return nil, fail("INVALID_SESSION", 403)
	}
	var fields map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&fields) != nil || !validSessionFields(fields) || !c.matchesPolicy(fields) {
		return nil, fail("SESSION_BINDING_MISMATCH", 403)
	}
	if original.Version == "3" {
		value, ok := fields["accountAuthorization"].(map[string]any)
		if !ok {
			return nil, fail("PQ_SESSION_ACCOUNT_BINDING_INVALID", 403)
		}
		if _, err := parseSessionAccountAuthorization(value, original.Account); err != nil {
			return nil, err
		}
	}
	for _, scope := range original.Scopes {
		if !slices.Contains(c.policy.AllowedScopes, scope) {
			return nil, fail("SCOPE_WIDENING", 403)
		}
	}
	return fields, nil
}
