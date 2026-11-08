package aiproduct

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

// Private normal composition contract, NOT a request/provider interface.
// Only the SAME installed original Auth local owner can supply this. Config is
// detached registration DATA; neither it nor the socket authorizes a resource.
// Auth owns the protected producer body; P08 never manufactures its selection.
type originalTaskReadReceiverRegistration interface {
	ReadOriginalTaskReadReceiverRegistration(context.Context) (string, link.LocalCallerServerConfig, error)
	AssertOriginalTaskReadReceiverCurrent(context.Context) error
}

type OriginalTaskReadReceiver struct {
	mu                    sync.Mutex
	resource              *OriginalTaskReadResource
	registration          originalTaskReadReceiverRegistration // borrowed original owner
	server                *link.LocalCallerServer
	listener              net.Listener
	started, retired      bool
	done                  chan struct{}
	newEffectsUnavailable error
	serveError            error
	acquireError          error
	retireOnce            sync.Once
	retireError           error
}

// Normal app entry: no caller path/UID/PID/profile/provider/handler argument.
// A nonnil partial always remains owned, even when registration is unavailable.
func OpenOriginalTaskReadReceiver(ctx context.Context, server *Server) (result *OriginalTaskReadReceiver, resultErr error) {
	o := &OriginalTaskReadReceiver{done: make(chan struct{})}
	defer func() {
		o.mu.Lock()
		o.acquireError = resultErr
		o.mu.Unlock()
	}()
	if server != nil {
		if effects, ok := server.toolEffects.(*originalRuntimeToolEffects); ok {
			effects.receiverMu.Lock()
			if effects.receiver != nil {
				effects.receiverMu.Unlock()
				return o, errToolConflict // never replace a borrower/its cleanup debt
			}
			effects.receiver = o
			effects.receiverMu.Unlock()
		}
	}
	resource, err := OpenOriginalTaskReadResource(ctx, server)
	o.resource = resource
	if err != nil {
		if resource == nil || resource.queryCurrent == nil {
			return o, err
		}
		if queryErr := resource.queryCurrent(ctx); queryErr != nil {
			return o, errors.Join(err, queryErr)
		}
		o.newEffectsUnavailable = err // independent history may remain queryable
	}
	effects, ok := server.toolEffects.(*originalRuntimeToolEffects)
	if !ok || effects.runtime == nil {
		return o, errTaskEffectSourceUnavailable
	}
	authority, ok := effects.runtime.authority.(*nativeTaskRuntimeAuthority)
	if !ok || authority.localOwner == nil {
		return o, errTaskEffectSourceUnavailable
	}
	source, ok := any(authority.localOwner).(originalTaskReadReceiverRegistration)
	if !ok || missingTaskRuntimeOperand(source) {
		return o, errTaskEffectSourceUnavailable
	}
	return openOriginalTaskReadReceiver(ctx, o, source)
}

func (o *OriginalTaskReadReceiver) currentForExecution(ctx context.Context, store *Store, source originalTaskReadReceiverRegistration) error {
	if ctx == nil || ctx.Err() != nil {
		if ctx != nil {
			return ctx.Err()
		}
		return errTaskEffectSourceUnavailable
	}
	o.mu.Lock()
	if !o.started || o.retired {
		cause := o.acquireError
		o.mu.Unlock()
		return errors.Join(errTaskEffectSourceUnavailable, cause)
	}
	select {
	case <-o.done:
		cause := o.serveError
		o.mu.Unlock()
		return errors.Join(errTaskEffectSourceUnavailable, cause)
	default:
	}
	// All remaining fields were initialized before started was published.
	resource, registration := o.resource, o.registration
	unavailable := o.newEffectsUnavailable
	valid := o.server != nil && o.listener != nil && resource != nil && resource.store == store && registration == source
	o.mu.Unlock()
	if !valid || unavailable != nil {
		return errors.Join(errTaskEffectSourceUnavailable, unavailable)
	}
	if err := registration.AssertOriginalTaskReadReceiverCurrent(ctx); err != nil {
		return err
	}
	if err := resource.Current(ctx); err != nil {
		return err
	}
	o.mu.Lock()
	retired := o.retired
	select {
	case <-o.done:
		retired = true
	default:
	}
	o.mu.Unlock()
	if retired {
		return errTaskEffectSourceUnavailable
	}
	return ctx.Err()
}

