//go:build darwin || linux

// Package grantruntime composes the sole shared policy, OPEN codecs and Core
// dual-AND verifier. It does not issue grants or invent Source admission.
package grantruntime

import (
	"bytes"
	"context"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"errors"
	"net/url"
	"reflect"
	"strconv"
	"sync"
	"time"

	core "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

// DATA from original authority release/projection, not a public approval API.
// The original supplier must export this from its SAME authority/current
// boundary. No Go SQLite replacement or live cross-process lock is claimed.
type principalRegistration struct {
	Principal   policy.Ref
	Epoch, Role string
	PKA, PKB    []byte
	ActiveFrom  uint64
	RevokedAt   *uint64
}
type authorityProjection struct {
	Version                 string
	ChainID                 []byte
	Height                  uint64
	Issuer, Holder          principalRegistration
	Snapshot                policy.Snapshot
	AuthorizationRef        string
	GrantProof, HolderProof policy.Proof
	ModelDisclosure         *modelDisclosure
}
type modelDisclosure struct {
	Account, TaskID, SessionID, Model, URL string
	Disclosure                             policy.DisclosureState
}
type releaseSelection struct {
	Projection               protectedRef
	Authority, Realm, Tenant string
}

// Only the independent original Source release may supply exactly one actual
// acquisition. No ENV/CLI/request argument/caller JSON may populate this table.
var admittedOriginalGrantReleases = [...]releaseSelection{}

type Runtime struct {
	mu         sync.Mutex
	selection  releaseSelection
	held       *heldDocument
	projection authorityProjection
	retired    bool
	closeOnce  sync.Once
	closeErr   error
}

// OpenOriginalGrantRuntime is the normal zero-input factory. Empty original
// release selection is UNAVAILABLE, not a nil verifier pretending connected.
func OpenOriginalGrantRuntime() (*Runtime, error) {
	if len(admittedOriginalGrantReleases) != 1 {
		return nil, ErrUnavailable
	}
	for _, s := range admittedOriginalGrantReleases {
		return openProtectedRuntime(s)
	}
	return nil, ErrUnavailable
}
func openProtectedRuntime(s releaseSelection) (r *Runtime, err error) {
	r = &Runtime{selection: s}
	r.held, err = holdDocument(s.Projection) // Adopt partial before error inspection.
	if err != nil {
		return r, err
	}
	if err = decodePrivate(r.held.raw, &r.projection); err != nil {
		return r, err
	}
	p := r.projection
	if p.Version != "AUTH-ORIGINAL-GRANT-PROJECTION/private-v1" || len(p.ChainID) != 32 || s.Authority == "" || s.Realm == "" || s.Tenant == "" || p.Snapshot.Version.Authority != s.Authority || p.Snapshot.Grant.Binding.Realm != s.Realm || p.Snapshot.Grant.Binding.Tenant != s.Tenant {
		return r, ErrUnavailable
	}
	if err = r.checkCurrent(); err != nil {
		return r, err
	}
	return r, nil
}
func (r *Runtime) checkCurrent() error {
	if r == nil {
		return ErrUnavailable
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.retired {
		return ErrRetired
	}
	return r.held.current()
}
func (r *Runtime) Retire() error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	r.retired = true
	r.mu.Unlock()
	return nil
}
func (r *Runtime) Current(ctx context.Context) error {
	if ctx == nil || r == nil {
		return ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	return r.checkCurrent()
}
func (r *Runtime) Close() error {
	if r == nil {
		return nil
	}
	r.closeOnce.Do(func() { r.Retire(); r.closeErr = r.held.close() })
	return r.closeErr
}

// OpenCheck holds the original runtime/projection throughout the resource call.
// Caller captures even nonnil+error and closes after the original effect drains.
// grant/holder DATA and Core member wire remain the SDK's E21/E3 + Core grammar.
func (r *Runtime) OpenCheck(ctx context.Context, b policy.TaskEffectBinding, grant, holder policy.Proof) (*policy.TaskGrantCheck, error) {
	if r == nil {
		return nil, ErrUnavailable
	}
	return policy.OpenTaskGrantAtEffect(ctx, r, b, grant, holder)
}

// OriginalTaskRequest is private in-process DATA copied from the actual resource
// owner, not JSON approval. Tool/risk/target/schema are always selected from the
// registered original authority projection, then compared by the product too.
type OriginalTaskRequest struct {
	AuthorizationRef, Realm, Tenant, Account, TaskID, TaskRevision, Generation, StepID, Holder, SessionID string
	Input                                                                                                 policy.Bind
}
type TaskAuthorization struct {
	Verifier      policy.OriginalTaskGrantVerifier
	Binding       policy.TaskEffectBinding
	Grant, Holder policy.Proof
}

func (r *Runtime) ResolveTaskGrant(ctx context.Context, q OriginalTaskRequest) (result TaskAuthorization, err error) {
	if e := r.Current(ctx); e != nil {
		return result, e
	}
	var p authorityProjection
	if e := decodePrivate(r.held.raw, &p); e != nil {
		return result, e
	}
	b := p.Snapshot.Grant.Binding
	if q.AuthorizationRef == "" || q.AuthorizationRef != p.AuthorizationRef || q.Realm != b.Realm || q.Tenant != b.Tenant || q.Account != b.Account || q.TaskID != b.Task.ID || q.TaskRevision != b.Task.Revision || q.Generation != b.Generation || q.StepID != b.StepID || q.Holder != b.Holder.ID || q.SessionID != b.SessionID || q.Input != b.Input {
		return result, ErrProof
	}
	// This real policy+math initialization is not an effect or once reservation.
	// The original SQLite service remains sole reserve/commit/query authority.
	check, e := r.OpenCheck(ctx, b, p.GrantProof, p.HolderProof)
	if check != nil {
		defer func() { err = errors.Join(err, check.Retire(), check.Close()) }()
	}
	if e != nil {
		return result, e
	}
	if e = r.Current(ctx); e != nil {
		return result, e
	}
	return TaskAuthorization{Verifier: r, Binding: b, Grant: p.GrantProof, Holder: p.HolderProof}, nil
}

// Bound model output is independent of tool-read authorization. An actual
// same-authority disclosure record is mandatory; no record means unavailable.
type ModelDisclosureRequest struct {
	Account, TaskID, SessionID, URL, Model string
	Body                                   []byte
}

func (r *Runtime) CheckTaskModelDisclosure(ctx context.Context, q ModelDisclosureRequest) error {
	if e := r.Current(ctx); e != nil {
		return e
	}
	var p authorityProjection
	if e := decodePrivate(r.held.raw, &p); e != nil {
		return e
	}
	d := p.ModelDisclosure
	if d == nil {
		return ErrUnavailable
	}
	b := p.Snapshot.Grant.Binding
	grant := p.Snapshot.Grant
	u, e := url.Parse(q.URL)
	if e != nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || u.RawQuery != "" || u.Host == "" {
		return ErrProof
	}
	sumA, sumB := sha3.Sum512(q.Body), sha512.Sum512(q.Body)
	actual := policy.Bind{Bytes: strconv.Itoa(len(q.Body)), SHA3_512: hex.EncodeToString(sumA[:]), SHA512: hex.EncodeToString(sumB[:])}
	ds := d.Disclosure
	if q.Account != d.Account || q.Account != b.Account || q.TaskID != d.TaskID || q.TaskID != b.Task.ID || q.SessionID != d.SessionID || q.SessionID != b.SessionID || q.URL != d.URL || q.Model != d.Model || q.Model == "" || ds.Status != "active" || ds.GrantID != grant.ID || ds.GrantRevision != grant.Revision || ds.Holder != b.Holder || ds.HolderEpoch != b.HolderEpoch || ds.Actual != actual || ds.Purpose != "ai.model.inference" || ds.Target.Origin != "https://"+u.Host || ds.Target.Path != u.EscapedPath() || ds.Target.Tenant != b.Tenant || ds.Target.Operation != "ai.model.inference" || !reflect.DeepEqual(ds.Sources, b.Sources) || p.Snapshot.Holder.Status != "active" || p.Snapshot.Session.Status != "active" || grant.Status != "active" {
		return ErrProof
	}
	for _, expires := range []string{p.Snapshot.Expires, grant.Expires, ds.Expires} {
		end, e := strconv.ParseUint(expires, 10, 64)
		if e != nil || time.Now().UnixMilli() < 0 || uint64(time.Now().UnixMilli()) >= end {
			return ErrCurrent
		}
	}
	if e = r.Current(ctx); e != nil {
		return e
	}
	// Final original clock check after the held-file/current callback boundary.
	for _, expires := range []string{p.Snapshot.Expires, grant.Expires, ds.Expires} {
		end, _ := strconv.ParseUint(expires, 10, 64)
		if uint64(time.Now().UnixMilli()) >= end {
			return ErrCurrent
		}
	}
	return ctx.Err()
}
func (r *Runtime) OpenTaskGrantSource(ctx context.Context, b policy.TaskEffectBinding, gp, hp policy.Proof) (policy.HeldTaskGrantSource, error) {
	if ctx == nil || r == nil {
		return nil, ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	if e := r.checkCurrent(); e != nil {
		return nil, e
	}
	h := &heldSource{runtime: r}
	var err error
	h.held, err = holdDocument(r.selection.Projection)
	if err != nil {
		return h, err
	}
	if err = decodePrivate(h.held.raw, &h.projection); err != nil {
		return h, err
	}
	g, err := open.DecodeBoundGrant(gp.Payload)
	if err != nil {
		return h, err
	}
	effect, err := open.DecodeGrantEffect(hp.Payload)
	if err != nil {
		return h, err
	}
	reencoded, err := open.EncodeBoundGrant(effect.Grant)
	if err != nil || !bytes.Equal(reencoded, gp.Payload) {
		return h, ErrProof
	}
	if gp.Purpose != open.BoundGrantDomain || hp.Purpose != open.GrantEffectDomain {
		return h, ErrProof
	}
	// Fields/account/egress bytes are original resource selections, not inferred
	// from arbitrary caller metadata; their equality is enforced by shared policy.
	if err = matchGrant(b, g, h.projection.Snapshot); err != nil {
		return h, err
	}
	if err = h.verifyCore(ctx, gp, h.projection.Issuer, g.Issuer, g.IssuerEpoch); err != nil {
		return h, err
	}
	if err = h.verifyCore(ctx, hp, h.projection.Holder, g.Holder, g.HolderEpoch); err != nil {
		return h, err
	}
	if err = h.current(ctx); err != nil {
		return h, err
	}
	h.ready = true
	return h, nil
}

type heldSource struct {
	mu             sync.Mutex
	runtime        *Runtime
	held           *heldDocument
	projection     authorityProjection
	ready, retired bool
	once           sync.Once
	closeErr       error
}

func (h *heldSource) current(ctx context.Context) error {
	if ctx == nil {
		return ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.retired {
		return ErrRetired
	}
	if e := h.runtime.checkCurrent(); e != nil {
		return e
	}
	return h.held.current()
}
func (h *heldSource) verifyCore(ctx context.Context, p policy.Proof, r principalRegistration, ref open.LegacyGrantRefV1, epoch string) error {
	if toRef(ref) != r.Principal || r.Epoch != epoch || r.Principal.Realm != h.runtime.selection.Realm || r.Principal.Tenant != h.runtime.selection.Tenant || len(r.PKA) != core.PublicKeyASize || len(r.PKB) != core.PublicKeyBSize {
		return ErrProof
	}
	if r.Role != r.Principal.Kind || (p.Purpose == open.BoundGrantDomain && (r.Role != "human" && r.Role != "organization" && r.Role != "service")) || (p.Purpose == open.GrantEffectDomain && r.Role != "agent") {
		return ErrProof
	}
	member, e := core.DecodeMember(p.Wire)
	if e != nil || !bytes.Equal(member.Message, p.Payload) {
		return ErrProof
	}
	v, e := core.NewVerifier(core.VerifierOptions{ChainID: h.projection.ChainID, Purpose: p.Purpose, ResolveTrustedOwner: func(q core.TrustRequest) (core.Registration, error) {
		if e := h.current(ctx); e != nil {
			return core.Registration{}, e
		}
		if q.Owner != r.Principal.ID || q.Height != h.projection.Height || q.Purpose != p.Purpose || !bytes.Equal(q.ChainID, h.projection.ChainID) {
			return core.Registration{}, ErrProof
		}
		return core.Registration{AlgorithmVersion: core.Version, Owner: r.Principal.ID, Purpose: p.Purpose, PolicyRevision: h.projection.Snapshot.Version.PolicyRevision, ChainID: append([]byte(nil), h.projection.ChainID...), PKA: append([]byte(nil), r.PKA...), PKB: append([]byte(nil), r.PKB...), Enabled: true, ActiveFrom: r.ActiveFrom, RevokedAt: r.RevokedAt}, nil
	}})
	if e != nil {
		return e
	}
	defer v.Clear()
	return v.VerifyOne(p.Wire, h.projection.Height) // Real Core ML-DSA AND SLH-DSA, both dual paths.
}
func (h *heldSource) Snapshot(ctx context.Context) (policy.Snapshot, error) {
	if e := h.current(ctx); e != nil {
		return policy.Snapshot{}, e
	}
	h.mu.Lock()
	ready := h.ready
	h.mu.Unlock()
	if !ready {
		return policy.Snapshot{}, ErrUnavailable
	}
	// Decode a fresh detached copy, not exposed mutable shared authority state.
	var p authorityProjection
	if e := decodePrivate(h.held.raw, &p); e != nil {
		return policy.Snapshot{}, e
	}
	if e := h.current(ctx); e != nil {
		return policy.Snapshot{}, e
	}
	return p.Snapshot, nil
}
func (h *heldSource) AssertCurrent(ctx context.Context, v policy.SourceVersion) error {
	if v != h.projection.Snapshot.Version {
		return ErrCurrent
	}
	return h.current(ctx)
}
func (h *heldSource) FenceScope() policy.FenceScope { return policy.EgressOnlyReadFence }
func (h *heldSource) Retire() error                 { h.mu.Lock(); h.retired = true; h.mu.Unlock(); return nil }
func (h *heldSource) Join() error                   { return nil } // All verifier/current work synchronous; original caller must drain effect first.
func (h *heldSource) Close() error {
	h.once.Do(func() { h.Retire(); h.closeErr = h.held.close() })
	return h.closeErr
}

func toRef(r open.LegacyGrantRefV1) policy.Ref {
	return policy.Ref{Realm: r.Realm, Tenant: r.Tenant, Kind: r.Kind, ID: r.ID, Revision: r.Rev}
}
func toBind(b open.GrantBindV1) policy.Bind {
	return policy.Bind{Bytes: b.Bytes, SHA3_512: b.SHA3_512, SHA512: b.SHA512}
}
func toSink(s open.GrantTargetV1) policy.Sink {
	return policy.Sink{Service: s.Service, Tenant: s.Tenant, Origin: s.Origin, Path: s.Path, Region: s.Region, Operation: s.Operation}
}
func matchGrant(b policy.TaskEffectBinding, g open.BoundGrantV1, s policy.Snapshot) error {
	p := g.Binding
	resources := make([]policy.Ref, len(g.Resources))
	for i, r := range g.Resources {
		resources[i] = toRef(r)
	}
	sources := make([]policy.Source, len(p.Sources))
	for i, r := range p.Sources {
		sources[i] = policy.Source{Resource: toRef(r.Ref), Fields: append([]string(nil), r.Fields...), Label: r.Label, Binding: toBind(r.Binding)}
	}
	tool := policy.Tool{ID: p.Tool.ID, Version: p.Tool.Version, Operation: g.Operation, Purpose: p.Purpose, Risk: p.Risk, Schema: toBind(p.Tool.Schema)}
	if b.Realm != g.Realm || b.Tenant != g.Tenant || b.GrantID != g.ID || b.GrantRevision != g.Rev || b.Audience != g.Audience || b.Task != toRef(p.Task) || b.Generation != p.Generation || b.StepID != p.StepID || b.Holder != toRef(g.Holder) || b.HolderEpoch != g.HolderEpoch || b.SessionID != p.HolderSession.ID || b.SessionEpoch != p.HolderSession.Epoch || b.ChannelBinding != p.HolderSession.Channel || b.Tool != tool || b.Input != toBind(p.Input) || b.Target != toSink(p.Target) || !reflect.DeepEqual(b.Resources, resources) || !reflect.DeepEqual(b.Sources, sources) {
		return ErrProof
	}
	if s.Grant.ID != g.ID || s.Grant.Revision != g.Rev || s.Grant.Issuer != toRef(g.Issuer) || s.Grant.IssuerEpoch != g.IssuerEpoch || s.Grant.Holder != toRef(g.Holder) || s.Grant.HolderEpoch != g.HolderEpoch || s.Grant.ValidFrom != g.ValidFrom || s.Grant.Expires != g.Expires || s.Grant.Cap != g.Cap || s.Grant.SingleMax != g.SingleMax || s.Grant.NonDelegable != g.NonDelegable || !reflect.DeepEqual(s.Grant.Binding, b) {
		return ErrProof
	}
	return nil
}

// OriginalOperationReference is a query-only reference from the admitted
// original effect record, NOT a receipt or permission to retry/release budget.
type OriginalOperationReference struct{ State, OperationID string }

func (r *Runtime) QueryOriginalOperation(ctx context.Context, b policy.TaskEffectBinding, gp, hp policy.Proof) (result OriginalOperationReference, err error) {
	source, e := r.OpenTaskGrantSource(ctx, b, gp, hp)
	if source != nil {
		defer func() { err = errors.Join(err, source.Retire(), source.Join(), source.Close()) }()
	}
	if e != nil {
		return result, e
	}
	s, e := source.Snapshot(ctx)
	if e != nil {
		return result, e
	}
	if s.Effect.Slot != b.Slot() || s.Effect.State == "NEW" || s.Effect.OriginalOp == "" {
		return result, ErrUnavailable
	}
	// Query does not require active grant (revocation cannot erase old outcome),
	// but the same current holder and session must still authenticate the query.
	if s.Holder.Ref != b.Holder || s.Holder.Epoch != b.HolderEpoch || s.Holder.Status != "active" || s.Session.Status != "active" || s.Session.ID != b.SessionID || s.Session.Epoch != b.SessionEpoch {
		return result, ErrProof
	}
	end, e := strconv.ParseUint(s.Expires, 10, 64)
	if e != nil || uint64(time.Now().UnixMilli()) >= end {
		return result, ErrCurrent
	}
	if e = source.AssertCurrent(ctx, s.Version); e != nil {
		return result, e
	}
	return OriginalOperationReference{s.Effect.State, s.Effect.OriginalOp}, nil
}
