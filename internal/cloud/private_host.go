package cloud

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"sync"
	"time"
)

var ErrOriginalPrivateHostUnavailable = errors.New("original Cloud private host is unavailable or retired")
var ErrOriginalPrivateHostChildrenRetained = errors.New("original Cloud private host handlers or storage worker are retained")

// The same explicit state.json and objects paths used by normal ynx-cloudd.
// Core owns the enclosing private listener and its real ledger parents. No
// environment, Root, pricing, Source or signer is synthesized by this config.
type OriginalPrivateHostConfig struct {
	Cloud             Config
	Limits            ServerLimits
	LifecycleInterval time.Duration
	LifecycleBatch    int
}

// OriginalPrivateHost owns one normal Service, one Server and its one original
// journal reader. It never opens a listener, imports Core/Pay or creates a
// second ledger. The original API handler and recovery worker are used intact.
type OriginalPrivateHost struct {
	self                   *OriginalPrivateHost
	ctx                    context.Context
	service                *Service
	server                 *Server
	reader                 *IDEUsageBillReader
	handler                http.Handler
	mu                     sync.Mutex
	closeMu                sync.Mutex
	ready, retired, closed bool
	active                 int
	workerRunning          bool
	workerError            error
	first                  error
	cancel                 context.CancelFunc
	stopParent             func() bool
	work                   sync.WaitGroup
	joinOnce               sync.Once
	drained                chan struct{}
}

// Retain the nonnil partial before checking error. New calls only the original
// Cloud constructors. Missing IDE Source/OCI cannot block creation of genuine
// parent objects or a read-only descriptor; their effect routes still deny.
func OpenOriginalPrivateHost(ctx context.Context, cfg OriginalPrivateHostConfig) (*OriginalPrivateHost, error) {
	h := &OriginalPrivateHost{ctx: ctx, drained: make(chan struct{})}
	h.self = h
	fail := func(err error) (*OriginalPrivateHost, error) { h.first = err; h.Retire(); return h, err }
	if ctx == nil {
		return fail(ErrOriginalPrivateHostUnavailable)
	}
	if err := ctx.Err(); err != nil {
		return fail(err)
	}
	if !filepath.IsAbs(cfg.Cloud.StatePath) || filepath.Clean(cfg.Cloud.StatePath) != cfg.Cloud.StatePath || !filepath.IsAbs(cfg.Cloud.ObjectDir) || filepath.Clean(cfg.Cloud.ObjectDir) != cfg.Cloud.ObjectDir {
		return fail(ErrInvalid)
	}
	if cfg.LifecycleInterval == 0 {
		cfg.LifecycleInterval = 2 * time.Second
	}
	if cfg.LifecycleBatch == 0 {
		cfg.LifecycleBatch = 8
	}
	if cfg.LifecycleInterval < 100*time.Millisecond || cfg.LifecycleInterval > time.Minute || cfg.LifecycleBatch < 1 || cfg.LifecycleBatch > 64 {
		return fail(ErrInvalid)
	}
	service, err := New(cfg.Cloud)
	h.service = service
	if err != nil {
		return fail(err)
	}
	if err = ctx.Err(); err != nil {
		return fail(err)
	}
	h.server = NewServerWithLimits(service, cfg.Limits)
	h.reader, err = h.server.OpenOriginalIDEUsageBillReader()
	if err != nil {
		return fail(err)
	}
	original := h.server.WrapIDEProjectRuntime(SecureHandler(h.server.Handler()))
	h.handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		if !h.ready || h.retired || h.ctx.Err() != nil {
			h.mu.Unlock()
			productReadFailure(w, http.StatusServiceUnavailable, "CLOUD_PRIVATE_HOST_RETIRED")
			return
		}
		h.active++
		h.work.Add(1)
		h.mu.Unlock()
		defer func() { h.mu.Lock(); h.active--; h.mu.Unlock(); h.work.Done() }()
		original.ServeHTTP(w, r)
	})
	workerCtx, cancel := context.WithCancel(ctx)
	h.cancel = cancel
	h.ready = true
	h.workerRunning = true
	h.work.Add(1)
	go h.storageWorker(workerCtx, cfg.LifecycleInterval, cfg.LifecycleBatch)
	h.stopParent = context.AfterFunc(ctx, h.Retire)
	if err = ctx.Err(); err != nil {
		h.mu.Lock()
		if h.first == nil {
			h.first = err
		}
		h.mu.Unlock()
		h.Retire()
		return h, err
	}
	return h, nil
}

