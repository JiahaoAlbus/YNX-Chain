//go:build darwin || linux

package tasklocalsource

import (
	"context"
	"errors"
	"reflect"
	"sync"

	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	policy "ynx.local/authgrantpolicy"
)

type originalReservedRuntime interface {
	originalRuntime
	OpenOriginalTaskReservationSource(context.Context, policy.TaskEffectBinding, policy.Proof, policy.Proof, string) (policy.HeldOriginalTaskReservationSource, error)
}

// Separate subtype. The old heldLocalSource Snapshot remains NEW-only.
type heldLocalReservation struct {
	mu                          sync.Mutex
	owner                       *Owner
	marker                      *heldLocalSource
	original                    policy.HeldOriginalTaskReservationSource
	binding                     policy.TaskEffectBinding
	operation                   string
	first, retireErr, closeErr  error
	retired, selected, claiming bool
	active                      int
	retireOnce, closeOnce       sync.Once
}

func reservationBindingCopy(b policy.TaskEffectBinding) policy.TaskEffectBinding {
	b.Fields = append([]string(nil), b.Fields...)
	b.Resources = append([]policy.Ref(nil), b.Resources...)
	b.Sources = append([]policy.Source(nil), b.Sources...)
	for i := range b.Sources {
		b.Sources[i].Fields = append([]string(nil), b.Sources[i].Fields...)
	}
	if b.EgressActual != nil {
		v := *b.EgressActual
		b.EgressActual = &v
	}
	return b
}
func (o *Owner) OpenOriginalTaskReservationSource(ctx context.Context, b policy.TaskEffectBinding, g, h policy.Proof, operation string) (policy.HeldOriginalTaskReservationSource, error) {
	if e := localBinding(b); e != nil {
		return nil, e
	}
	if operation == "" || len(operation) > 256 {
		return nil, native.ErrProof
	}
	if e := o.begin(ctx); e != nil {
		return nil, e
	}
	defer o.end()
	held := &heldLocalReservation{owner: o, binding: reservationBindingCopy(b), operation: operation, marker: &heldLocalSource{owner: o}}
	o.mu.Lock()
	if o.children == nil {
		o.children = make(map[*heldLocalSource]struct{})
	}
	o.children[held.marker] = struct{}{}
	o.mu.Unlock()
	runtime, ok := o.runtime.(originalReservedRuntime)
	if !ok {
		held.first = native.ErrUnavailable
		return held, held.first
	}
	original, e := runtime.OpenOriginalTaskReservationSource(ctx, held.binding, g, h, operation)
	held.original = original
	held.marker.original = original // owned partial FIRST
	if original != nil {
		v := reflect.ValueOf(original)
		if (v.Kind() == reflect.Pointer || v.Kind() == reflect.Interface) && v.IsNil() {
			held.original = nil
			held.marker.original = nil
		}
	}
	if e != nil {
		held.first = e
		return held, e
	}
	if held.original == nil {
		held.first = native.ErrUnavailable
		return held, held.first
	}
	if e = o.post(ctx); e != nil {
		held.first = e
		return held, e
	}
	return held, nil
}
func (h *heldLocalReservation) remember(e error) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.first == nil {
		h.first = e
	}
	return h.first
}
func (h *heldLocalReservation) enter(ctx context.Context, claim bool) error {
	if h == nil || ctx == nil {
		return native.ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.first != nil {
		return h.first
	}
	if h.retired {
		return native.ErrRetired
	}
	if h.original == nil {
		return native.ErrUnavailable
	}
	if claim {
		if h.selected {
			return &policy.PolicyError{Code: policy.OriginalOnly, Field: "original local claim", OriginalOp: h.operation}
		}
		h.selected = true
		if h.active != 0 {
			h.first = ErrChildrenRetained
			return h.first
		}
		h.claiming = true
	} else if h.claiming {
		return ErrChildrenRetained
	}
	h.active++
	return nil
}
func (h *heldLocalReservation) leave() { h.mu.Lock(); h.active--; h.mu.Unlock() }
func (h *heldLocalReservation) leaveClaim() {
	h.mu.Lock()
	h.active--
	h.claiming = false
	h.mu.Unlock()
}
func (h *heldLocalReservation) current(ctx context.Context) error {
	live := func() error {
		h.mu.Lock()
		defer h.mu.Unlock()
		if h.first != nil {
			return h.first
		}
		if h.retired {
			return native.ErrRetired
		}
		return nil
	}
	if e := live(); e != nil {
		return e
	}
	if e := h.owner.begin(ctx); e != nil {
		return e
	}
	defer h.owner.end()
	// A request cancellation is not revocation of the shared local parent.
	// No borrowed LINK child is retired/drained/closed by this Source adapter.
	if e := h.owner.runtime.Current(ctx); e != nil {
		if !errors.Is(e, context.Canceled) && !errors.Is(e, context.DeadlineExceeded) {
			h.owner.mu.Lock()
			if h.owner.first == nil {
				h.owner.first = e
			}
			h.owner.mu.Unlock()
		}
		return e
	}
	if e := h.owner.post(ctx); e != nil {
		return e
	}
	return live()
}
func (h *heldLocalReservation) Snapshot(ctx context.Context) (policy.Snapshot, error) {
	if e := h.enter(ctx, false); e != nil {
		return policy.Snapshot{}, e
	}
	defer h.leave()
	if e := h.current(ctx); e != nil {
		return policy.Snapshot{}, h.remember(e)
	}
	s, e := h.original.Snapshot(ctx)
	if e != nil {
		return policy.Snapshot{}, h.remember(e)
	}
	if !reflect.DeepEqual(s.Grant.Binding, h.binding) || s.Effect.State != "UNKNOWN" || s.Effect.OriginalOp != h.operation || s.Effect.Slot != h.binding.Slot() {
		return policy.Snapshot{}, h.remember(native.ErrProof)
	}
	if e = h.current(ctx); e != nil {
		return policy.Snapshot{}, h.remember(e)
	}
	return s, nil
}
func (h *heldLocalReservation) AssertCurrent(ctx context.Context, v policy.SourceVersion) error {
	if e := h.enter(ctx, false); e != nil {
		return e
	}
	defer h.leave()
	if e := h.current(ctx); e != nil {
		return h.remember(e)
	}
	if e := h.original.AssertCurrent(ctx, v); e != nil {
		return h.remember(e)
	}
	if e := h.current(ctx); e != nil {
		return h.remember(e)
	}
	return nil
}
func (h *heldLocalReservation) AssertOriginalReservation(ctx context.Context, v policy.SourceVersion, s policy.SemanticSlot, operation string) error {
	if e := h.enter(ctx, false); e != nil {
		return e
	}
	defer h.leave()
	if s != h.binding.Slot() || operation != h.operation {
		return h.remember(native.ErrProof)
	}
	if e := h.current(ctx); e != nil {
		return h.remember(e)
	}
	if e := h.original.AssertOriginalReservation(ctx, v, s, operation); e != nil {
		return h.remember(e)
	}
	if e := h.current(ctx); e != nil {
		return h.remember(e)
	}
	return nil
}
func (h *heldLocalReservation) ClaimOriginalReservation(ctx context.Context, v policy.SourceVersion, s policy.SemanticSlot, operation string) error {
	if e := h.enter(ctx, true); e != nil {
		return e
	}
	defer h.leaveClaim()
	if s != h.binding.Slot() || operation != h.operation {
		return h.remember(native.ErrProof)
	}
	if e := h.current(ctx); e != nil {
		return h.remember(e)
	}
	if e := h.original.ClaimOriginalReservation(ctx, v, s, operation); e != nil {
		return h.remember(e)
	}
	if e := h.current(ctx); e != nil {
		return h.remember(e)
	}
	return nil
}
func (h *heldLocalReservation) FenceScope() policy.FenceScope { return policy.EgressOnlyReadFence }
func (h *heldLocalReservation) Retire() error {
	if h == nil {
		return nil
	}
	h.retireOnce.Do(func() {
		h.mu.Lock()
		h.retired = true
		h.mu.Unlock()
		if h.original != nil {
			h.retireErr = h.original.Retire()
		}
	})
	return h.retireErr
}
func (h *heldLocalReservation) Join() error {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	retired, active := h.retired, h.active
	h.mu.Unlock()
	if !retired {
		return native.ErrRetired
	}
	if active != 0 {
		return ErrChildrenRetained
	}
	if h.original != nil {
		return h.original.Join()
	}
	return nil
}
func (h *heldLocalReservation) Close() error {
	if h == nil {
		return nil
	}
	retire := h.Retire()
	if e := h.Join(); e != nil {
		return e
	}
	h.closeOnce.Do(func() {
		h.closeErr = retire
		if h.original != nil {
			if e := h.original.Close(); e != nil && h.closeErr == nil {
				h.closeErr = e
			}
		}
		if h.closeErr == nil {
			h.owner.mu.Lock()
			delete(h.owner.children, h.marker)
			h.owner.mu.Unlock()
		}
	})
	return h.closeErr
}

var _ policy.OriginalTaskReservationVerifier = (*Owner)(nil)
var _ policy.HeldOriginalTaskReservationSource = (*heldLocalReservation)(nil)
