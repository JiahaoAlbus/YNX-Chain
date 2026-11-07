package securelink

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"unsafe"
)

var ErrNativeLocalCallerTransferUnknown = errors.New("native startup borrow transfer outcome UNKNOWN")

type nativeStartupTransferPanic struct{ cause any }

func (nativeStartupTransferPanic) Error() string { return ErrNativeLocalCallerTransferUnknown.Error() }
func (e nativeStartupTransferPanic) Unwrap() []error {
	out := []error{ErrNativeLocalCallerTransferUnknown}
	if cause, ok := e.cause.(error); ok {
		out = append(out, cause)
	}
	return out
}

// NativeLocalCallerStartupOwner owns the actual client -> registration ->
// registration borrow startup sequence in ONE Go runtime. Config is private
// normal Go startup DATA, never a C/JS destination installer or qualification.
// The native Root/profile getter and Auth's actual Source constructor remain
// independent owning code. This owner never closes a borrowed parent or socket.
type NativeLocalCallerStartupOwner struct {
	ctx                                                             context.Context
	cancel                                                          context.CancelFunc
	mu                                                              sync.Mutex
	registration                                                    *NativeLocalCallerRegistration
	borrow                                                          unsafe.Pointer
	ready, retired, joined, closed                                  bool
	registrationJoining                                             bool
	transferStarted, transferInFlight, transferred, transferUnknown bool
	releaseStarted, releaseInFlight                                 bool
	first, cleanupFirst                                             error
	retireDone                                                      chan struct{}
	changed                                                         chan struct{}
}

// OpenNativeLocalCallerStartup performs real NewLocalCallerClient, Register,
// Borrow in that order. Adopt a nonnull owner BEFORE examining err: a later
// opening error never abandons an original registration/borrow. No dial,
// signing, Source admission, native constructor or retry occurs here.
func OpenNativeLocalCallerStartup(ctx context.Context, cfg LocalCallerClientConfig, bindings [5]NativeLocalCallerBinding) (owner *NativeLocalCallerStartupOwner, err error) {
	if ctx == nil {
		return nil, ErrDenied
	}
	v := reflect.ValueOf(ctx)
	if (v.Kind() == reflect.Pointer || v.Kind() == reflect.Interface) && v.IsNil() {
		return nil, ErrDenied
	}
	child, cancel := context.WithCancel(ctx)
	o := &NativeLocalCallerStartupOwner{ctx: child, cancel: cancel, retireDone: make(chan struct{}), changed: make(chan struct{})}
	defer func() {
		if err != nil {
			o.remember(err)
		}
		// Install only after every constructed partial has been adopted by o.
		context.AfterFunc(child, func() { _ = o.Retire() })
	}()
	if child.Err() != nil {
		return o, context.Cause(child)
	}
	client, err := NewLocalCallerClient(cfg)
	if err != nil {
		return o, err
	}
	o.registration, err = RegisterNativeLocalCallerClient(child, client, bindings)
	if err != nil {
		return o, err
	}
	o.borrow, err = o.registration.BorrowNativeRegistrationPointer()
	if err != nil {
		return o, err
	}
	if child.Err() != nil {
		return o, context.Cause(child)
	}
	o.ready = true
	return o, nil
}

func (o *NativeLocalCallerStartupOwner) remember(err error) {
	if err == nil {
		return
	}
	o.mu.Lock()
	if o.first == nil {
		o.first = err
	}
	o.mu.Unlock()
}
func (o *NativeLocalCallerStartupOwner) notify() {
	o.mu.Lock()
	close(o.changed)
	o.changed = make(chan struct{})
	o.mu.Unlock()
}

