//go:build darwin || linux

// Package tasklocalsource retains original TaskGrant runtime custody for the
// existing local conversation read. It is not a grant issuer/provider/Root.
package tasklocalsource

import (
	"context"
	"errors"
	"reflect"
	"sync"

	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	policy "ynx.local/authgrantpolicy"
)

const Version = "AUTH-LOCAL-TASK-NORMAL-SOURCE/v1"

var ErrChildrenRetained = errors.New("TASK_LOCAL_SOURCE_CHILDREN_RETAINED")
var ErrLocalReadOnly = errors.New("TASK_LOCAL_ORIGINAL_CONVERSATION_READ_REQUIRED")

// Internal seam exists solely to exercise lifetime failures. No exported
// constructor/setter/provider/ENV accepts this or installs another verifier.
type originalRuntime interface {
	Current(context.Context) error
	TaskAuthorityProfile(context.Context) (native.TaskAuthorityProfile, error)
	ResolveTaskGrant(context.Context, native.OriginalTaskRequest) (native.TaskAuthorization, error)
	OpenTaskGrantSource(context.Context, policy.TaskEffectBinding, policy.Proof, policy.Proof) (policy.HeldTaskGrantSource, error)
	Retire() error
	Close() error
}
type Owner struct {
	mu                              sync.Mutex
	runtime                         originalRuntime
	first                           error
	retired                         bool
	calls                           int
	children                        map[*heldLocalSource]struct{}
	retireOnce, closeOnce           sync.Once
	retireErr, closeErr, earlyClose error
	receiver                        receiverRuntime
	receiverFirst                   error
	receiverCloseMu                 sync.Mutex
	receiverClosed                  bool
}

// Zero-input normal factory calls the real original factory and preserves a
// nonnull adapter partial even when independent original release inventory is
// empty. It never reads local paths or creates a Source from OS accessibility.
func OpenOriginalLocalTaskGrantSource() (*Owner, error) {
	o := &Owner{children: make(map[*heldLocalSource]struct{})}
	o.openOriginalTaskReadReceiver()
	r, e := native.OpenOriginalGrantRuntime()
	o.runtime = r
	o.first = e
	if e != nil {
		return o, e
	}
	if r == nil {
		o.first = native.ErrUnavailable
		return o, o.first
	}
	return o, nil
}
func (o *Owner) begin(ctx context.Context) error {
	if o == nil || ctx == nil {
		return native.ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.first != nil {
		return o.first
	}
	if o.retired {
		return native.ErrRetired
	}
	if o.runtime == nil {
		return native.ErrUnavailable
	}
	o.calls++
	return nil
}
func (o *Owner) end() { o.mu.Lock(); o.calls--; o.mu.Unlock() }
func (o *Owner) Current(ctx context.Context) error {
	if e := o.begin(ctx); e != nil {
		return e
	}
	defer o.end()
	if e := o.runtime.Current(ctx); e != nil {
		o.mu.Lock()
		if o.first == nil {
			o.first = e
		}
		first := o.first
		o.mu.Unlock()
		return first
	}
	return o.post(ctx)
}
func (o *Owner) post(ctx context.Context) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.retired {
		return native.ErrRetired
	}
	if o.first != nil {
		return o.first
	}
	return nil
}
func (o *Owner) TaskAuthorityProfile(ctx context.Context) (native.TaskAuthorityProfile, error) {
	var out native.TaskAuthorityProfile
	if e := o.begin(ctx); e != nil {
		return out, e
	}
	defer o.end()
	out, e := o.runtime.TaskAuthorityProfile(ctx)
	if e != nil {
		return native.TaskAuthorityProfile{}, e
	}
	if e = o.post(ctx); e != nil {
		return native.TaskAuthorityProfile{}, e
	}
	return out, nil
}
func localBinding(b policy.TaskEffectBinding) error {
	// P08 currently registers precisely this local tool. No implicit file.read,
	// remote order, funds, model egress or new low-risk tool is generalized here.
	if b.Tool.ID != "ai.conversation.read" || b.Tool.Operation != "ai.conversation.read" || b.Tool.Version != "1" || b.Tool.Risk != "read" || b.EgressActual != nil || len(b.Resources) != 1 || len(b.Sources) != 1 || b.Sources[0].Resource != b.Resources[0] || b.Resources[0].ID == "" {
		return ErrLocalReadOnly
	}
	return nil
}
func (o *Owner) ResolveTaskGrant(ctx context.Context, q native.OriginalTaskRequest) (native.TaskAuthorization, error) {
	var zero native.TaskAuthorization
	if e := o.begin(ctx); e != nil {
		return zero, e
	}
	defer o.end()
	out, e := o.runtime.ResolveTaskGrant(ctx, q)
	if e != nil {
		return zero, e
	}
	if e = localBinding(out.Binding); e != nil {
		return zero, e
	}
	if e = o.post(ctx); e != nil {
		return zero, e
	}
	// Preserve original proofs/binding. Only the lifetime wrapper is substituted;
	// it delegates the same original Source/math and narrows to existing local read.
	out.Verifier = o
	return out, nil
}
func (o *Owner) OpenTaskGrantSource(ctx context.Context, b policy.TaskEffectBinding, g, h policy.Proof) (policy.HeldTaskGrantSource, error) {
	if e := localBinding(b); e != nil {
		return nil, e
	}
	if e := o.begin(ctx); e != nil {
		return nil, e
	}
	defer o.end()
	held := &heldLocalSource{owner: o, binding: b}
	original, e := o.runtime.OpenTaskGrantSource(ctx, b, g, h)
	if original != nil {
		v := reflect.ValueOf(original)
		if (v.Kind() == reflect.Pointer || v.Kind() == reflect.Interface) && v.IsNil() {
			original = nil
		}
	}
	held.original = original
	// Adopt the actual nullable original partial before error/post-current. No
	// policy Snapshot or original effect state is fabricated at this boundary.
	o.mu.Lock()
	if o.children == nil {
		o.children = make(map[*heldLocalSource]struct{})
	}
	o.children[held] = struct{}{}
	o.mu.Unlock()
	if e != nil {
		held.first = e
		return held, e
	}
	if original == nil {
		held.first = native.ErrUnavailable
		return held, held.first
	}
	if e = o.post(ctx); e != nil {
		held.first = e
		return held, e
	}
	return held, nil
}
func (o *Owner) Retire() error {
	if o == nil {
		return nil
	}
	o.retireOnce.Do(func() {
		o.mu.Lock()
		o.retired = true
		r := o.runtime
		receiver := o.receiver
		o.mu.Unlock()
		if receiver != nil {
			o.retireErr = receiver.Retire()
		}
		if r != nil {
			o.retireErr = errors.Join(o.retireErr, r.Retire())
		}
	})
	return o.retireErr
}
func (o *Owner) Join() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	if !o.retired {
		o.mu.Unlock()
		return native.ErrRetired
	}
	if o.calls != 0 || len(o.children) != 0 {
		o.mu.Unlock()
		return ErrChildrenRetained
	}
	receiver := o.receiver
	o.mu.Unlock()
	if receiver != nil {
		return receiver.Join()
	}
	return nil
}
func (o *Owner) Close() error {
	if o == nil {
		return nil
	}
	retire := o.Retire()
	o.mu.Lock()
	if o.calls != 0 || len(o.children) != 0 {
		if o.earlyClose == nil {
			o.earlyClose = ErrChildrenRetained
		}
		e := o.earlyClose
		o.mu.Unlock()
		return e
	}
	early := o.earlyClose
	receiver := o.receiver
	o.mu.Unlock()
	// Only our concrete receiver custody is owned here, not P08/LINK's listener.
	// An unresolved receiver child must never be crossed to close the grant parent.
	if receiver != nil {
		o.receiverCloseMu.Lock()
		if !o.receiverClosed {
			if e := receiver.Join(); e != nil {
				o.receiverCloseMu.Unlock()
				return e
			}
			if e := receiver.Close(); e != nil {
				o.receiverCloseMu.Unlock()
				return e
			}
			o.receiverClosed = true
		}
		o.receiverCloseMu.Unlock()
	}
	o.closeOnce.Do(func() {
		o.closeErr = retire
		if o.runtime != nil {
			if e := o.runtime.Close(); o.closeErr == nil {
				o.closeErr = e
			}
		}
	})
	if early != nil {
		return early
	}
	return o.closeErr
}

