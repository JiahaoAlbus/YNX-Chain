package main

import (
	"context"
	"errors"
)

// Transport Stop can return before an admitted application handler completes.
// The caller supplies a bounded context within the existing cleanup window.
func stopPhaseDiagnostics(ctx context.Context, stop func() error, recorder *phaseRecorder) error {
	stopErr := stop()
	drainErr := recorder.drain(ctx)
	if stopErr != nil {
		recorder.mu.Lock()
		recorder.invalid = true
		recorder.mu.Unlock()
	}
	recorder.emit("shutdown", nil)
	return errors.Join(stopErr, drainErr)
}
func (r *phaseRecorder) drain(ctx context.Context) error {
	r.mu.Lock()
	r.draining = true
	if r.drained == nil {
		r.drained = make(chan struct{})
	}
	done := r.drained
	if r.inFlight == 0 {
		close(done)
		r.drained = nil
	}
	r.mu.Unlock()
	var err error
	select {
	case <-ctx.Done():
		err = ctx.Err()
	case <-done:
		err = ctx.Err()
	}
	if err != nil {
		r.mu.Lock()
		r.invalid = true
		r.mu.Unlock()
	}
	return err
}
