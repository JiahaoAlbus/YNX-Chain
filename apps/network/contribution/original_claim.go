package contribution

import (
	"context"
	"errors"
	"time"

	auth "github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/authresourcesource"
)

// Private ports permit PUBLIC differential tests only. There is no exported
// provider/setter/effect callback; the constructor binds the actual concrete
// original Auth Source and Native Claim.
type originalClaim interface {
	CurrentNoIO() error
	ReadOriginal(context.Context) ([]byte, error)
	Close() (bool, error)
}
type originalSource interface {
	Current(context.Context) error
	ReadOriginalManifest(context.Context) ([]byte, error)
	ReadOriginalConsent(context.Context) ([]byte, error)
	ReadOriginalInput(context.Context) ([]byte, error)
	VerifyManifest(context.Context, string, []byte, []byte) error
	VerifyConsent(context.Context, string, []byte, []byte) error
	claim(context.Context) (originalClaim, error)
	Retire() error
	Join(context.Context) (bool, error)
	Close(context.Context) (bool, error)
}
type nativeOriginalSource struct{ *auth.Source }

func (s nativeOriginalSource) claim(ctx context.Context) (originalClaim, error) {
	c, e := s.Source.ClaimOriginal(ctx)
	if c == nil {
		return nil, e
	}
	return c, e
}

type originalClaimClose struct {
	complete bool
	err      error
}
type originalClaimOwner struct {
	claim   originalClaim
	closing *originalClaimAttempt
}
type originalClaimAttempt struct {
	done   chan struct{}
	result originalClaimClose
}
type originalExecution struct {
	source originalSource
	claims map[string]*originalClaimOwner
}

// NewOriginalSourceRunner acquires no journal/owner/nonce before genuine Source
// Current succeeds. A failed constructor leaves Source/executor custody with
// the caller. Success transfers them to this original Runner; no second store
// or Go runtime is created. Unsupported hard containment stays unsupported.
func NewOriginalSourceRunner(ctx context.Context, path string, source *auth.Source, executor *PinnedWASMExecutor) (*Runner, error) {
	if source == nil {
		return nil, ErrDenied
	}
	if e := source.Current(ctx); e != nil {
		return nil, errors.Join(ErrDenied, e)
	}
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	if executor == nil || executor.linux == nil {
		return nil, ErrUnsupported
	}
	r, e := open(path, nil, false)
	if e != nil {
		return nil, e
	}
	r.executor = executor
	r.original = &originalExecution{source: nativeOriginalSource{source}, claims: map[string]*originalClaimOwner{}}
	return r, nil
}

// Only the original held Claim is closed. A timed-out physical call remains
// owned in this map/channel; it is never replaced by a new once acquisition.
func (r *Runner) drainOriginalClaim(ctx context.Context, job string) (bool, error) {
	r.mu.Lock()
	owner := r.original.claims[job]
	if owner == nil {
		r.mu.Unlock()
		return true, nil
	}
	if owner.closing == nil {
		owner.closing = &originalClaimAttempt{done: make(chan struct{})}
		attempt := owner.closing
		go func() { b, e := owner.claim.Close(); attempt.result = originalClaimClose{b, e}; close(attempt.done) }()
	}
	attempt := owner.closing
	r.mu.Unlock()
	select {
	case <-attempt.done:
		result := attempt.result
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.original.claims[job] == nil && result.complete {
			return true, result.err
		}
		if r.original.claims[job] != owner {
			return false, ErrConflict
		}
		if result.complete {
			delete(r.original.claims, job)
		} else if owner.closing == attempt {
			owner.closing = nil
		}
		if result.err != nil || !result.complete {
			rec := r.data.Jobs[job]
			if rec.Original != nil {
				rec.State = "unknown"
				if rec.Original.CleanupFailure == "" {
					rec.Original.CleanupFailure = "Native claim physical drain pending"
					if result.err != nil {
						rec.Original.CleanupFailure = result.err.Error()
					}
				}
				if rec.Original.FirstCause == "" {
					rec.Original.FirstCause = rec.Original.CleanupFailure
				}
				r.data.Jobs[job] = rec
				if e := r.persist(); e != nil {
					r.sealed = true
					r.persistenceErr = e
					return result.complete, e
				}
			}
		}
		return result.complete, result.err
	case <-ctx.Done():
		r.mu.Lock()
		rec := r.data.Jobs[job]
		if rec.Original != nil {
			rec.State = "unknown"
			if rec.Original.CleanupFailure == "" {
				rec.Original.CleanupFailure = "Native claim physical completion unconfirmed: " + ctx.Err().Error()
			}
			originalFirst(rec.Original, ctx.Err())
			r.data.Jobs[job] = rec
			if e := r.persist(); e != nil {
				r.sealed = true
				r.persistenceErr = e
				r.mu.Unlock()
				return false, e
			}
		}
		r.mu.Unlock()
		return false, ctx.Err()
	}
}
func (r *Runner) drainOriginalClaims(ctx context.Context) error {
	for {
		r.mu.Lock()
		jobs := make([]string, 0, len(r.original.claims))
		for job := range r.original.claims {
			jobs = append(jobs, job)
		}
		r.mu.Unlock()
		if len(jobs) == 0 {
			return nil
		}
		for _, job := range jobs {
			done, e := r.drainOriginalClaim(ctx, job)
			if e != nil {
				return e
			}
			if !done {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(20 * time.Millisecond):
				}
			}
		}
	}
}

// The successful run already recomputed and committed this exact one receipt
// under its live Native final fence. This method is read-only; cold historical
// snapshots cannot be promoted or recounted, and no once claim is reacquired.
func (r *Runner) readOriginalVerified(ctx context.Context, job string, candidate Result, input []byte) (Receipt, error) {
	if e := r.original.source.Current(ctx); e != nil {
		return Receipt{}, errors.Join(ErrDenied, e)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	rec, ok := r.data.Jobs[job]
	until, live := r.authorizedJobs[job]
	if !ok || rec.Original == nil || rec.State != "verified" || !validOriginalReceipt(rec) || candidate != rec.Result || !live || !time.Now().Before(until) {
		return Receipt{}, ErrDenied
	}
	if r.closed || r.sealed {
		return Receipt{}, ErrStopped
	}
	if len(input) > HistogramMaxInputBytes || Bind(input) != rec.Work.Input {
		return Receipt{}, ErrInvalid
	}
	return *rec.Receipt, nil
}
