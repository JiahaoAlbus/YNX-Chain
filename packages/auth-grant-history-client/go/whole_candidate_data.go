package originalclient

import (
	"bytes"
	"encoding/json"
	"fmt"
	policy "ynx.local/authgrantpolicy"
)

// Private candidate ONLY. SDK owns final public envelope/MIME. Proof is outside
// OriginalBody and does not recursively participate in WholeServiceResponseBind.
type wholeCandidateDATA struct {
	Version      string
	OriginalBody []byte
	Proof        policy.Proof
}
type OriginalWholeResponseLimitError struct {
	OperationID, State string
	ActualBytes, Limit int
	SignedProof        policy.Proof
}

func (e *OriginalWholeResponseLimitError) Error() string {
	return fmt.Sprintf("%s: actual=%d limit=%d original operation retained", ErrWholeResponseLimit, e.ActualBytes, e.Limit)
}
func (e *OriginalWholeResponseLimitError) Unwrap() error { return ErrWholeResponseLimit }
func EncodeOriginalWholeResponseCandidateDATA(e OriginalWholeResponseEvidence, limit int) ([]byte, error) {
	if limit < 1 || limit > 1048576 {
		return nil, ErrWholeResponseLimit
	}
	raw, err := canonicalOriginalJSON(wholeCandidateDATA{Version: responseCandidateVersion, OriginalBody: bytes.Clone(e.OriginalBody), Proof: policy.Proof{Purpose: e.Proof.Purpose, Payload: bytes.Clone(e.Proof.Payload), Wire: bytes.Clone(e.Proof.Wire)}})
	if err != nil {
		return nil, err
	}
	if len(raw) > limit {
		var p OriginalWholeResponsePayload
		_ = json.Unmarshal(e.Proof.Payload, &p)
		return nil, &OriginalWholeResponseLimitError{OperationID: p.OperationID, State: p.State, ActualBytes: len(raw), Limit: limit, SignedProof: policy.Proof{Purpose: e.Proof.Purpose, Payload: bytes.Clone(e.Proof.Payload), Wire: bytes.Clone(e.Proof.Wire)}}
	}
	return raw, nil
}
func DecodeOriginalWholeResponseCandidateDATA(raw []byte, limit int) (OriginalWholeResponseEvidence, error) {
	var zero OriginalWholeResponseEvidence
	if limit < 1 || limit > 1048576 || len(raw) < 1 || len(raw) > limit || uniqueServiceJSON(raw) != nil {
		return zero, ErrWholeResponseLimit
	}
	var d wholeCandidateDATA
	if decodeCanonicalSourceDATA(raw, &d) != nil || d.Version != responseCandidateVersion || d.Proof.Purpose != OriginalTaskResponseCandidatePurpose {
		return zero, ErrWholeResponse
	}
	again, e := canonicalOriginalJSON(d)
	if e != nil || !bytes.Equal(again, raw) {
		return zero, ErrWholeResponse
	}
	if len(d.OriginalBody) > 1048576 || len(d.Proof.Payload) > 65536 || len(d.Proof.Wire) > 1048576 {
		return zero, ErrWholeResponseLimit
	}
	return OriginalWholeResponseEvidence{OriginalBody: bytes.Clone(d.OriginalBody), Proof: policy.Proof{Purpose: d.Proof.Purpose, Payload: bytes.Clone(d.Proof.Payload), Wire: bytes.Clone(d.Proof.Wire)}}, nil
}
