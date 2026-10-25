package chain

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

// ConsensusSourceSponsorRequestHash reconstructs the historical source request
// document from an already canonical, authorization-free application payload.
// It deliberately performs no wall-clock checks: an expired historical request
// must remain replayable. This hash grants no authority; callers still verify
// the current signed action and compare signer, action and idempotency key.
func ConsensusSourceSponsorRequestHash(action string, payload []byte) (string, error) {
	var input any
	switch action {
	case ResourcePoolCreateAction:
		input = &ResourcePoolCreateInput{}
	case ResourcePoolFundAction:
		input = &ResourcePoolFundInput{}
	case ResourcePoolPolicyAction:
		input = &ResourcePoolPolicyInput{}
	case ResourcePoolStatusAction:
		input = &ResourcePoolStatusInput{}
	case ResourceSponsorAction:
		input = &ResourceSponsorshipInput{}
	default:
		return "", errors.New("unsupported source sponsor action")
	}
	// The adapter accepts only the new action body, never a caller-supplied old
	// authorization or request hash. Typed decoding restores the zero-valued
	// authorization field required by the original source hash document.
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		return "", err
	}
	if _, exists := fields["authorization"]; exists {
		return "", errors.New("source sponsor replay payload must omit authorization")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(input); err != nil {
		return "", err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return "", errors.New("source sponsor replay payload contains trailing data")
	}
	return resourceSponsorRequestHash(action, input), nil
}