func (h *OriginalPrivateHost) storageWorker(ctx context.Context, interval time.Duration, batch int) {
	defer func() { h.mu.Lock(); h.workerRunning = false; h.mu.Unlock(); h.work.Done() }()
	run := func() {
		if _, err := h.service.RecoverPendingStorageTransitions(ctx, batch); err != nil && ctx.Err() == nil {
			h.mu.Lock()
			if h.workerError == nil {
				h.workerError = err
			}
			h.mu.Unlock()
		}
	}
	run()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func (h *OriginalPrivateHost) Parents() (*Service, *Server, *IDEUsageBillReader, error) {
	if h == nil || h.self != h {
		return nil, nil, nil, ErrOriginalPrivateHostUnavailable
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.ready || h.retired || h.ctx == nil || h.ctx.Err() != nil {
		return nil, nil, nil, ErrOriginalPrivateHostUnavailable
	}
	return h.service, h.server, h.reader, nil
}
func (h *OriginalPrivateHost) Service() (*Service, error) { s, _, _, e := h.Parents(); return s, e }
func (h *OriginalPrivateHost) Server() (*Server, error)   { _, s, _, e := h.Parents(); return s, e }
func (h *OriginalPrivateHost) BillReader() (*IDEUsageBillReader, error) {
	_, _, r, e := h.Parents()
	return r, e
}
func (h *OriginalPrivateHost) Handler() (http.Handler, error) {
	if _, _, _, err := h.Parents(); err != nil {
		return nil, err
	}
	return h.handler, nil
}

// The first actual storage-worker error is retained for the enclosing normal
// host's diagnostics; no path/credential is copied into a public health DTO.
func (h *OriginalPrivateHost) StorageRecoveryError() error {
	if h == nil || h.self != h {
		return ErrOriginalPrivateHostUnavailable
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.workerError
}
func (h *OriginalPrivateHost) Retire() {
	if h == nil || h.self != h {
		return
	}
	h.mu.Lock()
	h.retired = true
	cancel, server := h.cancel, h.server
	h.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if server != nil {
		server.RetireOriginalIDEUsageBillReader()
	}
}

// Join drains Cloud handlers and its owned storage worker only. Core must
// separately retire/join Pay/Auth children borrowing the reader before closing
// their parents. A cancelled Join retains all parents; it cannot imply drain.
func (h *OriginalPrivateHost) Join(ctx context.Context) error {
	if h == nil || h.self != h || ctx == nil {
		return ErrOriginalPrivateHostUnavailable
	}
	h.Retire()
	h.joinOnce.Do(func() { go func() { h.work.Wait(); close(h.drained) }() })
	select {
	case <-h.drained:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Close never blocks waiting for live children and never closes a Core/Pay or
// Auth parent owned elsewhere. First failure is sticky. After an early Close
// reports retained children, a later Close can finish cleanup after Join while
// still returning that original failure.
func (h *OriginalPrivateHost) Close() error {
	if h == nil || h.self != h {
		return ErrOriginalPrivateHostUnavailable
	}
	h.Retire()
	h.closeMu.Lock()
	defer h.closeMu.Unlock()
	h.mu.Lock()
	if h.closed {
		err := h.first
		h.mu.Unlock()
		return err
	}
	if h.active != 0 || h.workerRunning {
		if h.first == nil {
			h.first = ErrOriginalPrivateHostChildrenRetained
		}
		err := h.first
		h.mu.Unlock()
		return err
	}
	h.closed = true
	h.mu.Unlock()
	var err error
	if h.reader != nil {
		err = h.reader.Close()
	}
	if h.server != nil {
		err = errors.Join(err, h.server.CloseIDEDeploymentV2Authority())
	}
	if h.stopParent != nil {
		h.stopParent()
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.first == nil {
		h.first = err
	}
	return h.first
}
