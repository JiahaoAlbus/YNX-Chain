package originalclient

import (
	"bytes"
	"context"
	"errors"
	runtime "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	"sync"
)

// Concrete original Runtime/independent QueryRuntime adapter. No new policy,
// crypto verifier or request Source is installed by this private composition.
type originalCallerRuntimes interface {
	AssertCall(context.Context, authorityCallerDocument, TaskAuthorityCall) error
	Retire() error
	Join() error
	Close() error
}
type normalCallerRuntimes struct {
	mu                               sync.Mutex
	retired                          bool
	actions                          map[string]bool
	effectOnce, queryOnce, closeOnce sync.Once
	effectErr, queryErr, closeErr    error
	openEffect                       func() (*runtime.Runtime, error)
	openQuery                        func() (*runtime.QueryRuntime, error)
	effect                           *runtime.Runtime
	query                            *runtime.QueryRuntime
}

func openNormalCallerRuntimes(actions []string) (originalCallerRuntimes, error) {
	p := &normalCallerRuntimes{actions: map[string]bool{}, openEffect: runtime.OpenOriginalGrantRuntime, openQuery: runtime.OpenOriginalGrantQueryRuntime}
	for _, a := range actions {
		switch a {
		case "effect":
		case "query":
		default:
			return p, ErrUnavailable
		}
		if p.actions[a] {
			return p, ErrUnavailable
		}
		p.actions[a] = true
	}
	if len(p.actions) == 0 {
		return p, ErrUnavailable
	}
	return p, nil
}
func (r *normalCallerRuntimes) allowed(action string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.retired {
		return ErrSourceRetired
	}
	if !r.actions[action] {
		return ErrUnavailable
	}
	return nil
}
func (r *normalCallerRuntimes) acquireQuery() error {
	if e := r.allowed("query"); e != nil {
		return e
	}
	r.queryOnce.Do(func() {
		q, e := r.openQuery()
		r.mu.Lock()
		r.query = q
		r.queryErr = e
		retired := r.retired
		r.mu.Unlock()
		if retired && q != nil {
			_ = q.Retire()
		}
	})
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.retired {
		return ErrSourceRetired
	}
	return r.queryErr
}
func (r *normalCallerRuntimes) acquireEffect() error {
	if e := r.allowed("effect"); e != nil {
		return e
	}
	r.effectOnce.Do(func() {
		q, e := r.openEffect()
		r.mu.Lock()
		r.effect = q
		r.effectErr = e
		retired := r.retired
		r.mu.Unlock()
		if retired && q != nil {
			_ = q.Retire()
		}
	})
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.retired {
		return ErrSourceRetired
	}
	return r.effectErr
}
func (r *normalCallerRuntimes) AssertCall(ctx context.Context, d authorityCallerDocument, call TaskAuthorityCall) error {
	sameProof := func(a, b []byte) bool { return bytes.Equal(a, b) }
	if call.OriginalOperation != "" {
		if e := r.acquireQuery(); e != nil {
			return e
		}
		if r.query == nil {
			return ErrUnavailable
		}
		p, e := r.query.TaskAuthorityQueryProfile(ctx)
		if e != nil {
			return e
		}
		if p.Realm != d.Realm || p.Tenant != d.Tenant || p.Authority != d.Authority {
			return ErrBinding
		}
		m, e := r.query.ResolveOriginalTaskQueryMaterial(ctx, d.Request)
		if e != nil {
			return e
		}
		if m.CurrentGrantRef != call.GrantRef || m.OriginalOperationID != call.OriginalOperation || m.Grant.Purpose != call.Grant.Purpose || m.Holder.Purpose != call.Holder.Purpose || !sameProof(m.Grant.Payload, call.Grant.Payload) || !sameProof(m.Grant.Wire, call.Grant.Wire) || !sameProof(m.Holder.Payload, call.Holder.Payload) || !sameProof(m.Holder.Wire, call.Holder.Wire) {
			return ErrBinding
		}
		return r.allowed("query")
	}
	if e := r.acquireEffect(); e != nil {
		return e
	}
	if r.effect == nil {
		return ErrUnavailable
	}
	p, e := r.effect.TaskAuthorityProfile(ctx)
	if e != nil {
		return e
	}
	if p.Realm != d.Realm || p.Tenant != d.Tenant || p.Authority != d.Authority {
		return ErrBinding
	}
	a, e := r.effect.ResolveTaskGrant(ctx, d.Request)
	if e != nil {
		return e
	}
	if a.Grant.Purpose != call.Grant.Purpose || a.Holder.Purpose != call.Holder.Purpose || !sameProof(a.Grant.Payload, call.Grant.Payload) || !sameProof(a.Grant.Wire, call.Grant.Wire) || !sameProof(a.Holder.Payload, call.Holder.Payload) || !sameProof(a.Holder.Wire, call.Holder.Wire) {
		return ErrBinding
	}
	return r.allowed("effect")
}
func (r *normalCallerRuntimes) Retire() error {
	r.mu.Lock()
	r.retired = true
	effect, query := r.effect, r.query
	r.mu.Unlock()
	var e error
	if effect != nil {
		e = errors.Join(e, effect.Retire())
	}
	if query != nil {
		e = errors.Join(e, query.Retire())
	}
	return e
}
func (r *normalCallerRuntimes) Join() error {
	r.mu.Lock()
	q := r.query
	r.mu.Unlock()
	if q != nil {
		return q.Join()
	}
	return nil
}
func (r *normalCallerRuntimes) Close() error {
	r.closeOnce.Do(func() {
		r.closeErr = r.Retire()
		r.mu.Lock()
		e, q := r.effect, r.query
		r.mu.Unlock()
		if e != nil {
			r.closeErr = errors.Join(r.closeErr, e.Close())
		}
		if q != nil {
			r.closeErr = errors.Join(r.closeErr, q.Close())
		}
	})
	return r.closeErr
}
