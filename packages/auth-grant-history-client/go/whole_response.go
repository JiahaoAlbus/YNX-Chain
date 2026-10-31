package originalclient

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	core "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	"reflect"
	"strconv"
	"sync"
	"time"
	policy "ynx.local/authgrantpolicy"
)

// PRIVATE CANDIDATE purpose. Not E21/E3 and NOT a published/admitted SDK domain.
// SDK/Root must independently accept the exact final public contract.
const OriginalTaskResponseCandidatePurpose = "YNX-OPEN/TASK-AUTHORITY-RESPONSE/1"
const responseCandidateVersion = "AUTH-TASK-AUTHORITY-RESPONSE/private-candidate-v1"
const requestCandidateVersion = "AUTH-TASK-AUTHORITY-REQUEST/private-candidate-v1"

var ErrWholeResponse = errors.New("AUTH_ORIGINAL_WHOLE_RESPONSE_INVALID")
var ErrWholeResponseUnavailable = errors.New("AUTH_ORIGINAL_WHOLE_RESPONSE_SOURCE_NOT_SUPPLIED")
var ErrWholeResponseLimit = errors.New("AUTH_ORIGINAL_WHOLE_RESPONSE_TOTAL_BYTES_LIMIT")

type OriginalResponseTransportFacts struct {
	Action, Path, Service, Origin, ContentType string
	StatusCode                                 int
}
type OriginalResponseCallBinding struct {
	GrantRef                                           open.LegacyGrantRefV1
	GrantPayload, GrantWire, HolderPayload, HolderWire policy.Bind
	Issuer, Holder                                     open.LegacyGrantRefV1
	IssuerEpoch, HolderEpoch                           string
	Binding                                            open.GrantStepBindingV1
	RequestBinding                                     policy.Bind
}
type OriginalResponseResourceFacts struct {
	OperationID, RemoteRef, AuthScope string
	Source                            policy.Source
	ResponseBinding                   policy.Bind
}
type OriginalWholeResponsePayload struct {
	Version, Purpose, Realm, Tenant, Authority                     string
	Account, CurrentTaskRevision, CurrentGeneration, SourceExpires string
	ResponseIssuer                                                 open.LegacyGrantRefV1
	IssuerEpoch, PolicyRevision, Height                            string
	ChainID                                                        []byte
	Call                                                           OriginalResponseCallBinding
	Transport                                                      OriginalResponseTransportFacts
	OperationID, State                                             string
	OpaqueOriginalBinding, WholeServiceResponseBinding             policy.Bind
	WholeRequestBinding                                            policy.Bind
	Resource                                                       *OriginalResponseResourceFacts
	Nonce, IssuedAt, Expires                                       string
}

// SDK owns final outer WIRE. Proof is OUTSIDE OriginalBody: no self-reference.
type OriginalWholeResponseEvidence struct {
	OriginalBody []byte
	Proof        policy.Proof
}
type OriginalWholeResponseExpected struct {
	Call                                                           TaskAuthorityCall
	History                                                        bool
	Transport                                                      OriginalResponseTransportFacts
	Nonce, Authority                                               string
	Account, CurrentTaskRevision, CurrentGeneration, SourceExpires string
}

type responseIssuerRegistration struct {
	Authority, Realm, Tenant, Service, Epoch, PolicyRevision, Height string
	Principal                                                        open.LegacyGrantRefV1
	Role, Purpose, Status, ObservedAt, Expires                       string
	ChainID, PKA, PKB                                                []byte
	ActiveFrom                                                       uint64
	RevokedAt                                                        *uint64
}
type responseIssuerOwner struct {
	held         *heldDocument
	registration responseIssuerRegistration
}

