package ynxresourcepolicy

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxresourceconsent"
)

var ErrLiveChildRetired = errors.New("resource policy child is retired")
var ErrLiveChildBusy = errors.New("resource policy child already owns a synchronous read")
var ErrLiveChildNotRetired = errors.New("retire resource policy child before joining")

// LivePolicyChild is a local child of the ORIGINAL constructor-paired Core
// Application. It is not a Source/principal/Root grant or a portable C backend.
// The original Node owner alone closes the shared Core source. No method here
// starts/stops a Node, closes that source, chooses a checkpoint, or retries.
// A zero value is invalid. Do not copy this holder after construction.
type LivePolicyChild struct {
	mu       sync.Mutex
	wg       sync.WaitGroup
	source   *consensus.PQWalletPolicyLiveSource
	expected ynxbatch.NetworkResourceConsentBinding
	ctx      context.Context
	cancel   context.CancelFunc
	deadline time.Time
	retired  bool
	reading  bool
	first    error
}

// OpenLivePolicyChild borrows only the concrete source installed by Core's
// normal Node constructor. expected must come from the SAME independently
// qualified principal/full-pair; this constructor cannot establish provenance.
// The original bounded parent deadline is retained, never refreshed. Caller
// still checks its Source/principal/decision before and after every use.
func OpenLivePolicyChild(parent context.Context, app *consensus.Application, expected ynxbatch.NetworkResourceConsentBinding) (*LivePolicyChild, error) {
	if parent == nil || app == nil {
		return nil, ErrCurrent
	}
	if err := parent.Err(); err != nil {
		return nil, err
	}
	deadline, ok := parent.Deadline()
	if !ok || !time.Now().Before(deadline) {
		return nil, ErrCurrent
	}
	expected, _, _, err := resourceExpected(expected)
	if err != nil {
		return nil, err
	}
	source, err := app.WalletPolicyLiveSource()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	if err := ctx.Err(); err != nil {
		cancel()
		return nil, err
	}
	return &LivePolicyChild{source: source, expected: expected, ctx: ctx, cancel: cancel, deadline: deadline}, nil
}

// Timer delivery may lag the wall/monotonic deadline. Check the retained
// original deadline explicitly as well as the original cancellation cause.
func (c *LivePolicyChild) contextError() error {
	err := c.ctx.Err()
	if !time.Now().Before(c.deadline) {
		err = errors.Join(err, context.DeadlineExceeded)
	}
	return err
}

// Read performs an actual Core read at EVERY fence, then the existing complete
// policy/full-pair qualification. There is no saved successful policy fallback.
// Returned bytes are detached DATA at that checkpoint, not a currentness lease.
// Cancellation/retirement crossing any part of the call suppresses all output.
// A failed admitted read is sticky and retires this original child, so callers
// cannot silently retry a crossing/unknown read under a replacement operation.
func (c *LivePolicyChild) Read() (out ynxresourceconsent.CurrentDATA, err error) {
	if c == nil {
		return out, ErrLiveChildRetired
	}
	c.mu.Lock()
	if c.source == nil || c.ctx == nil || c.cancel == nil || c.retired {
		err = errors.Join(ErrLiveChildRetired, c.first)
		c.mu.Unlock()
		return out, err
	}
	if c.reading {
		c.mu.Unlock()
		return out, ErrLiveChildBusy
	}
	if err = c.contextError(); err != nil {
		c.first = errors.Join(c.first, err)
		c.retired = true
		c.cancel()
		c.mu.Unlock()
		return out, err
	}
	c.reading = true
	c.wg.Add(1)
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		err = errors.Join(err, c.contextError())
		if c.retired {
			err = errors.Join(err, ErrLiveChildRetired)
		}
		if err != nil {
			out = ynxresourceconsent.CurrentDATA{}
			if c.first == nil {
				c.first = err
			}
			c.retired = true
			c.cancel()
		}
		c.reading = false
		c.wg.Done()
		c.mu.Unlock()
	}()
	read, err := c.source.Read(c.ctx, c.expected.Owner)
	if err != nil {
		return out, err
	}
	qualified, err := QualifyAtCheckpoint(c.ctx, read, c.expected)
	if err != nil {
		return out, err
	}
	if err = c.contextError(); err != nil {
		return out, err
	}
	return qualified.DataAtCheckpoint(time.Now().UnixMilli())
}

// Current is deliberately a fresh complete original read, not a cached bool.
func (c *LivePolicyChild) Current() error { _, err := c.Read(); return err }

// Retire cancels only this child. The admitted synchronous call must finish on
// the original stack; no detached goroutine, second Node consumer or retry.
func (c *LivePolicyChild) Retire() error {
	if c == nil {
		return ErrLiveChildRetired
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel == nil || c.source == nil {
		return ErrLiveChildRetired
	}
	c.retired = true
	c.cancel()
	return c.first
}

// Join permits no concurrent new admission: retirement is mandatory first.
// The result is the sticky first admitted failure, not physical drain status.
func (c *LivePolicyChild) Join() error {
	if c == nil {
		return ErrLiveChildRetired
	}
	c.mu.Lock()
	if c.cancel == nil || c.source == nil {
		c.mu.Unlock()
		return ErrLiveChildRetired
	}
	if !c.retired {
		c.mu.Unlock()
		return ErrLiveChildNotRetired
	}
	c.mu.Unlock()
	c.wg.Wait()
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.first
}

// Close is local retire+join. Repeated calls preserve the first failure while
// still allowing the owning principal to observe physical drain separately.
func (c *LivePolicyChild) Close() error {
	// Even a sticky first error equal to ErrLiveChildRetired is NOT proof of
	// physical drain. Always join the actual admitted call after retirement.
	_ = c.Retire()
	return c.Join()
}

func (c *LivePolicyChild) Drained() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.source != nil && c.cancel != nil && c.retired && !c.reading
}
