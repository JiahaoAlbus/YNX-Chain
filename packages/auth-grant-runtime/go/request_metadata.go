//go:build darwin || linux

package grantruntime

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"strconv"
	"time"

	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
)

// TaskAuthorityProfile is detached protected Source metadata, NOT a Root,
// caller identity, admission or public capability. No ProductSession is input.
type TaskAuthorityProfile struct{ Realm, Tenant, Authority string }

func (r *Runtime) TaskAuthorityProfile(ctx context.Context) (TaskAuthorityProfile, error) {
	if e := r.Current(ctx); e != nil {
		return TaskAuthorityProfile{}, e
	}
	r.mu.Lock()
	profile := TaskAuthorityProfile{Realm: r.selection.Realm, Tenant: r.selection.Tenant, Authority: r.selection.Authority}
	r.mu.Unlock()
	if profile.Realm == "" || profile.Tenant == "" || profile.Authority == "" {
		return TaskAuthorityProfile{}, ErrUnavailable
	}
	observed, e := exactUint(r.projection.Snapshot.ObservedAt)
	if e != nil {
		return TaskAuthorityProfile{}, e
	}
	end, e := exactUint(r.projection.Snapshot.Expires)
	if e != nil {
		return TaskAuthorityProfile{}, e
	}
	at := time.Now().UnixMilli()
	if at < 0 || uint64(at) < observed || uint64(at) >= end {
		return TaskAuthorityProfile{}, ErrCurrent
	}
	if e := r.Current(ctx); e != nil {
		return TaskAuthorityProfile{}, e
	}
	finalAt := time.Now().UnixMilli()
	if finalAt < at || uint64(finalAt) >= end {
		return TaskAuthorityProfile{}, ErrCurrent
	}
	return profile, nil
}

// Scope is the same protected metadata accessor; it never derives tenant from
// ProductSession or exposes a mutable Source registration object.
func (r *Runtime) Scope(ctx context.Context) (TaskAuthorityProfile, error) {
	return r.TaskAuthorityProfile(ctx)
}

func exactUint(s string) (uint64, error) {
	n, e := strconv.ParseUint(s, 10, 64)
	if e != nil || strconv.FormatUint(n, 10) != s {
		return 0, ErrProof
	}
	return n, nil
}

// QueryOriginalTaskRequest resolves an original historical slot from the
// protected request/ref and proofs. It never calls ResolveTaskGrant/OpenCheck
// or attempts a new effect/reservation. Result is an opaque original reference,
// NOT a resource outcome/content receipt and NOT permission to replay UNKNOWN.
// Capture nonzero result even with late error for original reconciliation only.
func (r *Runtime) QueryOriginalTaskRequest(ctx context.Context, q OriginalTaskRequest) (result OriginalOperationReference, err error) {
	return r.queryOriginalTaskRequest(ctx, q, time.Now)
}

