package contribution

import (
	"context"
	"errors"
	"sync"
)

var ErrCurrentReaderRetired = errors.New("original resource current reader retired")

// CurrentStoreIdentity identifies the original store actually held by this
// reader. Path is locator DATA only, not an issuer/Root trust decision.
type CurrentStoreIdentity struct {
	JournalPath string           `json:"journalPath"`
	Resource    ResourceIdentity `json:"resource"`
	Epoch       string           `json:"epoch"`
}

// ResourceCurrentReader is a concrete private-composition lease on the
// original Runner. It owns its in-flight reads, not the Runner or its workers.
// Auth's actual registered publisher can use this callee without a caller
// supplied provider/body/counter, or a second authority database.
type ResourceCurrentReader struct {
	mu                      sync.Mutex
	runner                  *Runner
	identity                CurrentStoreIdentity
	active                  uint64
	retired, joined, closed bool
	drained                 chan struct{}
	first                   error
}

func (r *Runner) BorrowCurrentResourceReader(ctx context.Context) (*ResourceCurrentReader, error) {
	data, err := r.ReadCurrentResourceDATA(ctx)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.persistenceErr != nil || r.data.ResourceCurrent == nil {
		return nil, ErrResourceCurrent
	}
	identity := CurrentStoreIdentity{r.path, r.data.ResourceCurrent.Identity, r.data.ResourceCurrent.Epoch}
	if data.SourceID != identity.Resource.SourceID || data.InstanceID != identity.Resource.InstanceID || data.ResourceKey != identity.Resource.ResourceKey || data.Epoch != identity.Epoch {
		return nil, ErrResourceCurrent
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	return &ResourceCurrentReader{runner: r, identity: identity, drained: make(chan struct{})}, nil
}
func (r *ResourceCurrentReader) StoreIdentity() CurrentStoreIdentity {
	if r == nil {
		return CurrentStoreIdentity{}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.identity
}
func (r *ResourceCurrentReader) begin(ctx context.Context) (*Runner, error) {
	if r == nil {
		return nil, ErrCurrentReaderRetired
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.retired || r.closed || r.first != nil {
		return nil, errors.Join(ErrCurrentReaderRetired, r.first)
	}
	if err := ctx.Err(); err != nil {
		r.first = err
		return nil, err
	}
	if r.active == ^uint64(0) {
		return nil, ErrCapacity
	}
	r.active++
	return r.runner, nil
}
func (r *ResourceCurrentReader) end(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err != nil && r.first == nil {
		r.first = err
	}
	r.active--
	if r.active == 0 && r.retired {
		close(r.drained)
	}
}
func (r *ResourceCurrentReader) ReadCurrentResourceDATA(ctx context.Context) (data ResourceCurrentDATA, err error) {
	original, err := r.begin(ctx)
	if err != nil {
		return data, err
	}
	defer func() { r.end(err) }()
	data, err = original.ReadCurrentResourceDATA(ctx)
	if err != nil {
		return ResourceCurrentDATA{}, err
	}
	r.mu.Lock()
	retired, identity := r.retired || r.closed, r.identity
	r.mu.Unlock()
	if retired {
		return ResourceCurrentDATA{}, ErrCurrentReaderRetired
	}
	if data.SourceID != identity.Resource.SourceID || data.InstanceID != identity.Resource.InstanceID || data.ResourceKey != identity.Resource.ResourceKey || data.Epoch != identity.Epoch {
		return ResourceCurrentDATA{}, ErrResourceCurrent
	}
	if err = ctx.Err(); err != nil {
		return ResourceCurrentDATA{}, err
	}
	return data, nil
}
func (r *ResourceCurrentReader) Current(ctx context.Context) error {
	_, err := r.ReadCurrentResourceDATA(ctx)
	return err
}
func (r *ResourceCurrentReader) Retire() error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.retired {
		r.retired = true
		if r.active == 0 {
			close(r.drained)
		}
	}
	return r.first
}
func (r *ResourceCurrentReader) Join(ctx context.Context) (bool, error) {
	if r == nil {
		return true, nil
	}
	r.mu.Lock()
	retired, joined, first := r.retired, r.joined, r.first
	r.mu.Unlock()
	if !retired {
		return false, ErrCurrentReaderRetired
	}
	if joined {
		return true, first
	}
	select {
	case <-r.drained:
		r.mu.Lock()
		r.joined = true
		first = r.first
		r.mu.Unlock()
		return true, first
	case <-ctx.Done():
		return false, ctx.Err()
	}
}
func (r *ResourceCurrentReader) Close(ctx context.Context) (bool, error) {
	if r == nil {
		return true, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return true, r.first
	}
	if !r.retired || !r.joined || r.active != 0 {
		return false, ErrCurrentReaderRetired
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	r.closed = true
	r.runner = nil
	return true, r.first
}