func openResponseIssuer(ref protectedRef) (*responseIssuerOwner, error) {
	h, e := holdDocument(ref)
	o := &responseIssuerOwner{held: h}
	if e != nil {
		return o, e
	}
	if e = decodePrivate(h.raw, &o.registration); e != nil {
		return o, e
	}
	return o, o.current(context.Background())
}
func (o *responseIssuerOwner) current(ctx context.Context) error {
	if o == nil || o.held == nil || ctx == nil {
		return ErrWholeResponseUnavailable
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	if e := o.held.current(); e != nil {
		return e
	}
	r := o.registration
	if r.Authority == "" || r.Realm == "" || r.Tenant == "" || r.Principal.ID == "" || r.Principal.Realm != r.Realm || r.Principal.Tenant != r.Tenant || r.Role != r.Principal.Kind || (r.Role != "service" && r.Role != "organization") || r.Purpose != OriginalTaskResponseCandidatePurpose || r.Status != "active" || r.Service == "" || len(r.ChainID) != 32 || len(r.PKA) != core.PublicKeyASize || len(r.PKB) != core.PublicKeyBSize {
		return ErrWholeResponseUnavailable
	}
	at := time.Now().UnixMilli()
	a, e := sourceUint(r.ObservedAt)
	if e != nil {
		return e
	}
	b, e := sourceUint(r.Expires)
	if e != nil || at < 0 || uint64(at) < a || uint64(at) >= b {
		return ErrSourceCurrent
	}
	if _, e = sourceUint(r.Epoch); e != nil {
		return e
	}
	if _, e = sourceUint(r.PolicyRevision); e != nil {
		return e
	}
	height, e := sourceUint(r.Height)
	if e != nil {
		return e
	}
	if height < r.ActiveFrom || r.RevokedAt != nil && height >= *r.RevokedAt {
		return ErrSourceCurrent
	}
	_, e = sourceUint(r.Principal.Rev)
	return e
}
func sourceUint(s string) (uint64, error) {
	v, e := strconv.ParseUint(s, 10, 64)
	if e != nil || strconv.FormatUint(v, 10) != s {
		return 0, ErrWholeResponse
	}
	return v, nil
}
func originalCallBinding(call TaskAuthorityCall, history bool) (OriginalResponseCallBinding, error) {
	copied, e := authorityCall(call, history)
	if e != nil {
		return OriginalResponseCallBinding{}, e
	}
	g, e := open.DecodeBoundGrant(copied.Grant.Payload)
	if e != nil {
		return OriginalResponseCallBinding{}, e
	}
	body, e := originalAuthorityBodyDATA(copied, history)
	if e != nil {
		return OriginalResponseCallBinding{}, e
	}
	return OriginalResponseCallBinding{GrantRef: copied.GrantRef, GrantPayload: bindResult(copied.Grant.Payload), GrantWire: bindResult(copied.Grant.Wire), HolderPayload: bindResult(copied.Holder.Payload), HolderWire: bindResult(copied.Holder.Wire), Issuer: g.Issuer, Holder: g.Holder, IssuerEpoch: g.IssuerEpoch, HolderEpoch: g.HolderEpoch, Binding: g.Binding, RequestBinding: bindResult(body)}, nil
}
func payloadForOriginalResponse(reg responseIssuerRegistration, expected OriginalWholeResponseExpected, original []byte, issued, expires string) (OriginalWholeResponsePayload, error) {
	call, e := originalCallBinding(expected.Call, expected.History)
	if e != nil {
		return OriginalWholeResponsePayload{}, e
	}
	result, e := originalServiceResultDATA(original, expected.Call, expected.History)
	if e != nil {
		return OriginalWholeResponsePayload{}, e
	}
	g, e := open.DecodeBoundGrant(expected.Call.Grant.Payload)
	if e != nil || g.Realm != reg.Realm || g.Tenant != reg.Tenant || expected.Authority != reg.Authority || expected.Transport.Service != reg.Service || expected.Transport.ContentType != "application/json" || len(expected.Nonce) != 64 {
		return OriginalWholeResponsePayload{}, ErrWholeResponse
	}
	n, e := hex.DecodeString(expected.Nonce)
	if e != nil || hex.EncodeToString(n) != expected.Nonce {
		return OriginalWholeResponsePayload{}, ErrWholeResponse
	}
	if expected.Transport.Action != "effect" && expected.Transport.Action != "query" || expected.History != (expected.Transport.Action == "query") || expected.Transport.Path == "" || expected.Transport.Origin == "" {
		return OriginalWholeResponsePayload{}, ErrWholeResponse
	}
	var envelope serviceEnvelopeDATA
	if json.Unmarshal(original, &envelope) != nil || envelope.OK && expected.Transport.StatusCode != 200 || !envelope.OK && expected.Transport.StatusCode != 409 {
		return OriginalWholeResponsePayload{}, ErrWholeResponse
	}
	if expected.Account == "" || expected.CurrentTaskRevision == "" || expected.CurrentGeneration == "" {
		return OriginalWholeResponsePayload{}, ErrWholeResponse
	}
	if _, e = sourceUint(expected.CurrentTaskRevision); e != nil {
		return OriginalWholeResponsePayload{}, e
	}
	if _, e = sourceUint(expected.CurrentGeneration); e != nil {
		return OriginalWholeResponsePayload{}, e
	}
	if _, e = sourceUint(expected.SourceExpires); e != nil {
		return OriginalWholeResponsePayload{}, e
	}
	p := OriginalWholeResponsePayload{Version: responseCandidateVersion, Purpose: OriginalTaskResponseCandidatePurpose, Realm: reg.Realm, Tenant: reg.Tenant, Authority: reg.Authority, Account: expected.Account, CurrentTaskRevision: expected.CurrentTaskRevision, CurrentGeneration: expected.CurrentGeneration, SourceExpires: expected.SourceExpires, ResponseIssuer: reg.Principal, IssuerEpoch: reg.Epoch, PolicyRevision: reg.PolicyRevision, Height: reg.Height, ChainID: bytes.Clone(reg.ChainID), Call: call, Transport: expected.Transport, OperationID: result.OriginalOperation, State: result.State, OpaqueOriginalBinding: bindResult([]byte(result.Original)), WholeServiceResponseBinding: bindResult(original), Nonce: expected.Nonce, IssuedAt: issued, Expires: expires}
	if result.Resource != nil {
		r := result.Resource
		p.Resource = &OriginalResponseResourceFacts{OperationID: r.OperationID, RemoteRef: r.RemoteRef, AuthScope: r.AuthScope, Source: r.Source, ResponseBinding: r.ResponseBinding}
	}
	request, e := originalRequestCandidateBytes(expected)
	if e != nil {
		return OriginalWholeResponsePayload{}, e
	}
	p.WholeRequestBinding = bindResult(request)
	return p, nil
}

// Concrete protected-current/Core AND verifier. Its pin is supplied only by
// original release selection, not by a caller or the proof being checked.
type OriginalWholeResponseVerifier struct{ issuer *responseIssuerOwner }

func (v *OriginalWholeResponseVerifier) Current(ctx context.Context) error {
	if v == nil {
		return ErrWholeResponseUnavailable
	}
	return v.issuer.current(ctx)
}
func (v *OriginalWholeResponseVerifier) Verify(ctx context.Context, expected OriginalWholeResponseExpected, evidence OriginalWholeResponseEvidence) (TaskAuthorityResult, error) {
	var zero TaskAuthorityResult
	if e := v.Current(ctx); e != nil {
		return zero, e
	}
	start := time.Now().UnixMilli()
	original := bytes.Clone(evidence.OriginalBody)
	proof := policy.Proof{Purpose: evidence.Proof.Purpose, Payload: bytes.Clone(evidence.Proof.Payload), Wire: bytes.Clone(evidence.Proof.Wire)}
	if proof.Purpose != OriginalTaskResponseCandidatePurpose || len(original) < 1 || len(original) > 1048576 || len(proof.Payload) > 65536 {
		return zero, ErrWholeResponse
	}
	var p OriginalWholeResponsePayload
	if decodeCanonicalSourceDATA(proof.Payload, &p) != nil {
		return zero, ErrWholeResponse
	}
	canonical, e := canonicalOriginalJSON(p)
	if e != nil || !bytes.Equal(canonical, proof.Payload) {
		return zero, ErrWholeResponse
	}
	wanted, e := payloadForOriginalResponse(v.issuer.registration, expected, original, p.IssuedAt, p.Expires)
	if e != nil || !reflect.DeepEqual(p, wanted) {
		return zero, ErrWholeResponse
	}
	issued, e := sourceUint(p.IssuedAt)
	if e != nil {
		return zero, e
	}
	end, e := sourceUint(p.Expires)
	if e != nil || end <= issued || end-issued > 60000 || start < 0 || uint64(start) < issued || uint64(start) >= end {
		return zero, ErrWholeResponse
	}
	regEnd, _ := sourceUint(v.issuer.registration.Expires)
	if end > regEnd {
		return zero, ErrWholeResponse
	}
	sourceEnd, e := sourceUint(expected.SourceExpires)
	if e != nil || end > sourceEnd {
		return zero, ErrWholeResponse
	}
	member, e := core.DecodeMember(proof.Wire)
	if e != nil || !bytes.Equal(member.Message, proof.Payload) {
		return zero, ErrWholeResponse
	}
	r := v.issuer.registration
	height, e := sourceUint(r.Height)
	if e != nil {
		return zero, e
	}
	verifier, e := core.NewVerifier(core.VerifierOptions{ChainID: bytes.Clone(r.ChainID), Purpose: OriginalTaskResponseCandidatePurpose, ResolveTrustedOwner: func(q core.TrustRequest) (core.Registration, error) {
		if e := v.Current(ctx); e != nil {
			return core.Registration{}, e
		}
		if q.Owner != r.Principal.ID || q.Purpose != OriginalTaskResponseCandidatePurpose || q.Height != height || !bytes.Equal(q.ChainID, r.ChainID) {
			return core.Registration{}, ErrWholeResponse
		}
		return core.Registration{AlgorithmVersion: core.Version, Owner: r.Principal.ID, Purpose: OriginalTaskResponseCandidatePurpose, PolicyRevision: r.PolicyRevision, ChainID: bytes.Clone(r.ChainID), PKA: bytes.Clone(r.PKA), PKB: bytes.Clone(r.PKB), Enabled: true, ActiveFrom: r.ActiveFrom, RevokedAt: r.RevokedAt}, nil
	}})
	if e != nil {
		return zero, e
	}
	defer verifier.Clear()
	if e = verifier.VerifyOne(proof.Wire, height); e != nil {
		return zero, e
	}
	result, e := originalServiceResultDATA(original, expected.Call, expected.History)
	if e != nil {
		return zero, e
	}
	if e = v.Current(ctx); e != nil {
		return authorityObservationPartial(result), e
	}
	now := time.Now().UnixMilli()
	if now < start || uint64(now) >= end || !bytes.Equal(original, evidence.OriginalBody) || !bytes.Equal(proof.Payload, evidence.Proof.Payload) || !bytes.Equal(proof.Wire, evidence.Proof.Wire) {
		return authorityObservationPartial(result), ErrSourceCurrent
	}
	result.Resource = cloneTaskResource(result.Resource)
	return result, nil
}

// Gate is the original same-authority Node Source/SQL + protected actual caller
// fence. LINK supplies the real opaque handle bridge; no JSON can install it.
type originalWholeResponseGate interface {
	Current(context.Context) error
	AssertOriginalResponseAtSignFence(context.Context, OriginalWholeResponseExpected, []byte) error
	Retire() error
	Join() error
	Close() error
}
type OriginalWholeResponseIssuer struct {
	mu        sync.Mutex
	signMu    sync.Mutex
	active    sync.WaitGroup
	closeOnce sync.Once
	closeErr  error
	seen      map[string]struct{}
	retired   bool
	key       *core.PrivateKey
	issuer    *responseIssuerOwner
	gate      originalWholeResponseGate
	custody   originalResponseCustody
}
type OriginalResponseSignedPartialError struct {
	Cause              error
	OperationID, State string
	SignedProof        policy.Proof
}

func (e *OriginalResponseSignedPartialError) Error() string {
	return "AUTH_WHOLE_RESPONSE_SIGNED_PARTIAL_REQUIRES_ORIGINAL_QUERY"
}
func (e *OriginalResponseSignedPartialError) Unwrap() error { return e.Cause }
func (s *OriginalWholeResponseIssuer) SignOriginalAuthorityResponse(ctx context.Context, expected OriginalWholeResponseExpected, original []byte) (evidence OriginalWholeResponseEvidence, err error) {
	if s == nil || s.key == nil || s.issuer == nil || s.gate == nil {
		return evidence, ErrWholeResponseUnavailable
	}
	s.mu.Lock()
	if s.retired {
		s.mu.Unlock()
		return evidence, ErrSourceRetired
	}
	s.active.Add(1)
	s.mu.Unlock()
	defer s.active.Done()
	s.signMu.Lock()
	defer s.signMu.Unlock()
	s.mu.Lock()
	retired := s.retired
	s.mu.Unlock()
	if retired {
		return evidence, ErrSourceRetired
	}
	if s.custody != nil {
		if e := s.custody.Current(ctx); e != nil {
			return evidence, e
		}
	}
	if e := s.issuer.current(ctx); e != nil {
		return evidence, e
	}
	body := bytes.Clone(original)
	if e := s.gate.Current(ctx); e != nil {
		return evidence, e
	}
	if e := s.gate.AssertOriginalResponseAtSignFence(ctx, expected, body); e != nil {
		return evidence, e
	}
	now := time.Now().UnixMilli()
	regEnd, e := sourceUint(s.issuer.registration.Expires)
	if e != nil {
		return evidence, e
	}
	end := uint64(now) + 30000
	if end > regEnd {
		end = regEnd
	}
	sourceEnd, e := sourceUint(expected.SourceExpires)
	if e != nil {
		return evidence, e
	}
	if end > sourceEnd {
		end = sourceEnd
	}
	if now < 0 || uint64(now) >= end {
		return evidence, ErrSourceCurrent
	}
	payload, e := payloadForOriginalResponse(s.issuer.registration, expected, body, strconv.FormatInt(now, 10), strconv.FormatUint(end, 10))
	if e != nil {
		return evidence, e
	}
	wire, e := canonicalOriginalJSON(payload)
	if e != nil {
		return evidence, e
	}
	// Ephemeral actual-caller nonce fence, NOT a replacement authority ledger.
	// The original Node op/once/budget remains in its original same SQLite DB.
	// An entered caller handle cannot be re-signed after UNKNOWN; recovery is a
	// fresh authorized original QUERY, never an effect replay/new grant/gen.
	s.mu.Lock()
	if s.retired {
		s.mu.Unlock()
		return evidence, ErrSourceRetired
	}
	if s.seen == nil {
		s.seen = map[string]struct{}{}
	}
	if _, ok := s.seen[expected.Nonce]; ok {
		s.mu.Unlock()
		return evidence, ErrWholeResponse
	}
	s.seen[expected.Nonce] = struct{}{}
	s.mu.Unlock()
	batch, e := core.BatchSign(s.key, core.Metadata{ChainID: bytes.Clone(s.issuer.registration.ChainID), Owner: s.issuer.registration.Principal.ID, Purpose: OriginalTaskResponseCandidatePurpose}, [][]byte{wire}, core.SignOptions{})
	if e != nil {
		return evidence, e
	}
	defer batch.Discard()
	member, e := core.Extract(batch, 0)
	if e != nil {
		return evidence, e
	}
	memberWire, e := core.EncodeMember(member)
	if e != nil {
		return evidence, e
	}
	evidence = OriginalWholeResponseEvidence{OriginalBody: body, Proof: policy.Proof{Purpose: OriginalTaskResponseCandidatePurpose, Payload: wire, Wire: memberWire}}
	// Preserve an already-signed partial for custody/reconciliation on late error,
	// but never return usable model data as business success or re-sign UNKNOWN.
	partial := func(cause error) (OriginalWholeResponseEvidence, error) {
		return OriginalWholeResponseEvidence{}, &OriginalResponseSignedPartialError{Cause: cause, OperationID: payload.OperationID, State: payload.State, SignedProof: policy.Proof{Purpose: evidence.Proof.Purpose, Payload: bytes.Clone(evidence.Proof.Payload), Wire: bytes.Clone(evidence.Proof.Wire)}}
	}
	if !bytes.Equal(member.Certificate.Context.PKA, s.issuer.registration.PKA) || !bytes.Equal(member.Certificate.Context.PKB, s.issuer.registration.PKB) {
		return partial(ErrWholeResponse)
	}
	if e = s.gate.Current(ctx); e != nil {
		return partial(e)
	}
	if e = s.gate.AssertOriginalResponseAtSignFence(ctx, expected, body); e != nil {
		return partial(e)
	}
	if e = s.issuer.current(ctx); e != nil {
		return partial(e)
	}
	if s.custody != nil {
		if e = s.custody.Current(ctx); e != nil {
			return partial(e)
		}
	}
	finalPayload, e := payloadForOriginalResponse(s.issuer.registration, expected, body, payload.IssuedAt, payload.Expires)
	if e != nil {
		return partial(e)
	}
	finalWire, e := canonicalOriginalJSON(finalPayload)
	if e != nil || !bytes.Equal(finalWire, wire) {
		return partial(ErrSourceCurrent)
	}
	finalAt := time.Now().UnixMilli()
	if finalAt < now || finalAt >= int64(end) || !bytes.Equal(body, original) {
		return partial(ErrSourceCurrent)
	}
	s.mu.Lock()
	retired = s.retired
	s.mu.Unlock()
	if retired {
		return partial(ErrSourceRetired)
	}
	return evidence, nil
}
func (s *OriginalWholeResponseIssuer) Retire() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	s.retired = true
	s.mu.Unlock()
	if s.gate != nil {
		return s.gate.Retire()
	}
	return nil
}
func (s *OriginalWholeResponseIssuer) Join() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	retired := s.retired
	s.mu.Unlock()
	if !retired {
		return ErrSourceRetired
	}
	s.active.Wait()
	if s.gate != nil {
		return s.gate.Join()
	}
	return nil
}
func (s *OriginalWholeResponseIssuer) Close() error {
	if s == nil {
		return nil
	}
	s.closeOnce.Do(func() {
		s.closeErr = errors.Join(s.Retire(), s.Join())
		if s.issuer != nil {
			s.closeErr = errors.Join(s.closeErr, s.issuer.held.close())
		}
		if s.gate != nil {
			s.closeErr = errors.Join(s.closeErr, s.gate.Close())
		}
		if s.custody != nil {
			s.closeErr = errors.Join(s.closeErr, s.custody.Close())
		}
	})
	return s.closeErr
}
