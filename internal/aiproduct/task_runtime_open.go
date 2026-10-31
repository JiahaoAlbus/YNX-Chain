package aiproduct

import (
	"context"
	"errors"
	"sync"

	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
)

// OpenOriginalTaskRuntime is the normal production composition: both original
// zero-input factories, the original fixed-model Service, then the original
// reservation/effect/receipt client. No caller may install Source credentials,
// a service profile or a replacement authority through this entry point.
// Always adopt a nonnil returned owner before examining err.
func OpenOriginalTaskRuntime(ctx context.Context, cfg TaskModelConfig) (*PreparedOriginalTaskRuntime, error) {
	p := &PreparedOriginalTaskRuntime{owners: &originalTaskRuntimeOwners{}}
	if ctx == nil {
		return p, errTaskEffectSourceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return p, err
	}
	authority, effectErr := OpenOriginalTaskAuthority()
	if authority == nil {
		authority = &nativeTaskRuntimeAuthority{}
	}
	p.owners.native = authority
	queryOwner, queryErr := native.OpenOriginalGrantQueryRuntime()
	authority.queryOwner = queryOwner
	client, clientErr := originalclient.OpenOriginalTaskAuthorityClient()
	p.owners.client = client
	if queryErr != nil || clientErr != nil {
		return p, errors.Join(effectErr, queryErr, clientErr)
	}
	if client == nil || queryOwner == nil {
		return p, errors.Join(effectErr, errTaskEffectSourceUnavailable)
	}
	authBroker, brokerErr := originalclient.OpenOriginalTaskAuthorityBroker(ctx, client)
	p.owners.authBroker = authBroker
	if brokerErr != nil {
		return p, errors.Join(effectErr, brokerErr)
	}
	if authBroker == nil {
		return p, errors.Join(effectErr, errTaskEffectSourceUnavailable)
	}
	registration, registrationErr := authBroker.ReadRegistration(ctx)
	if registrationErr != nil {
		return p, errors.Join(effectErr, registrationErr)
	}
	localRegistration, effectAvailable, registrationErr := taskCallerRegistration(registration)
	if registrationErr != nil {
		return p, errors.Join(effectErr, registrationErr)
	}
	typedBroker := &originalTaskCallerTypedBroker{owner: authBroker}
	endpoint, endpointErr := openTaskCallerEndpoint(ctx, localRegistration, typedBroker)
	p.owners.endpoint = endpoint
	if endpointErr != nil {
		return p, errors.Join(effectErr, endpointErr)
	}
	ipcClient := &taskIPCBrokerClient{client: client, broker: typedBroker, endpoint: endpoint, effectAvailable: effectAvailable}
	callOwner, callErr := newTaskCallerLifetime(ipcClient)
	p.owners.calls = callOwner
	if callErr != nil {
		return p, errors.Join(effectErr, callErr)
	}
	p.authority, p.broker = authority, &originalTaskAuthorityBroker{client: callOwner}
	if err := p.queryCurrent(ctx); err != nil {
		return p, errors.Join(effectErr, err)
	}
	if effectErr == nil {
		effectErr = authority.Current(ctx)
	}
	if effectErr != nil {
		// Restart can reconcile the independently admitted original history
		// even after the NEW-effect file has expired or been removed.
		p.recoveryOnly = effectErr
		return p, nil
	}
	model, modelErr := NewTaskModelService(cfg)
	if modelErr != nil {
		p.recoveryOnly = modelErr
		return p, nil
	}
	p.model = model
	if err := p.current(ctx); err != nil {
		if queryErr := p.queryCurrent(ctx); queryErr != nil {
			return p, errors.Join(err, queryErr)
		}
		p.recoveryOnly, p.model = err, nil
	}
	return p, nil
}

// NewEffectsUnavailable distinguishes recovery-only custody from permission to
// run a new model/tool effect. It is diagnostic data, never an authority flag.
func (p *PreparedOriginalTaskRuntime) NewEffectsUnavailable() error {
	if p == nil {
		return errTaskEffectSourceUnavailable
	}
	return p.recoveryOnly
}

type originalTaskRuntimeOwners struct {
	native     *nativeTaskRuntimeAuthority
	client     *originalclient.TaskAuthorityClient
	calls      *taskCallerLifetime
	authBroker *originalclient.OriginalTaskAuthorityBroker
	endpoint   *taskCallerEndpoint
	once       sync.Once
	err        error
}

// Close follows HTTP request draining in the normal app. Original client Close
// retires its Source, interrupts owned transport, joins admitted work and then
// releases custody. Even a partial acquisition is closed exactly once.
func (p *PreparedOriginalTaskRuntime) Close() error {
	if p == nil || p.owners == nil {
		return nil
	}
	o := p.owners
	o.once.Do(func() {
		if o.calls != nil {
			o.err = errors.Join(o.err, o.calls.Retire())
		}
		if o.endpoint != nil {
			o.err = errors.Join(o.err, o.endpoint.Retire())
		}
		if o.authBroker != nil {
			o.err = errors.Join(o.err, o.authBroker.Retire())
		}
		if o.calls != nil {
			// The original IPC client has no persistent fd/Close method: each
			// Call owns its connection. Drain actual calls before Source owners.
			o.err = errors.Join(o.err, o.calls.Join(context.Background()))
		}
		if o.endpoint != nil {
			o.err = errors.Join(o.err, o.endpoint.Join(context.Background()))
		}
		if o.authBroker != nil {
			o.err = errors.Join(o.err, o.authBroker.Close())
		}
		if o.native != nil {
			o.err = errors.Join(o.err, o.native.Retire())
		}
		if o.client != nil {
			o.err = errors.Join(o.err, o.client.Close())
		}
		if o.native != nil {
			o.err = errors.Join(o.err, o.native.Close())
		}
	})
	return o.err
}
