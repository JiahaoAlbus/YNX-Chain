//go:build darwin || linux

package grantruntime

import (
	"context"
	"sync"
)

// History has a separately registered protected projection and independent
// current window. It never reads the deleted/expired NEW-effect projection.
// Same original proof grammar/math is reused inside, not exposed as a verifier.
const originalHistoryQueryPurpose = "task-grant-history-query-v1"

type queryReleaseSelection struct {
	Purpose   string
	Selection releaseSelection
}

var admittedOriginalGrantQueryReleases = [...]queryReleaseSelection{}

// QueryRuntime is intentionally NOT Runtime and does not implement any effect
// verifier interface. No OpenCheck/ResolveTaskGrant/model permission is exposed.
type QueryRuntime struct {
	mu        sync.Mutex
	inner     *Runtime
	retired   bool
	closeOnce sync.Once
	closeErr  error
}

func OpenOriginalGrantQueryRuntime() (*QueryRuntime, error) {
	if len(admittedOriginalGrantQueryReleases) != 1 {
		return nil, ErrUnavailable
	}
	for _, s := range admittedOriginalGrantQueryReleases {
		return openProtectedQueryRuntime(s)
	}
	return nil, ErrUnavailable
}
func openProtectedQueryRuntime(s queryReleaseSelection) (q *QueryRuntime, err error) {
	if s.Purpose != originalHistoryQueryPurpose {
		return nil, ErrUnavailable
	}
	q = &QueryRuntime{}
	// Preserve actual partial inner owner before inspecting construction error.
	q.inner, err = openProtectedRuntime(s.Selection)
	if err != nil {
		return q, err
	}
	if _, err = q.TaskAuthorityQueryProfile(context.Background()); err != nil {
		return q, err
	}
	return q, nil
}
func (q *QueryRuntime) currentLocked(ctx context.Context) error {
	if q == nil || q.inner == nil || ctx == nil {
		return ErrUnavailable
	}
	if q.retired {
		return ErrRetired
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	_, e := q.inner.TaskAuthorityProfile(ctx) // QUERY file/window, never effect file.
	return e
}
func (q *QueryRuntime) Current(ctx context.Context) error {
	if q == nil {
		return ErrUnavailable
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if e := q.currentLocked(ctx); e != nil {
		return e
	}
	return ctx.Err()
}
func (q *QueryRuntime) TaskAuthorityQueryProfile(ctx context.Context) (TaskAuthorityProfile, error) {
	if q == nil {
		return TaskAuthorityProfile{}, ErrUnavailable
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if e := q.currentLocked(ctx); e != nil {
		return TaskAuthorityProfile{}, e
	}
	p, e := q.inner.TaskAuthorityProfile(ctx)
	if e == nil {
		e = q.currentLocked(ctx)
	}
	if e != nil {
		return TaskAuthorityProfile{}, e
	}
	return p, nil
}
func (q *QueryRuntime) QueryOriginalTaskRequest(ctx context.Context, r OriginalTaskRequest) (OriginalOperationReference, error) {
	if q == nil {
		return OriginalOperationReference{}, ErrUnavailable
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if e := q.currentLocked(ctx); e != nil {
		return OriginalOperationReference{}, e
	}
	out, e := q.inner.QueryOriginalTaskRequest(ctx, r)
	if e == nil {
		e = q.currentLocked(ctx)
	}
	// Original reference on late failure is reconciliation DATA, never a proof.
	return out, e
}
func (q *QueryRuntime) ResolveOriginalTaskQueryMaterial(ctx context.Context, r OriginalTaskRequest) (OriginalTaskQueryMaterial, error) {
	if q == nil {
		return OriginalTaskQueryMaterial{}, ErrUnavailable
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if e := q.currentLocked(ctx); e != nil {
		return OriginalTaskQueryMaterial{}, e
	}
	out, e := q.inner.resolveOriginalTaskQueryMaterial(ctx, r)
	if e == nil {
		e = q.currentLocked(ctx)
	}
	if e != nil {
		return OriginalTaskQueryMaterial{}, e
	}
	return out, nil
}
func (q *QueryRuntime) Retire() error {
	if q == nil {
		return nil
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.retired = true
	if q.inner != nil {
		return q.inner.Retire()
	}
	return nil
}
func (q *QueryRuntime) Join() error {
	if q == nil {
		return nil
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if !q.retired {
		return ErrRetired
	}
	return nil
}
func (q *QueryRuntime) Close() error {
	if q == nil {
		return nil
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.closeOnce.Do(func() {
		q.retired = true
		if q.inner != nil {
			q.closeErr = q.inner.Close()
		}
	})
	return q.closeErr
}
