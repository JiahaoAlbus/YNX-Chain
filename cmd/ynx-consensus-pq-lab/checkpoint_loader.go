//go:build unix

package main

import "github.com/JiahaoAlbus/YNX-Chain/internal/consensus"

// This is only eligibility for the optional immutable-source cache, never an
// authorization/current-state result. The existing synchronous sender uses one
// fixed original root/plan. After a clean cache-budget refusal it performs the
// original complete uncached validation on EVERY subsequent sign command.
type pqLabSenderCheckpointLoader struct {
	cache    *consensus.PQLabStaticCache
	uncached bool
}

func pqLabCheckpointCacheBoundOnly(err error) bool {
	// A joined cleanup/read/validation error must stay an error. In particular,
	// errors.Is alone would swallow a failed close joined with the cache bound.
	return err == consensus.ErrPQLabStaticCacheBound
}

func (l *pqLabSenderCheckpointLoader) load(root, plan, activation string, height int64, appHash string, metrics *consensus.PQLabMetrics) (*consensus.PQLabSenderCheckpoint, error) {
	if l.uncached || l.cache == nil {
		return consensus.LoadPQLabSenderCheckpointMeasured(root, plan, activation, height, appHash, metrics)
	}
	checkpoint, err := consensus.LoadPQLabSenderCheckpointCached(root, plan, activation, height, appHash, metrics, l.cache)
	if !pqLabCheckpointCacheBoundOnly(err) {
		return checkpoint, err
	}
	l.uncached = true
	return consensus.LoadPQLabSenderCheckpointMeasured(root, plan, activation, height, appHash, metrics)
}
