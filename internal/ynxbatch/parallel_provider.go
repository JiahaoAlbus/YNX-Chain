package ynxbatch

import "sync/atomic"

// MaxParallelProviderOperations caps the extra goroutines owned by one explicit
// provider instance. Callers share the instance to share its budget. There are
// no resident workers, global queue or automatic transaction batching.
const MaxParallelProviderOperations = 4

// ParallelProvider schedules only the fixed standard ML-DSA-87 and
// SLH-DSA-SHA2-256f branches. It cannot replace either algorithm. A nil option
// keeps the original sequential provider. Do not copy after first use.
type ParallelProvider struct {
	slots    chan struct{}
	active   atomic.Int64
	peak     atomic.Int64
	parallel atomic.Uint64
	fallback atomic.Uint64
}

type ParallelProviderStats struct {
	Capacity, InFlight, PeakInFlight    int
	ParallelOperations, SerialFallbacks uint64
}

func NewParallelProvider(capacity int) (*ParallelProvider, error) {
	if capacity < 1 || capacity > MaxParallelProviderOperations {
		return nil, invalid("parallel provider capacity")
	}
	return &ParallelProvider{slots: make(chan struct{}, capacity)}, nil
}

func (p *ParallelProvider) enabled() bool {
	return p != nil && cap(p.slots) >= 1 && cap(p.slots) <= MaxParallelProviderOperations
}

func (p *ParallelProvider) Stats() ParallelProviderStats {
	if p == nil {
		return ParallelProviderStats{}
	}
	return ParallelProviderStats{Capacity: cap(p.slots), InFlight: int(p.active.Load()), PeakInFlight: int(p.peak.Load()), ParallelOperations: p.parallel.Load(), SerialFallbacks: p.fallback.Load()}
}

func (p *ParallelProvider) acquire() bool {
	if p == nil {
		return false
	}
	select {
	case p.slots <- struct{}{}:
		n := p.active.Add(1)
		for old := p.peak.Load(); n > old; old = p.peak.Load() {
			if p.peak.CompareAndSwap(old, n) {
				break
			}
		}
		p.parallel.Add(1)
		return true
	default:
		p.fallback.Add(1)
		return false
	}
}

func (p *ParallelProvider) release() {
	p.active.Add(-1)
	<-p.slots
}

type providerPanic struct {
	value  any
	raised bool
}

// Capture only to join both branches before rethrowing on the caller. In
// particular, an upstream panic must not unlock a signing key while the other
// branch still uses it. Panics are never converted into verification success.
func invokeProviderBranch(f func()) (out providerPanic) {
	out.raised = true
	defer func() {
		if out.raised {
			out.value = recover()
		}
	}()
	f()
	out.raised = false
	return
}

// runPair is private: there is no public arbitrary signer/verification callback.
// At saturation the caller executes both branches itself, without a queue or
// goroutine. When admitted, one branch runs on the caller and one on a worker.
func (p *ParallelProvider) runPair(a, b func()) {
	if !p.acquire() {
		a()
		b()
		return
	}
	defer p.release()
	done := make(chan providerPanic, 1)
	go func() { done <- invokeProviderBranch(a) }()
	second := invokeProviderBranch(b)
	first := <-done
	if first.raised {
		panic(first.value)
	}
	if second.raised {
		panic(second.value)
	}
}
