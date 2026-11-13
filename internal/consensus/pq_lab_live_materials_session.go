//go:build unix

package consensus

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
)

// PQLabLiveMaterialsSession holds one independently pinned synthetic lane's
// public static inputs and original R anchor. It never owns the running Node,
// a signing key, a current checkpoint or a transaction proof. Requests and
// results always execute the original file/state machine and current checks.
// No witness is exported or accepted from another lifetime or policy.
type PQLabLiveMaterialsSession struct {
	mu           sync.Mutex
	retired      atomic.Bool
	ctx          context.Context
	in           *pqLabLiveMaterialsInputs
	calls, limit uint64
	closed       bool
	closeErr     error
}

type PQLabLiveMaterialsSessionStats struct {
	PolicySHA256  string `json:"policySHA256"`
	NodeIndex     int    `json:"nodeIndex"`
	MaxOperations uint32 `json:"maxOperations"`
	Commands      uint64 `json:"commands"`
	CommandLimit  uint64 `json:"commandLimit"`
	Retired       bool   `json:"retired"`
	Closed        bool   `json:"closed"`
}

var ErrPQLabLiveMaterialsBusy = errors.New("original live lane command already in flight; no request queued")

func OpenPQLabLiveMaterialsSession(ctx context.Context, policyPath, pin string, metrics *PQLabMetrics) (*PQLabLiveMaterialsSession, error) {
	defer pqLabMeasure(metrics, "live.sessionPrepareTotal")()
	if ctx == nil || ctx.Err() != nil {
		return nil, errors.New("live lane requires a current original context")
	}
	in, err := loadPQLabLiveMaterialsPolicyMeasured(policyPath, pin, metrics)
	if err != nil {
		return nil, err
	}
	if err = errors.Join(in.current(), ctx.Err()); err != nil {
		return nil, errors.Join(err, in.close())
	}
	// This helper publishes and reads the node's original result. The owning
	// Node still uses the decoded anchor to verify registry history. The
	// helper keeps the pinned raw anchor and checks its original FD on every
	// command, but no longer needs the decoded committed-state copy.
	in.anchor.CommittedState = nil
	in.metrics = nil
	// Bounded synchronous commands allow explicit result readback without a
	// queue, retry loop or unbounded policy-independent helper lifetime.
	return &PQLabLiveMaterialsSession{ctx: ctx, in: in, limit: 4*uint64(in.policy.MaxOperations) + 16}, nil
}

func (s *PQLabLiveMaterialsSession) Retire() {
	if s != nil {
		s.retired.Store(true)
	}
}
func (s *PQLabLiveMaterialsSession) Close() error {
	if s == nil {
		return nil
	}
	s.Retire()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return s.closeErr
	}
	s.closed = true
	if s.in != nil {
		s.closeErr = s.in.close()
	}
	return s.closeErr
}
func (s *PQLabLiveMaterialsSession) Stats() PQLabLiveMaterialsSessionStats {
	if s == nil {
		return PQLabLiveMaterialsSessionStats{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.in == nil {
		return PQLabLiveMaterialsSessionStats{Closed: s.closed, Retired: s.retired.Load()}
	}
	return PQLabLiveMaterialsSessionStats{PolicySHA256: s.in.pin, NodeIndex: s.in.policy.NodeIndex, MaxOperations: s.in.policy.MaxOperations, Commands: s.calls, CommandLimit: s.limit, Retired: s.retired.Load(), Closed: s.closed}
}
func (s *PQLabLiveMaterialsSession) begin(ctx context.Context, metrics *PQLabMetrics) (func() error, error) {
	if s == nil || ctx == nil {
		return nil, errors.New("original live lane and context required")
	}
	if !s.mu.TryLock() {
		return nil, ErrPQLabLiveMaterialsBusy
	}
	refuse := func(err error) (func() error, error) { s.mu.Unlock(); return nil, err }
	if s.retired.Load() || s.closed || s.in == nil || s.calls >= s.limit {
		return refuse(errors.New("original live lane closed, retired or command bound reached"))
	}
	if err := errors.Join(s.ctx.Err(), ctx.Err()); err != nil {
		return refuse(err)
	}
	s.calls++
	s.in.metrics = metrics
	if err := s.in.current(); err != nil {
		s.in.metrics = nil
		return refuse(err)
	}
	return func() error {
		defer s.mu.Unlock()
		defer func() { s.in.metrics = nil }()
		return errors.Join(s.in.current(), s.ctx.Err(), ctx.Err())
	}, nil
}

// Publish preserves exact original exclusive publication. An error may follow
// durable publication; callers must retain/reconcile that original, never resend.
func (s *PQLabLiveMaterialsSession) Publish(ctx context.Context, r PQLabLiveMaterialsRequest, metrics *PQLabMetrics) (path string, err error) {
	defer pqLabMeasure(metrics, "live.publishTotal")()
	end, err := s.begin(ctx, metrics)
	if err != nil {
		return "", err
	}
	defer func() { err = errors.Join(err, end()) }()
	return publishPQLabLiveMaterialsRequestOwned(s.in, r)
}
func (s *PQLabLiveMaterialsSession) Read(ctx context.Context, sequence uint32, metrics *PQLabMetrics) (out PQLabLiveMaterialsResult, err error) {
	defer pqLabMeasure(metrics, "live.resultReadTotal")()
	end, err := s.begin(ctx, metrics)
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, end()) }()
	return readPQLabLiveMaterialsResultOwned(s.in, sequence)
}
