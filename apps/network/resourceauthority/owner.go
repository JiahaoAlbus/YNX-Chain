// Package resourceauthority owns one original Auth Source for the helper's
// lifetime. Readiness is observation only; this package dispatches no work.
package resourceauthority

import (
	"context"
	"errors"
	"regexp"
	"sync"

	auth "github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/authresourcesource"
)

type source interface {
	Current(context.Context) error
	Retire() error
	Join(context.Context) (bool, error)
	Close(context.Context) (bool, error)
}

type Status struct {
	Code              string `json:"code"`
	NativeLinked      bool   `json:"nativeLinked"`
	Current           bool   `json:"current"`
	PartialAcquired   bool   `json:"partialAcquired"`
	CleanupPending    bool   `json:"cleanupPending"`
	PhysicalComplete  bool   `json:"physicalComplete"`
	FirstCauseCode    string `json:"firstCauseCode,omitempty"`
	ProductionEnabled bool   `json:"productionEnabled"`
}

type Owner struct {
	mu      sync.Mutex
	drain   chan struct{}
	source  source
	status  Status
	first   error
	retired bool
	closed  bool
}

var nativeCode = regexp.MustCompile(`^NETWORK_RESOURCE_NATIVE(_CLAIM)?_[0-9]{1,10}$`)

func causeCode(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, auth.ErrNotSupplied):
		return "NOT_SUPPLIED"
	case errors.Is(err, auth.ErrRetired):
		return "RETIRED"
	case errors.Is(err, context.Canceled):
		return "CANCELED"
	case errors.Is(err, context.DeadlineExceeded):
		return "DEADLINE"
	case nativeCode.MatchString(err.Error()):
		return err.Error()
	default:
		return "SOURCE_ERROR"
	}
}

func Open(ctx context.Context) *Owner {
	s, err := auth.Open(ctx)
	// Avoid a nonnil interface containing a nil *Source.
	if s == nil {
		return adopt(ctx, nil, err, auth.NativeLinked())
	}
	return adopt(ctx, s, err, auth.NativeLinked())
}

// Private adoption is not a provider API. Normal Open above always acquires
// the original fixed Native callee, including its nonnull error partial.
func adopt(ctx context.Context, s source, err error, linked bool) *Owner {
	o := &Owner{source: s, drain: make(chan struct{}, 1), first: err}
	o.status = Status{Code: "NOT_SUPPLIED", NativeLinked: linked, PhysicalComplete: s == nil, FirstCauseCode: causeCode(err)}
	if s != nil {
		o.status.Code = "CURRENT"
		o.status.Current = err == nil
		o.status.PartialAcquired = err != nil
		if err != nil {
			o.status.Code = "NOT_ADMITTED"
			_, _ = o.Close(ctx) // Retain this same owner if physical drain is pending.
		}
	}
	return o
}

func (o *Owner) Snapshot() Status {
	if o == nil {
		return Status{Code: "NOT_SUPPLIED", PhysicalComplete: true}
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.status
}

func (o *Owner) firstError(err error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.first == nil && err != nil {
		o.first = err
		o.status.FirstCauseCode = causeCode(err)
	}
}

// Observe rechecks the live Source without reading protected originals,
// signing, claiming a nonce or touching the Runner journal.
func (o *Owner) Observe(ctx context.Context) Status {
	if o == nil {
		return o.Snapshot()
	}
	o.mu.Lock()
	s, live := o.source, !o.retired && o.status.Current
	o.mu.Unlock()
	if live {
		if err := s.Current(ctx); err != nil {
			o.firstError(err)
			o.mu.Lock()
			o.status.Current = false
			if !o.retired {
				o.status.Code = "NOT_ADMITTED"
			}
			o.mu.Unlock()
			_, _ = o.Close(ctx)
		}
	}
	return o.Snapshot()
}

// Close separates physical completion from the first acquisition/current
// failure. Pending/canceled drain keeps the same Source; it never calls Open.
func (o *Owner) Close(ctx context.Context) (bool, error) {
	if o == nil {
		return true, nil
	}
	o.mu.Lock()
	s := o.source
	o.retired = true
	o.status.Current = false
	if o.closed || s == nil {
		o.status.PhysicalComplete = true
		o.mu.Unlock()
		return true, nil
	}
	if o.status.Code == "CURRENT" {
		o.status.Code = "RETIRED"
	}
	o.status.CleanupPending = true
	o.mu.Unlock()
	retireErr := s.Retire()
	o.firstError(retireErr)
	select {
	case o.drain <- struct{}{}:
		defer func() { <-o.drain }()
	case <-ctx.Done():
		o.firstError(ctx.Err())
		return false, errors.Join(retireErr, ctx.Err())
	}
	complete, joinErr := s.Join(ctx)
	o.firstError(joinErr)
	if !complete {
		return false, errors.Join(retireErr, joinErr)
	}
	complete, closeErr := s.Close(ctx)
	o.firstError(closeErr)
	o.mu.Lock()
	o.closed = complete
	o.status.PhysicalComplete = complete
	o.status.CleanupPending = !complete
	o.mu.Unlock()
	return complete, errors.Join(retireErr, joinErr, closeErr)
}
