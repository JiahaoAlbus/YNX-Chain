//go:build darwin || linux

package tasklocalsource

import (
	"context"
	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
)

// Package-private seam only. The public zero-input factory always supplies the
// real concrete native.TaskReadReceiverRuntime; no caller/provider/setter can
// install an implementation. PUBLIC tests exercise partial/drain boundaries.
type receiverRuntime interface {
	Current(context.Context) error
	ReadOriginalTaskReadReceiverRegistration(context.Context) (string, link.LocalCallerServerConfig, error)
	Retire() error
	Join() error
	Close() error
}

func (o *Owner) openOriginalTaskReadReceiver() {
	o.receiver, o.receiverFirst = native.OpenOriginalTaskReadReceiverRuntime()
}
func (o *Owner) beginReceiver(ctx context.Context) (receiverRuntime, error) {
	if o == nil || ctx == nil {
		return nil, native.ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.retired {
		return nil, native.ErrRetired
	}
	if o.receiverFirst != nil {
		return nil, o.receiverFirst
	}
	if o.receiver == nil {
		return nil, native.ErrTaskReadReceiverNotSupplied
	}
	o.calls++
	return o.receiver, nil
}
func (o *Owner) postReceiver(ctx context.Context) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.retired {
		return native.ErrRetired
	}
	return o.receiverFirst
}
func (o *Owner) receiverError(ctx context.Context, e error) error {
	if e == nil {
		return nil
	}
	if ctx.Err() != nil {
		return e
	}
	o.mu.Lock()
	if o.receiverFirst == nil {
		o.receiverFirst = e
	}
	out := o.receiverFirst
	o.mu.Unlock()
	return out
}
func (o *Owner) scopeReceiver(ctx context.Context, r receiverRuntime) error {
	if o.runtime == nil {
		return native.ErrUnavailable
	}
	actual, ok := o.runtime.(*native.Runtime)
	qualified, normal := r.(*native.TaskReadReceiverRuntime)
	if ok {
		if actual == nil || !normal || qualified == nil {
			return native.ErrProof
		}
		return actual.AssertOriginalTaskReadReceiverScope(ctx, qualified)
	}
	return nil
}

// Config is DETACHED registration DATA with a nil Handler, not a Source,
// approval, constructor for an authority or an actual listener. P08 alone
// installs its original handler and calls LINK's one genuine receiver factory.
func (o *Owner) ReadOriginalTaskReadReceiverRegistration(ctx context.Context) (string, link.LocalCallerServerConfig, error) {
	var zero link.LocalCallerServerConfig
	r, e := o.beginReceiver(ctx)
	if e != nil {
		return "", zero, e
	}
	defer o.end()
	if e = r.Current(ctx); e != nil {
		return "", zero, o.receiverError(ctx, e)
	}
	if e = o.scopeReceiver(ctx, r); e != nil {
		return "", zero, o.receiverError(ctx, e)
	}
	socket, cfg, e := r.ReadOriginalTaskReadReceiverRegistration(ctx)
	if e != nil {
		return "", zero, o.receiverError(ctx, e)
	}
	cfg.Routes = append([]link.LocalCallerRoute(nil), cfg.Routes...)
	if cfg.Handler != nil {
		return "", zero, o.receiverError(ctx, native.ErrProof)
	}
	if e = r.Current(ctx); e != nil {
		return "", zero, o.receiverError(ctx, e)
	}
	if e = o.postReceiver(ctx); e != nil {
		return "", zero, e
	}
	return socket, cfg, nil
}
func (o *Owner) AssertOriginalTaskReadReceiverCurrent(ctx context.Context) error {
	r, e := o.beginReceiver(ctx)
	if e != nil {
		return e
	}
	defer o.end()
	if e = r.Current(ctx); e != nil {
		return o.receiverError(ctx, e)
	}
	if e = o.scopeReceiver(ctx, r); e != nil {
		return o.receiverError(ctx, e)
	}
	return o.postReceiver(ctx)
}

var _ interface {
	ReadOriginalTaskReadReceiverRegistration(context.Context) (string, link.LocalCallerServerConfig, error)
	AssertOriginalTaskReadReceiverCurrent(context.Context) error
} = (*Owner)(nil)
