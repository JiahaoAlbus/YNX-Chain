package originalclient

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	core "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	"strconv"
	"time"
	policy "ynx.local/authgrantpolicy"
)

func formalBind(b policy.Bind) open.GrantBindV1 {
	return open.GrantBindV1{Bytes: b.Bytes, SHA3_512: b.SHA3_512, SHA512: b.SHA512}
}
func formalSource(s policy.Source) open.TaskAuthorityDeclaredSourceDATA {
	return open.TaskAuthorityDeclaredSourceDATA{Resource: open.LegacyGrantRefV1{Realm: s.Resource.Realm, Tenant: s.Resource.Tenant, Kind: s.Resource.Kind, ID: s.Resource.ID, Rev: s.Resource.Revision}, Fields: append([]string(nil), s.Fields...), Label: s.Label, Binding: formalBind(s.Binding)}
}
func formalResource(r *TaskResourceResult) *open.TaskAuthorityActualResourceDATA {
	if r == nil {
		return nil
	}
	return &open.TaskAuthorityActualResourceDATA{OperationID: r.OperationID, RemoteRef: r.RemoteRef, AuthScope: r.AuthScope, Source: formalSource(r.Source), ResponseOriginal: bytes.Clone(r.ResponseOriginal), SourceBytes: bytes.Clone(r.SourceBytes)}
}
func formalExpected(reg responseIssuerRegistration, e OriginalWholeResponseExpected, result TaskAuthorityResult, at string) (open.TaskAuthorityWholeExpectedDATA, error) {
	if e.Authority != reg.Authority || e.Transport.Service != reg.Service || e.Transport.Method != "POST" {
		return open.TaskAuthorityWholeExpectedDATA{}, ErrWholeResponse
	}
	request, err := originalRequestDATABytes(e)
	if err != nil {
		return open.TaskAuthorityWholeExpectedDATA{}, err
	}
	if len(e.RequestOriginal) > 0 && !bytes.Equal(request, e.RequestOriginal) {
		return open.TaskAuthorityWholeExpectedDATA{}, ErrWholeResponse
	}
	return open.TaskAuthorityWholeExpectedDATA{MaxResponseBytes: open.TaskAuthorityWholeMaxBytes, RequestOriginal: request, Call: open.TaskAuthorityOriginalCallDATA{GrantRef: e.Call.GrantRef, Grant: proofDATA(e.Call.Grant), Holder: proofDATA(e.Call.Holder), RawInput: bytes.Clone(e.Call.RawInput), OriginalOperation: e.Call.OriginalOperation}, Transport: e.Transport, Issuer: open.TaskAuthorityRegisteredIssuerDATA{Principal: reg.Principal, IssuerEpoch: reg.Epoch, PolicyRevision: reg.PolicyRevision, Height: reg.Height, ChainID: hex.EncodeToString(reg.ChainID), Expires: reg.Expires}, Realm: reg.Realm, Tenant: reg.Tenant, Authority: e.Authority, Account: e.Account, CurrentTaskRevision: e.CurrentTaskRevision, CurrentGeneration: e.CurrentGeneration, SourceExpires: e.SourceExpires, OperationID: result.OriginalOperation, State: result.State, OpaqueOriginal: result.Original, Resource: formalResource(result.Resource), At: at}, nil
}
func payloadForOriginalResponse(reg responseIssuerRegistration, e OriginalWholeResponseExpected, body []byte, issued, expires string) (OriginalWholeResponsePayload, error) {
	c, err := authorityCall(e.Call, e.History)
	if err != nil {
		return OriginalWholeResponsePayload{}, err
	}
	g, err := open.DecodeBoundGrant(c.Grant.Payload)
	if err != nil {
		return OriginalWholeResponsePayload{}, err
	}
	if g.Realm != reg.Realm || g.Tenant != reg.Tenant || e.Authority != reg.Authority || e.Transport.Service != reg.Service || e.Transport.Method != "POST" || e.Transport.Action != "effect" && e.Transport.Action != "query" || e.History != (e.Transport.Action == "query") {
		return OriginalWholeResponsePayload{}, ErrWholeResponse
	}
	result, err := originalFormalServiceResult(body, e)
	if err != nil {
		return OriginalWholeResponsePayload{}, err
	}
	request, err := originalRequestDATABytes(e)
	if err != nil {
		return OriginalWholeResponsePayload{}, err
	}
	if len(e.RequestOriginal) > 0 && !bytes.Equal(request, e.RequestOriginal) {
		return OriginalWholeResponsePayload{}, ErrWholeResponse
	}
	original, err := originalAuthorityBodyDATA(c, e.History)
	if err != nil {
		return OriginalWholeResponsePayload{}, err
	}
	p := OriginalWholeResponsePayload{Version: "1", Purpose: open.TaskAuthorityResponsePurpose, Realm: reg.Realm, Tenant: reg.Tenant, Authority: e.Authority, Account: e.Account, CurrentTaskRevision: e.CurrentTaskRevision, CurrentGeneration: e.CurrentGeneration, SourceExpires: e.SourceExpires, ResponseIssuer: reg.Principal, IssuerEpoch: reg.Epoch, PolicyRevision: reg.PolicyRevision, Height: reg.Height, ChainID: hex.EncodeToString(reg.ChainID), Call: open.TaskAuthorityResponseCallDATA{GrantRef: c.GrantRef, GrantPayload: formalBind(bindResult(c.Grant.Payload)), GrantWire: formalBind(bindResult(c.Grant.Wire)), HolderPayload: formalBind(bindResult(c.Holder.Payload)), HolderWire: formalBind(bindResult(c.Holder.Wire)), Issuer: g.Issuer, Holder: g.Holder, IssuerEpoch: g.IssuerEpoch, HolderEpoch: g.HolderEpoch, Binding: g.Binding, RequestBinding: formalBind(bindResult(original))}, Transport: e.Transport, OperationID: result.OriginalOperation, State: result.State, OpaqueOriginalBinding: formalBind(bindResult([]byte(result.Original))), WholeServiceResponseBinding: formalBind(bindResult(body)), WholeRequestBinding: formalBind(bindResult(request)), Nonce: e.Nonce, IssuedAt: issued, Expires: expires}
	if result.Resource != nil {
		r := result.Resource
		p.Resource = &open.TaskAuthorityResponseResourceDATA{OperationID: r.OperationID, RemoteRef: r.RemoteRef, AuthScope: r.AuthScope, Source: formalSource(r.Source), ResponseBinding: formalBind(r.ResponseBinding)}
	}
	if _, err = open.EncodeTaskAuthorityResponsePayloadDATA(p); err != nil {
		return OriginalWholeResponsePayload{}, err
	}
	return p, nil
}