var _ policy.OriginalTaskGrantVerifier = (*Owner)(nil)

type heldLocalSource struct {
	mu                              sync.Mutex
	owner                           *Owner
	original                        policy.HeldTaskGrantSource
	binding                         policy.TaskEffectBinding
	first                           error
	retired                         bool
	retireOnce, joinOnce, closeOnce sync.Once
	retireErr, joinErr, closeErr    error
}

func (h *heldLocalSource) current(ctx context.Context) error {
	if h == nil || ctx == nil {
		return native.ErrUnavailable
	}
	h.mu.Lock()
	e := h.first
	retired := h.retired
	h.mu.Unlock()
	if e != nil {
		return e
	}
	if retired {
		return native.ErrRetired
	}
	return h.owner.Current(ctx)
}
func (h *heldLocalSource) Snapshot(ctx context.Context) (policy.Snapshot, error) {
	var zero policy.Snapshot
	if e := h.current(ctx); e != nil {
		return zero, e
	}
	s, e := h.original.Snapshot(ctx)
	if e != nil {
		return zero, e
	}
	if !reflect.DeepEqual(s.Grant.Binding, h.binding) {
		return zero, native.ErrProof
	}
	// UNKNOWN is a read-only historical fact, never a fresh local NEW check.
	// Original shared policy also enforces this; do not erase op/reference.
	if s.Effect.State != "NEW" {
		return s, &policy.PolicyError{Code: policy.OriginalOnly, Field: "original effect", OriginalOp: s.Effect.OriginalOp}
	}
	if e = h.current(ctx); e != nil {
		return zero, e
	}
	return s, nil
}
func (h *heldLocalSource) AssertCurrent(ctx context.Context, v policy.SourceVersion) error {
	if e := h.current(ctx); e != nil {
		return e
	}
	if e := h.original.AssertCurrent(ctx, v); e != nil {
		return e
	}
	return h.current(ctx)
}
func (h *heldLocalSource) FenceScope() policy.FenceScope { return policy.EgressOnlyReadFence }
func (h *heldLocalSource) Retire() error {
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
func (h *heldLocalSource) Join() error {
	if h == nil {
		return nil
	}
	h.joinOnce.Do(func() {
		if h.original != nil {
			h.joinErr = h.original.Join()
		}
	})
	return h.joinErr
}
func (h *heldLocalSource) Close() error {
	if h == nil {
		return nil
	}
	h.closeOnce.Do(func() {
		for _, f := range []func() error{h.Retire, h.Join, func() error {
			if h.original != nil {
				return h.original.Close()
			}
			return nil
		}} {
			if e := f(); e != nil && h.closeErr == nil {
				h.closeErr = e
			}
		}
		// Unknown cleanup retains original child custody/debt; never close parent.
		if h.closeErr == nil {
			h.owner.mu.Lock()
			delete(h.owner.children, h)
			h.owner.mu.Unlock()
		}
	})
	return h.closeErr
}