// Unexported implementation permits PUBLIC transport/lifetime controls. It is
// never installed through JSON, ENV, CLI or an exported testing constructor.
func openOriginalTaskReadReceiver(ctx context.Context, o *OriginalTaskReadReceiver, source originalTaskReadReceiverRegistration) (*OriginalTaskReadReceiver, error) {
	o.registration = source
	if ctx == nil || o.resource == nil || missingTaskRuntimeOperand(source) {
		return o, errTaskEffectSourceUnavailable
	}
	if err := source.AssertOriginalTaskReadReceiverCurrent(ctx); err != nil {
		return o, err
	}
	socket, cfg, err := source.ReadOriginalTaskReadReceiverRegistration(ctx)
	if err != nil {
		return o, err
	}
	cfg.Routes = append([]link.LocalCallerRoute(nil), cfg.Routes...)
	if cfg.Service != OriginalTaskReadResourceService || cfg.Handler != nil || len(cfg.Routes) != 3 {
		return o, link.ErrDenied
	}
	paths := map[string]bool{OriginalTaskReadInputPath: false, OriginalTaskReadExecutePath: false, OriginalTaskReadQueryPath: false}
	for _, r := range cfg.Routes {
		seen, exists := paths[r.Path]
		if !exists || seen || r.Method != "POST" || r.MaxBodyBytes < 1 || r.MaxBodyBytes > 1<<20 {
			return o, link.ErrDenied
		}
		paths[r.Path] = true
	}
	if err = source.AssertOriginalTaskReadReceiverCurrent(ctx); err != nil {
		return o, err
	}
	handler := o.resource.Handler()
	cfg.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := source.AssertOriginalTaskReadReceiverCurrent(r.Context()); err != nil {
			http.Error(w, "original resource registration unavailable", http.StatusServiceUnavailable)
			return
		}
		handler.ServeHTTP(w, r) // genuine original request; never clone/rewrite it
	})
	o.server, err = link.NewOriginalTaskReadContinuationServer(cfg)
	if err != nil {
		return o, err
	}
	o.listener, err = link.ListenPrivate(socket, cfg.PeerUID)
	if err != nil {
		return o, err
	}
	if err = source.AssertOriginalTaskReadReceiverCurrent(ctx); err != nil {
		return o, err
	}
	o.mu.Lock()
	o.started = true
	o.mu.Unlock()
	go func() {
		err := o.server.Serve(o.listener)
		o.mu.Lock()
		if errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed) || (o.retired && errors.Is(err, link.ErrDenied)) {
			err = nil
		}
		o.serveError = err
		o.mu.Unlock()
		close(o.done)
	}()
	return o, nil
}

// Diagnostic only; never authorizes either queries or effects.
func (o *OriginalTaskReadReceiver) NewEffectsUnavailable() error {
	if o == nil {
		return errTaskEffectSourceUnavailable
	}
	return o.newEffectsUnavailable
}

func (o *OriginalTaskReadReceiver) Retire() error {
	if o == nil {
		return nil
	}
	o.retireOnce.Do(func() {
		o.mu.Lock()
		o.retired = true
		o.mu.Unlock()
		if o.resource != nil {
			o.resource.Retire()
		}
		if o.server != nil {
			o.retireError = errors.Join(o.retireError, o.server.Retire())
		}
		if o.listener != nil {
			if err := o.listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
				o.retireError = errors.Join(o.retireError, err)
			}
		}
	})
	return o.retireError
}
func (o *OriginalTaskReadReceiver) Join(ctx context.Context) error {
	if o == nil {
		return nil
	}
	if ctx == nil {
		return errTaskEffectSourceUnavailable
	}
	o.mu.Lock()
	retired, started := o.retired, o.started
	o.mu.Unlock()
	if !retired {
		return errTaskCallerNotRetired
	}
	if o.server != nil {
		if err := o.server.Join(ctx); err != nil {
			return err
		}
	}
	if started {
		select {
		case <-o.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	o.mu.Lock()
	err := o.serveError
	o.mu.Unlock()
	return errors.Join(o.retireError, err)
}
func (o *OriginalTaskReadReceiver) Close() error {
	if o == nil {
		return nil
	}
	err := o.Retire()
	if o.server != nil {
		if cause := o.server.Close(); cause != nil {
			return errors.Join(err, cause)
		}
	}
	o.mu.Lock()
	started := o.started
	serveError := o.serveError
	o.mu.Unlock()
	if started {
		select {
		case <-o.done:
		default:
			return errors.Join(err, link.ErrLocalCallerDraining)
		}
	}
	if o.resource != nil {
		err = errors.Join(err, o.resource.Close())
	}
	// Borrowed registration/Source/Store are never closed, unlinked or re-created.
	return errors.Join(err, serveError)
}