// DATA binding is the sole SDK's job; actual two-signature AND trust and the
// protected issuer/current fences remain this original Auth verifier's job.
func (v *OriginalWholeResponseVerifier) Verify(ctx context.Context, expected OriginalWholeResponseExpected, evidence OriginalWholeResponseEvidence) (TaskAuthorityResult, error) {
	var zero TaskAuthorityResult
	if err := v.Current(ctx); err != nil {
		return zero, err
	}
	start := time.Now().UnixMilli()
	original := bytes.Clone(evidence.OriginalBody)
	proof := policy.Proof{Purpose: evidence.Proof.Purpose, Payload: bytes.Clone(evidence.Proof.Payload), Wire: bytes.Clone(evidence.Proof.Wire)}
	result, err := originalFormalServiceResult(original, expected)
	if err != nil {
		return zero, err
	}
	full, err := EncodeOriginalWholeResponseDATA(OriginalWholeResponseEvidence{OriginalBody: original, Proof: proof}, open.TaskAuthorityWholeMaxBytes)
	if err != nil {
		return zero, err
	}
	wanted, err := formalExpected(v.issuer.registration, expected, result, strconv.FormatInt(start, 10))
	if err != nil {
		return zero, err
	}
	bound, err := open.AssertTaskAuthorityWholeResponseBindingDATA(full, wanted)
	if err != nil {
		return zero, err
	}
	reg := v.issuer.registration
	height, err := sourceUint(reg.Height)
	if err != nil {
		return zero, err
	}
	member, err := core.DecodeMember(proof.Wire)
	if err != nil || !bytes.Equal(member.Message, proof.Payload) {
		return zero, ErrWholeResponse
	}
	verifier, err := core.NewVerifier(core.VerifierOptions{ChainID: bytes.Clone(reg.ChainID), Purpose: open.TaskAuthorityResponsePurpose, ResolveTrustedOwner: func(q core.TrustRequest) (core.Registration, error) {
		if err := v.Current(ctx); err != nil {
			return core.Registration{}, err
		}
		if q.Owner != reg.Principal.ID || q.Purpose != open.TaskAuthorityResponsePurpose || q.Height != height || !bytes.Equal(q.ChainID, reg.ChainID) {
			return core.Registration{}, ErrWholeResponse
		}
		return core.Registration{AlgorithmVersion: core.Version, Owner: reg.Principal.ID, Purpose: open.TaskAuthorityResponsePurpose, PolicyRevision: reg.PolicyRevision, ChainID: bytes.Clone(reg.ChainID), PKA: bytes.Clone(reg.PKA), PKB: bytes.Clone(reg.PKB), Enabled: true, ActiveFrom: reg.ActiveFrom, RevokedAt: reg.RevokedAt}, nil
	}})
	if err != nil {
		return zero, err
	}
	defer verifier.Clear()
	if err = verifier.VerifyOne(proof.Wire, height); err != nil {
		return zero, err
	}
	if err = v.Current(ctx); err != nil {
		return authorityObservationPartial(result), err
	}
	now := time.Now().UnixMilli()
	end, _ := sourceUint(bound.Payload.Expires)
	if now < start || uint64(now) >= end || !bytes.Equal(original, evidence.OriginalBody) || !bytes.Equal(proof.Payload, evidence.Proof.Payload) || !bytes.Equal(proof.Wire, evidence.Proof.Wire) {
		return authorityObservationPartial(result), ErrSourceCurrent
	}
	// Re-run the sole binding checker with fresh time after crypto/Source IO.
	wanted.At = strconv.FormatInt(now, 10)
	if _, err = open.AssertTaskAuthorityWholeResponseBindingDATA(full, wanted); err != nil {
		return authorityObservationPartial(result), err
	}
	result.Resource = cloneTaskResource(result.Resource)
	return result, nil
}
func originalFormalServiceResult(body []byte, e OriginalWholeResponseExpected) (TaskAuthorityResult, error) {
	r, err := originalServiceResultDATA(body, e.Call, e.History)
	if err != nil {
		return TaskAuthorityResult{}, err
	}
	var envelope serviceEnvelopeDATA
	if json.Unmarshal(body, &envelope) != nil || envelope.OK && e.Transport.StatusCode != 200 || !envelope.OK && e.Transport.StatusCode != 409 {
		return TaskAuthorityResult{}, ErrWholeResponse
	}
	return r, nil
}
