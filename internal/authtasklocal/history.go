//go:build darwin || linux

package tasklocalsource

import (
	"context"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	"sync"
)

// Separate original query factory and concrete type. No OpenCheck, verifier,
// local-read/model effect or fall back to the expired NEW projection is exposed.
type History struct {
	mu         sync.Mutex
	original   *native.QueryRuntime
	first      error
	retired    bool
	calls      int
	once       sync.Once
	closeErr   error
	earlyClose error
}

func OpenOriginalLocalTaskHistorySource() (*History, error) {
	h := &History{}
	h.original, h.first = native.OpenOriginalGrantQueryRuntime()
	return h, h.first
}
func (h *History) QueryOriginalTaskRequest(ctx context.Context, q native.OriginalTaskRequest) (native.OriginalOperationReference, error) {
	var out native.OriginalOperationReference
	if h == nil || ctx == nil {
		return out, native.ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return out, e
	}
	h.mu.Lock()
	if h.first != nil {
		e := h.first
		h.mu.Unlock()
		return out, e
	}
	if h.retired || h.original == nil {
		h.mu.Unlock()
		return out, native.ErrRetired
	}
	h.calls++
	h.mu.Unlock()
	defer func() { h.mu.Lock(); h.calls--; h.mu.Unlock() }()
	// Original API retains nonzero state/op on late current/close errors.
	out, e := h.original.QueryOriginalTaskRequest(ctx, q)
	if e != nil {
		return out, e
	}
	h.mu.Lock()
	retired := h.retired
	h.mu.Unlock()
	if retired {
		return out, native.ErrRetired
	}
	if e = ctx.Err(); e != nil {
		return out, e
	}
	return out, h.original.Current(ctx)
}
func (h *History) Retire() error {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	h.retired = true
	h.mu.Unlock()
	if h.original != nil {
		return h.original.Retire()
	}
	return nil
}
func (h *History) Close() error {
	if h == nil {
		return nil
	}
	e := h.Retire()
	h.mu.Lock()
	active := h.calls != 0
	h.mu.Unlock()
	if active {
		h.mu.Lock()
		if h.earlyClose == nil {
			h.earlyClose = ErrChildrenRetained
		}
		e := h.earlyClose
		h.mu.Unlock()
		return e
	}
	h.once.Do(func() {
		h.closeErr = e
		if h.original != nil {
			for _, f := range []func() error{h.original.Join, h.original.Close} {
				if e := f(); h.closeErr == nil {
					h.closeErr = e
				}
			}
		}
	})
	h.mu.Lock()
	early := h.earlyClose
	h.mu.Unlock()
	if early != nil {
		return early
	}
	return h.closeErr
}
