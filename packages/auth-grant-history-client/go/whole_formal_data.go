package originalclient

import (
	"bytes"
	"errors"
	"fmt"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

// Private adapters to the SOLE SDK DATA codec. No second JSON/WIRE grammar.
type OriginalWholeResponseLimitError struct {
	OperationID, State string
	ActualBytes, Limit int
	SignedProof        policy.Proof
}

func (e *OriginalWholeResponseLimitError) Error() string {
	return fmt.Sprintf("%s: actual=%d limit=%d; -1 means SDK rejected global cap before returning bytes", ErrWholeResponseLimit, e.ActualBytes, e.Limit)
}
func (e *OriginalWholeResponseLimitError) Unwrap() error { return ErrWholeResponseLimit }
func proofDATA(p policy.Proof) open.TaskAuthorityProofDATA {
	return open.TaskAuthorityProofDATA{Purpose: p.Purpose, PayloadOriginal: bytes.Clone(p.Payload), WireOriginal: bytes.Clone(p.Wire)}
}
func EncodeOriginalWholeResponseDATA(e OriginalWholeResponseEvidence, limit int) ([]byte, error) {
	raw, err := open.EncodeTaskAuthorityWholeResponseDATA(open.TaskAuthorityWholeResponseInputDATA{Version: "1", OriginalBody: bytes.Clone(e.OriginalBody), Proof: proofDATA(e.Proof)}, open.TaskAuthorityWholeMaxBytes)
	if err != nil && !errors.Is(err, open.ErrBounds) {
		return nil, err
	}
	if limit < 1 || limit > open.TaskAuthorityWholeMaxBytes || err != nil || len(raw) > limit {
		p, _ := open.DecodeTaskAuthorityResponsePayloadDATA(e.Proof.Payload)
		actual := len(raw)
		if err != nil {
			actual = -1
		}
		return nil, &OriginalWholeResponseLimitError{OperationID: p.OperationID, State: p.State, ActualBytes: actual, Limit: limit, SignedProof: policy.Proof{Purpose: e.Proof.Purpose, Payload: bytes.Clone(e.Proof.Payload), Wire: bytes.Clone(e.Proof.Wire)}}
	}
	return raw, nil
}
func DecodeOriginalWholeResponseDATA(raw []byte, limit int) (OriginalWholeResponseEvidence, error) {
	d, e := open.DecodeTaskAuthorityWholeResponseDATA(raw, limit)
	if e != nil {
		return OriginalWholeResponseEvidence{}, e
	}
	return OriginalWholeResponseEvidence{OriginalBody: bytes.Clone(d.OriginalBody), Proof: policy.Proof{Purpose: d.Proof.Purpose, Payload: bytes.Clone(d.Proof.PayloadOriginal), Wire: bytes.Clone(d.Proof.WireOriginal)}}, nil
}
func originalRequestDATABytes(e OriginalWholeResponseExpected) ([]byte, error) {
	b, err := originalAuthorityBodyDATA(e.Call, e.History)
	if err != nil {
		return nil, err
	}
	return open.EncodeTaskAuthorityRequestDATA(open.TaskAuthorityRequestInputDATA{Version: "1", Nonce: e.Nonce, Account: e.Account, CurrentTaskRevision: e.CurrentTaskRevision, CurrentGeneration: e.CurrentGeneration, SourceExpires: e.SourceExpires, OriginalBody: b})
}
