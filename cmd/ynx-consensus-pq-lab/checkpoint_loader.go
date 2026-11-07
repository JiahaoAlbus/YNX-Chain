//go:build unix

package main

import "github.com/JiahaoAlbus/YNX-Chain/internal/consensus"

// One synchronous sender owns one held original input scope. Every sign still
// captures the four current checkpoints; immutable mathematics is reusable only
// while all original descriptors remain current, until this stream closes.
type pqLabSenderCheckpointLoader struct {
	source *consensus.PQLabSenderCheckpointSource
}

func (l *pqLabSenderCheckpointLoader) close() error {
	if l == nil || l.source == nil {
		return nil
	}
	return l.source.Close()
}
func (l *pqLabSenderCheckpointLoader) stats() consensus.PQLabStaticCacheStats {
	if l == nil || l.source == nil {
		return (*consensus.PQLabStaticCache)(nil).Stats()
	}
	return l.source.CacheStats()
}

func pqLabCheckpointCacheBoundOnly(err error) bool {
	// A joined cleanup/read/validation error must stay an error. In particular,
	// errors.Is alone would swallow a failed close joined with the cache bound.
	return err == consensus.ErrPQLabStaticCacheBound
}

func (l *pqLabSenderCheckpointLoader) load(root, plan, activation string, height int64, appHash string, metrics *consensus.PQLabMetrics) (*consensus.PQLabSenderCheckpoint, error) {
	if l.source == nil {
		l.source = consensus.NewPQLabSenderCheckpointSource()
	}
	return l.source.Load(root, plan, activation, height, appHash, metrics)
}
