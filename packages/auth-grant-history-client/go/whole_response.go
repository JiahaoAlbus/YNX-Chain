package originalclient

import (
	"bytes"
	"context"
	"errors"
	core "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	"strconv"
	"sync"
	"time"
	policy "ynx.local/authgrantpolicy"
)

// Sole SDK purpose and grammar; actual independent Root/issuer admission remains separate.
const OriginalTaskResponsePurpose = open.TaskAuthorityResponsePurpose
const responseFormalVersion = "1"
const requestFormalVersion = "1"

var ErrWholeResponse = errors.New("AUTH_ORIGINAL_WHOLE_RESPONSE_INVALID")
var ErrWholeResponseUnavailable = errors.New("AUTH_ORIGINAL_WHOLE_RESPONSE_SOURCE_NOT_SUPPLIED")
var ErrWholeResponseLimit = errors.New("AUTH_ORIGINAL_WHOLE_RESPONSE_TOTAL_BYTES_LIMIT")

type OriginalResponseTransportFacts = open.TaskAuthorityTransportDATA
type OriginalWholeResponsePayload = open.TaskAuthorityResponsePayloadDATA

// SDK owns final outer WIRE. Proof is OUTSIDE OriginalBody: no self-reference.
type OriginalWholeResponseEvidence struct {
	OriginalBody []byte
	Proof        policy.Proof
}
type OriginalWholeResponseExpected struct {
	RequestOriginal                                                []byte
	Call                                                           TaskAuthorityCall
	History                                                        bool
	Transport                                                      OriginalResponseTransportFacts
	Nonce, Authority                                               string
	Account, CurrentTaskRevision, CurrentGeneration, SourceExpires string
}

type responseIssuerRegistration struct {
	Authority, Realm, Tenant, Service, Epoch, PolicyRevision, Height string
	Principal                                                        open.TaskAuthorityFullRefDATA
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
	if r.Authority == "" || r.Realm == "" || r.Tenant == "" || r.Principal.ID == "" || r.Role != r.Principal.Kind || (r.Role != "service" && r.Role != "organization") || r.Purpose != OriginalTaskResponsePurpose || r.Status != "active" || r.Service == "" || len(r.ChainID) != 32 || len(r.PKA) != core.PublicKeyASize || len(r.PKB) != core.PublicKeyBSize {
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
	_, e = open.EncodeTaskAuthorityFullRefDATA(r.Principal)
	return e
}
func sourceUint(s string) (uint64, error) {
	v, e := strconv.ParseUint(s, 10, 64)
	if e != nil || strconv.FormatUint(v, 10) != s {
		return 0, ErrWholeResponse
	}
	return v, nil
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
	wire, e := open.EncodeTaskAuthorityResponsePayloadDATA(payload)
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
	batch, e := core.BatchSign(s.key, core.Metadata{ChainID: bytes.Clone(s.issuer.registration.ChainID), Owner: s.issuer.registration.Principal.ID, Purpose: OriginalTaskResponsePurpose}, [][]byte{wire}, core.SignOptions{})
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
	evidence = OriginalWholeResponseEvidence{OriginalBody: body, Proof: policy.Proof{Purpose: OriginalTaskResponsePurpose, Payload: wire, Wire: memberWire}}
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
	finalWire, e := open.EncodeTaskAuthorityResponsePayloadDATA(finalPayload)
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
