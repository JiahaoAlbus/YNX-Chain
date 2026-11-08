//go:build darwin || linux

package grantruntime

import (
	"context"
	"errors"
	"reflect"
	"strconv"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	policy "ynx.local/authgrantpolicy"
)

// Internal test seam only. The normal method below ALWAYS acquires the actual
// LINK concrete capability; no exported setter/provider accepts this interface.
type originalTaskContinuationBorrow interface {
	Current(context.Context) error
	ReadOriginalRequestDATA(context.Context) ([]byte, error)
	ClaimAtOriginalResourceFence(context.Context) error
}
type heldOriginalReservationSource struct {
	mu                                         sync.Mutex
	source                                     policy.HeldTaskGrantSource
	borrowed                                   originalTaskContinuationBorrow
	binding                                    policy.TaskEffectBinding
	version                                    policy.SourceVersion
	operation                                  string
	originalDATA                               []byte
	ready, retired, selected, claiming, closed bool
	active                                     int
	first, retireErr, closeErr                 error
	endMS                                      uint64
	wallFloor                                  int64
	monoEnd                                    time.Time
	retireOnce, closeOnce                      sync.Once
}

var ErrReservationChildrenRetained = errors.New("GRANT_RESERVATION_CHILDREN_RETAINED")

// Only genuine original LocalCaller context can supply the borrowed control
// capability. Its R/SCM registration/current stays independent of Source math.
func (r *Runtime) OpenOriginalTaskReservationSource(ctx context.Context, b policy.TaskEffectBinding, gp, hp policy.Proof, operation string) (policy.HeldOriginalTaskReservationSource, error) {
	if r == nil || ctx == nil {
		return nil, ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	cap, e := securelink.OriginalTaskReadContinuationFromContext(ctx)
	if e != nil {
		return nil, e
	}
	return r.openOriginalReservationSource(ctx, b, gp, hp, operation, cap)
}
func cloneReservationBinding(b policy.TaskEffectBinding) policy.TaskEffectBinding {
	b.Fields = append([]string(nil), b.Fields...)
	b.Resources = append([]policy.Ref(nil), b.Resources...)
	b.Sources = append([]policy.Source(nil), b.Sources...)
	for i := range b.Sources {
		b.Sources[i].Fields = append([]string(nil), b.Sources[i].Fields...)
	}
	if b.EgressActual != nil {
		copy := *b.EgressActual
		b.EgressActual = &copy
	}
	return b
}
func (r *Runtime) openOriginalReservationSource(ctx context.Context, b policy.TaskEffectBinding, gp, hp policy.Proof, operation string, cap originalTaskContinuationBorrow) (policy.HeldOriginalTaskReservationSource, error) {
	if r == nil || ctx == nil || cap == nil || operation == "" || len(operation) > 256 {
		return nil, ErrUnavailable
	}
	if value := reflect.ValueOf(cap); (value.Kind() == reflect.Pointer || value.Kind() == reflect.Interface) && value.IsNil() {
		return nil, ErrUnavailable
	}
	if b.Tool.ID != "ai.conversation.read" || b.Tool.Operation != "ai.conversation.read" || b.Tool.Version != "1" || b.Tool.Risk != "read" || b.EgressActual != nil {
		return nil, ErrProof
	}
	h := &heldOriginalReservationSource{binding: cloneReservationBinding(b), operation: operation, borrowed: cap}
	gp.Payload = append([]byte(nil), gp.Payload...)
	gp.Wire = append([]byte(nil), gp.Wire...)
	hp.Payload = append([]byte(nil), hp.Payload...)
	hp.Wire = append([]byte(nil), hp.Wire...)
	original, e := r.OpenTaskGrantSource(ctx, h.binding, gp, hp)
	h.source = original // adopt owned Source partial FIRST; borrowed cap is never closed here.
	fail := func(e error) (policy.HeldOriginalTaskReservationSource, error) { h.first = e; return h, e }
	if e != nil {
		return fail(e)
	}
	if original == nil {
		return fail(ErrUnavailable)
	}
	if e = cap.Current(ctx); e != nil {
		return fail(e)
	}
	raw, e := cap.ReadOriginalRequestDATA(ctx)
	h.originalDATA = append([]byte(nil), raw...)
	if e != nil {
		return fail(e)
	}
	if _, _, e = decodeOriginalReservationDATA(h.originalDATA, h.binding, gp, hp, operation); e != nil {
		return fail(e)
	}
	s, e := original.Snapshot(ctx)
	if e != nil {
		return fail(e)
	}
	h.version = s.Version
	if e = h.matchSnapshot(s); e != nil {
		return fail(e)
	}
	now := time.Now()
	if now.UnixMilli() < 0 {
		return fail(ErrCurrent)
	}
	h.wallFloor = now.UnixMilli()
	end, e := strconv.ParseUint(s.Expires, 10, 64)
	if e != nil || strconv.FormatUint(end, 10) != s.Expires {
		return fail(ErrCurrent)
	}
	grantEnd, e := strconv.ParseUint(s.Grant.Expires, 10, 64)
	if e != nil || strconv.FormatUint(grantEnd, 10) != s.Grant.Expires {
		return fail(ErrCurrent)
	}
	if grantEnd < end {
		end = grantEnd
	}
	if end <= uint64(h.wallFloor) || end-uint64(h.wallFloor) > uint64((1<<63-1)/int64(time.Millisecond)) {
		return fail(ErrCurrent)
	}
	h.endMS = end
	h.monoEnd = now.Add(time.Duration(end-uint64(h.wallFloor)) * time.Millisecond)
	if e = original.AssertCurrent(ctx, h.version); e != nil {
		return fail(e)
	}
	if e = cap.Current(ctx); e != nil {
		return fail(e)
	}
	if e = ctx.Err(); e != nil {
		return fail(e)
	}
	h.ready = true
	return h, nil
}
func (h *heldOriginalReservationSource) matchSnapshot(s policy.Snapshot) error {
	if s.Version != h.version && h.version != (policy.SourceVersion{}) || s.Effect.State != "UNKNOWN" || s.Effect.OriginalOp != h.operation || s.Effect.Slot != h.binding.Slot() || !reflect.DeepEqual(s.Grant.Binding, h.binding) {
		return ErrProof
	}
	return nil
}
func (h *heldOriginalReservationSource) remember(e error) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.first == nil {
		h.first = e
	}
	return h.first
}
func (h *heldOriginalReservationSource) enter(ctx context.Context, claim bool) error {
	if h == nil || ctx == nil {
		return ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.first != nil {
		return h.first
	}
	if h.retired || h.closed {
		return ErrRetired
	}
	if !h.ready || h.source == nil {
		return ErrUnavailable
	}
	if claim {
		if h.selected {
			return &policy.PolicyError{Code: policy.OriginalOnly, Field: "original-claim-already-selected", OriginalOp: h.operation}
		}
		h.selected = true
		if h.active != 0 {
			h.first = ErrReservationChildrenRetained
			return h.first
		}
		h.claiming = true
	} else if h.claiming {
		return ErrReservationChildrenRetained
	}
	h.active++
	return nil
}
func (h *heldOriginalReservationSource) leave(claim bool) {
	h.mu.Lock()
	h.active--
	if claim {
		h.claiming = false
	}
	h.mu.Unlock()
}
func (h *heldOriginalReservationSource) local(ctx context.Context, v policy.SourceVersion, slot policy.SemanticSlot, op string) error {
	if v != h.version || slot != h.binding.Slot() || op != h.operation {
		return ErrProof
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	h.mu.Lock()
	if h.first != nil {
		e := h.first
		h.mu.Unlock()
		return e
	}
	if h.retired || h.closed {
		h.mu.Unlock()
		return ErrRetired
	}
	now := time.Now()
	ms := now.UnixMilli()
	if ms < h.wallFloor || ms < 0 || uint64(ms) >= h.endMS || !now.Before(h.monoEnd) {
		h.mu.Unlock()
		return ErrCurrent
	}
	h.wallFloor = ms
	h.mu.Unlock()
	if e := h.source.AssertCurrent(ctx, v); e != nil {
		return e
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.first != nil {
		return h.first
	}
	if h.retired || h.closed {
		return ErrRetired
	}
	now = time.Now()
	ms = now.UnixMilli()
	if ms < h.wallFloor || ms < 0 || uint64(ms) >= h.endMS || !now.Before(h.monoEnd) {
		return ErrCurrent
	}
	h.wallFloor = ms
	return nil
}
func (h *heldOriginalReservationSource) Snapshot(ctx context.Context) (policy.Snapshot, error) {
	if e := h.enter(ctx, false); e != nil {
		return policy.Snapshot{}, e
	}
	defer h.leave(false)
	if e := h.local(ctx, h.version, h.binding.Slot(), h.operation); e != nil {
		return policy.Snapshot{}, h.remember(e)
	}
	if e := h.borrowed.Current(ctx); e != nil {
		return policy.Snapshot{}, h.remember(e)
	}
	s, e := h.source.Snapshot(ctx)
	if e != nil {
		return policy.Snapshot{}, h.remember(e)
	}
	if e = h.matchSnapshot(s); e != nil {
		return policy.Snapshot{}, h.remember(e)
	}
	if e = h.local(ctx, h.version, h.binding.Slot(), h.operation); e != nil {
		return policy.Snapshot{}, h.remember(e)
	}
	return s, nil
}
func (h *heldOriginalReservationSource) AssertCurrent(ctx context.Context, v policy.SourceVersion) error {
	return h.AssertOriginalReservation(ctx, v, h.binding.Slot(), h.operation)
}
func (h *heldOriginalReservationSource) AssertOriginalReservation(ctx context.Context, v policy.SourceVersion, slot policy.SemanticSlot, op string) error {
	if e := h.enter(ctx, false); e != nil {
		return e
	}
	defer h.leave(false)
	if e := h.local(ctx, v, slot, op); e != nil {
		return h.remember(e)
	}
	if e := h.borrowed.Current(ctx); e != nil {
		return h.remember(e)
	}
	if e := h.local(ctx, v, slot, op); e != nil {
		return h.remember(e)
	}
	return nil
}

// Only F occurs here. No C/D, Source/network refresh, resource callback, or
// wait for another Current occurs while P08 holds its original Store.mu.
func (h *heldOriginalReservationSource) ClaimOriginalReservation(ctx context.Context, v policy.SourceVersion, slot policy.SemanticSlot, op string) error {
	if e := h.enter(ctx, true); e != nil {
		return e
	}
	defer h.leave(true)
	if e := h.local(ctx, v, slot, op); e != nil {
		return h.remember(e)
	}
	if e := h.borrowed.ClaimAtOriginalResourceFence(ctx); e != nil {
		return h.remember(e)
	}
	if e := h.local(ctx, v, slot, op); e != nil {
		return h.remember(e)
	}
	return nil
}
func (h *heldOriginalReservationSource) FenceScope() policy.FenceScope {
	return policy.EgressOnlyReadFence
}
func (h *heldOriginalReservationSource) Retire() error {
	if h == nil {
		return nil
	}
	h.retireOnce.Do(func() {
		h.mu.Lock()
		h.retired = true
		h.mu.Unlock()
		if h.source != nil {
			h.retireErr = h.source.Retire()
		}
	})
	return h.retireErr
}
func (h *heldOriginalReservationSource) Join() error {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	retired, active := h.retired, h.active
	h.mu.Unlock()
	if !retired {
		return ErrRetired
	}
	if active != 0 {
		return ErrReservationChildrenRetained
	}
	if h.source != nil {
		return h.source.Join()
	}
	return nil
}
func (h *heldOriginalReservationSource) Close() error {
	if h == nil {
		return nil
	}
	retire := h.Retire()
	if e := h.Join(); e != nil {
		return e
	}
	h.closeOnce.Do(func() {
		h.closeErr = retire
		if h.source != nil {
			if e := h.source.Close(); e != nil && h.closeErr == nil {
				h.closeErr = e
			}
		}
		h.mu.Lock()
		h.closed = h.closeErr == nil
		h.mu.Unlock()
	})
	return h.closeErr
}

var _ policy.OriginalTaskReservationVerifier = (*Runtime)(nil)
var _ policy.HeldOriginalTaskReservationSource = (*heldOriginalReservationSource)(nil)