// FirstCause is diagnostics only; neither an error nor its absence is Source
// qualification. Physical drain and the original opening/constructor error are
// independent: successfully draining a partial does not erase this cause.
func (o *NativeLocalCallerStartupOwner) FirstCause() error {
	if o == nil {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.first
}

// TransferBorrowToNativeSource is ONLY for the original normal Go/native
// startup bridge, outside all Store/owner/registration locks. adopt must call
// the exact original Auth constructor, never JS or a selectable provider.
//
// A nonnull returned native output adopts this ONE borrow, even with err; the
// caller must preserve that Source partial first. LINK cannot drop it afterward.
// Null output explicitly means the constructor did NOT adopt the borrow. A
// panic has UNKNOWN custody, retains the original debt, and cannot be retried.
// The output pointer is custody DATA only; LINK does not recognize its type or
// classify it as Root/Source/permission. The normal native ABI is not defined here.
func (o *NativeLocalCallerStartupOwner) TransferBorrowToNativeSource(adopt func(unsafe.Pointer) (unsafe.Pointer, error)) (out unsafe.Pointer, err error) {
	defer func() {
		if o != nil && err != nil {
			o.remember(err)
		}
	}()
	if o == nil || adopt == nil {
		return nil, ErrDenied
	}
	o.mu.Lock()
	if !o.ready || o.retired || o.transferStarted || o.borrow == nil || o.ctx.Err() != nil {
		o.mu.Unlock()
		return nil, ErrDenied
	}
	o.transferStarted = true
	o.transferInFlight = true
	borrow := o.borrow
	o.mu.Unlock()
	unknown := false
	entered, returned := false, false
	defer func() {
		if cause := recover(); cause != nil {
			unknown = true
			out = nil
			err = nativeStartupTransferPanic{cause: cause}
		}
		if entered && !returned && !unknown {
			unknown = true
			err = nativeStartupTransferPanic{}
		}
		if out == nil && err == nil {
			err = ErrUnavailable
		}
		o.mu.Lock()
		o.transferInFlight = false
		if unknown {
			o.transferUnknown = true
		} else if out != nil {
			o.transferred = true
			o.borrow = nil
		}
		if err != nil && o.first == nil {
			o.first = err
		}
		retired := o.retired
		o.mu.Unlock()
		o.notify()
		if retired && !unknown {
			_ = o.releaseOwnedBorrow()
		}
	}()
	// This is a local transport lifetime check, not a Root/Source callback.
	if err = nativeLocalCallerStartupBorrowCurrent(borrow); err != nil {
		return nil, err
	}
	entered = true
	out, err = adopt(borrow)
	returned = true
	return out, err
}

func (o *NativeLocalCallerStartupOwner) releaseOwnedBorrow() error {
	o.mu.Lock()
	if o.transferUnknown {
		o.mu.Unlock()
		return ErrNativeLocalCallerTransferUnknown
	}
	if o.transferInFlight {
		o.mu.Unlock()
		return nil
	}
	if o.releaseStarted || o.borrow == nil {
		err := o.cleanupFirst
		o.mu.Unlock()
		return err
	}
	o.releaseStarted = true
	o.releaseInFlight = true
	borrow := o.borrow
	o.mu.Unlock()
	err := nativeLocalCallerStartupReleaseBorrow(borrow)
	o.mu.Lock()
	o.releaseInFlight = false
	if err == nil {
		o.borrow = nil
	} else {
		if o.cleanupFirst == nil {
			o.cleanupFirst = err
		}
		if o.first == nil {
			o.first = err
		}
	}
	o.mu.Unlock()
	o.notify()
	return err
}

// Retire invalidates the original registration/contexts immediately. It never
// waits for a constructor or steals a borrow already adopted by its output.
func (o *NativeLocalCallerStartupOwner) Retire() error {
	if o == nil || o.retireDone == nil {
		return ErrDenied
	}
	o.mu.Lock()
	if o.retired {
		err := o.cleanupFirst
		o.mu.Unlock()
		return err
	}
	o.retired = true
	registration := o.registration
	o.mu.Unlock()
	defer func() { close(o.retireDone); o.notify() }()
	o.cancel()
	if registration != nil {
		_ = registration.Retire()
	}
	return o.releaseOwnedBorrow()
}

// Join is cleanup ONLY. Its context cannot extend the original qualified
// operation. It waits for the constructor, then for actual native Source drop
// and all original children; cancellation/deadline never means drained.
func (o *NativeLocalCallerStartupOwner) Join(ctx context.Context) (err error) {
	defer func() {
		if o != nil && err != nil {
			o.remember(err)
		}
	}()
	if o == nil || ctx == nil || o.retireDone == nil {
		return ErrDenied
	}
	o.mu.Lock()
	retired := o.retired
	o.mu.Unlock()
	if !retired {
		return ErrDenied
	}
	select {
	case <-o.retireDone:
	case <-ctx.Done():
		return ctx.Err()
	}
	for {
		o.mu.Lock()
		inflight, unknown, cleanup := o.transferInFlight || o.releaseInFlight, o.transferUnknown, o.cleanupFirst
		registration := o.registration
		changed := o.changed
		o.mu.Unlock()
		if unknown {
			return ErrNativeLocalCallerTransferUnknown
		}
		if cleanup != nil {
			return cleanup
		}
		if !inflight {
			if err := o.releaseOwnedBorrow(); err != nil {
				return err
			}
			o.mu.Lock()
			releasing := o.releaseInFlight
			o.mu.Unlock()
			if releasing {
				continue
			}
			// The original registration has one notification consumer. Keep one
			// context-bounded physical Join leader here; followers wait on this
			// owner's broadcast. A timed-out leader releases the role without
			// retaining a mutex or preventing a live follower from taking over.
			o.mu.Lock()
			if o.joined {
				o.mu.Unlock()
				return nil
			}
			if o.registrationJoining {
				changed := o.changed
				o.mu.Unlock()
				select {
				case <-changed:
				case <-ctx.Done():
					return ctx.Err()
				}
				continue
			}
			o.registrationJoining = true
			o.mu.Unlock()
			o.notify()
			var joinErr error
			if registration != nil {
				joinErr = registration.Join(ctx)
			}
			o.mu.Lock()
			o.registrationJoining = false
			if joinErr == nil {
				o.joined = true
			}
			o.mu.Unlock()
			o.notify()
			return joinErr
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (o *NativeLocalCallerStartupOwner) Close() (err error) {
	defer func() {
		if o != nil && err != nil {
			o.remember(err)
		}
	}()
	if o == nil || o.retireDone == nil {
		return ErrDenied
	}
	_ = o.Retire()
	select {
	case <-o.retireDone:
	default:
		return ErrLocalCallerDraining
	}
	o.mu.Lock()
	if o.transferUnknown {
		o.mu.Unlock()
		return ErrNativeLocalCallerTransferUnknown
	}
	if o.cleanupFirst != nil {
		err := o.cleanupFirst
		o.mu.Unlock()
		return err
	}
	if o.closed {
		o.mu.Unlock()
		return nil
	}
	if !o.joined || o.transferInFlight {
		o.mu.Unlock()
		return ErrLocalCallerDraining
	}
	registration := o.registration
	o.mu.Unlock()
	if registration != nil {
		if err := registration.Close(); err != nil {
			return err
		}
	}
	o.mu.Lock()
	o.closed = true
	o.mu.Unlock()
	return nil
}