// Private deterministic clock seam for affected lifetime tests only; no public
// process setter or request can install a clock/Source.
func (r *Runtime) queryOriginalTaskRequest(ctx context.Context, q OriginalTaskRequest, clock func() time.Time) (result OriginalOperationReference, err error) {
	if clock == nil {
		return result, ErrUnavailable
	}
	floor := int64(-1)
	now := func() (int64, error) {
		at := clock().UnixMilli()
		if at < 0 || at < floor {
			return 0, ErrCurrent
		}
		floor = at
		return at, nil
	}
	if e := r.Current(ctx); e != nil {
		return result, e
	}
	h := &heldSource{runtime: r}
	var deadline uint64
	defer func() {
		err = errors.Join(err, h.Retire(), h.Join(), h.Close())
		if err == nil {
			err = r.Current(ctx)
			if err == nil {
				at, e := now()
				if e != nil {
					err = e
				} else if uint64(at) >= deadline {
					err = ErrCurrent
				}
			}
		}
	}()
	h.held, err = holdDocument(r.selection.Projection) // retain original partial before error
	if err != nil {
		return result, err
	}
	if err = decodePrivate(h.held.raw, &h.projection); err != nil {
		return result, err
	}
	p := h.projection
	s := p.Snapshot
	b := s.Grant.Binding
	if q.AuthorizationRef == "" || q.AuthorizationRef != p.AuthorizationRef || q.Realm != r.selection.Realm || q.Tenant != r.selection.Tenant || q.Realm != b.Realm || q.Tenant != b.Tenant || q.Account != b.Account || q.TaskID != b.Task.ID || q.TaskID != s.Task.Ref.ID || q.StepID != b.StepID || q.Holder != b.Holder.ID || q.SessionID != b.SessionID || q.Input != b.Input {
		return result, ErrProof
	}
	// A current task can advance after execution. Match CURRENT request metadata
	// against protected CURRENT task, while signed historical Grant/proof and
	// immutable original effect slot retain their old revision/generation.
	if s.Task.Ref.Realm != b.Task.Realm || s.Task.Ref.Tenant != b.Task.Tenant || s.Task.Ref.Kind != b.Task.Kind || q.TaskRevision != s.Task.Ref.Revision || q.Generation != s.Task.Generation || s.Task.Holder != b.Holder || s.Task.HolderEpoch != b.HolderEpoch || s.Task.Status == "" {
		return result, ErrProof
	}
	currentTaskRev, e := exactUint(q.TaskRevision)
	if e != nil {
		return result, e
	}
	originalTaskRev, e := exactUint(b.Task.Revision)
	if e != nil || currentTaskRev < originalTaskRev {
		return result, ErrProof
	}
	currentGen, e := exactUint(q.Generation)
	if e != nil {
		return result, e
	}
	originalGen, e := exactUint(b.Generation)
	if e != nil || currentGen < originalGen {
		return result, ErrProof
	}
	if s.Holder.Status != "active" || s.Holder.Ref != b.Holder || s.Holder.Epoch != b.HolderEpoch || s.Session.Status != "active" || s.Session.ID != b.SessionID || s.Session.Epoch != b.SessionEpoch || s.Session.ChannelBinding != b.ChannelBinding || s.Session.Holder != b.Holder || s.Session.HolderEpoch != b.HolderEpoch {
		return result, ErrProof
	}
	if s.Issuer.Status != "active" || s.Issuer.Ref != s.Grant.Issuer || s.Issuer.Epoch != s.Grant.IssuerEpoch || s.Version.Authority != r.selection.Authority {
		return result, ErrProof
	}
	if _, e = exactUint(s.Version.Revision); e != nil {
		return result, e
	}
	if _, e = exactUint(s.Version.PolicyRevision); e != nil {
		return result, e
	}
	observed, e := exactUint(s.ObservedAt)
	if e != nil {
		return result, e
	}
	deadline, e = exactUint(s.Expires)
	if e != nil {
		return result, e
	}
	at, e := now()
	if e != nil {
		return result, e
	}
	if uint64(at) < observed || uint64(at) >= deadline {
		return result, ErrCurrent
	}
	g, e := open.DecodeBoundGrant(p.GrantProof.Payload)
	if e != nil {
		return result, e
	}
	effect, e := open.DecodeGrantEffect(p.HolderProof.Payload)
	if e != nil {
		return result, e
	}
	full, e := open.EncodeBoundGrant(effect.Grant)
	if e != nil || !bytes.Equal(full, p.GrantProof.Payload) || p.GrantProof.Purpose != open.BoundGrantDomain || p.HolderProof.Purpose != open.GrantEffectDomain {
		return result, ErrProof
	}
	signedRev, e := exactUint(g.Rev)
	if e != nil {
		return result, e
	}
	currentGrantRev, e := exactUint(s.Grant.Revision)
	if e != nil {
		return result, e
	}
	if (s.Grant.Status != "active" && s.Grant.Status != "revoked") || currentGrantRev < signedRev || (s.Grant.Status == "active" && currentGrantRev != signedRev) {
		return result, ErrProof
	}
	// Reuse sole original signed-DATA projection matcher. Only the independently
	// proven CURRENT revocation revision differs from the immutable signed body.
	historical := s
	historical.Grant.Revision = g.Rev
	if s.Issuer.Role != g.Issuer.Kind {
		return result, ErrProof
	}
	if e = matchGrant(b, g, historical); e != nil {
		return result, e
	}
	if e = h.verifyCore(ctx, p.GrantProof, p.Issuer, g.Issuer, g.IssuerEpoch); e != nil {
		return result, e
	}
	if e = h.verifyCore(ctx, p.HolderProof, p.Holder, g.Holder, g.HolderEpoch); e != nil {
		return result, e
	}
	if !reflect.DeepEqual(s.Effect.Slot, b.Slot()) || s.Effect.OriginalOp == "" || len(s.Effect.OriginalOp) > 256 {
		return result, ErrProof
	}
	switch s.Effect.State {
	case "UNKNOWN", "COMMITTED", "FAILED":
	default:
		return result, ErrUnavailable
	}
	if e = h.current(ctx); e != nil {
		return result, e
	}
	at, e = now()
	if e != nil {
		return result, e
	}
	if uint64(at) >= deadline {
		return result, ErrCurrent
	}
	return OriginalOperationReference{State: s.Effect.State, OperationID: s.Effect.OriginalOp}, nil
}
