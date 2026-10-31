//go:build darwin || linux

// Intake into the ORIGINAL grantruntime package; no second verifier/policy.
package grantruntime

import (
	"bytes"
	"context"
	"errors"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	"reflect"
	"time"
	policy "ynx.local/authgrantpolicy"
)

// PRIVATE query-only material. OriginalOperationID is Node's original authority
// slot, NOT AI's local EffectRef/StepID. No NEW-effect verifier is returned.
type OriginalTaskQueryMaterial struct {
	State, OriginalOperationID string
	CurrentGrantRef            open.LegacyGrantRefV1
	Binding                    policy.TaskEffectBinding
	Grant, Holder              policy.Proof
}

func (r *Runtime) resolveOriginalTaskQueryMaterial(ctx context.Context, q OriginalTaskRequest) (out OriginalTaskQueryMaterial, err error) {
	// Existing original historical callee checks independent current query rights,
	// full original AND signatures, holder/session/task/input and revoked history.
	// Never call ResolveTaskGrant/OpenCheck, never restore deleted effect state.
	original, e := r.QueryOriginalTaskRequest(ctx, q)
	if e != nil {
		return out, e
	}
	h := &heldSource{runtime: r}
	defer func() {
		err = errors.Join(err, h.Retire(), h.Join(), h.Close())
		if err == nil {
			err = r.Current(ctx)
		}
		if err == nil {
			end, e := exactUint(h.projection.Snapshot.Expires)
			at := time.Now().UnixMilli()
			if e != nil || at < 0 || uint64(at) >= end {
				err = ErrCurrent
			}
		}
		if err != nil {
			out = OriginalTaskQueryMaterial{}
		}
	}()
	h.held, err = holdDocument(r.selection.Projection)
	if err != nil {
		return out, err
	}
	if err = decodePrivate(h.held.raw, &h.projection); err != nil {
		return out, err
	}
	if !reflect.DeepEqual(h.projection, r.projection) || h.projection.Snapshot.Effect.OriginalOp != original.OperationID || h.projection.Snapshot.Effect.State != original.State {
		return out, ErrCurrent
	}
	if err = h.current(ctx); err != nil {
		return out, err
	}
	p := h.projection
	b := p.Snapshot.Grant.Binding
	g, e := open.DecodeBoundGrant(p.GrantProof.Payload)
	if e != nil {
		return out, e
	}
	// Shared private snapshot decoder supplies a detached deep copy. Proofs are
	// owned byte copies; no cached consumer or mutable Source pointer escapes.
	out = OriginalTaskQueryMaterial{State: original.State, OriginalOperationID: original.OperationID, CurrentGrantRef: open.LegacyGrantRefV1{Realm: g.Realm, Tenant: g.Tenant, Kind: "grant", ID: g.ID, Rev: p.Snapshot.Grant.Revision}, Binding: b, Grant: policy.Proof{Purpose: p.GrantProof.Purpose, Payload: bytes.Clone(p.GrantProof.Payload), Wire: bytes.Clone(p.GrantProof.Wire)}, Holder: policy.Proof{Purpose: p.HolderProof.Purpose, Payload: bytes.Clone(p.HolderProof.Payload), Wire: bytes.Clone(p.HolderProof.Wire)}}
	if err = h.current(ctx); err != nil {
		return OriginalTaskQueryMaterial{}, err
	}
	return out, nil
}
