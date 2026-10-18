package main

import (
	"crypto/sha256"
	"errors"
	"sort"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type durableReaderBudgetStats struct {
	StoreByteLimit       int64  `json:"storeByteLimit"`
	CacheInputByteBudget int64  `json:"cacheInputByteBudget"`
	CachedInputBytes     int64  `json:"cachedInputBytes"`
	Evictions            uint64 `json:"evictions"`
}

func durableReadLimits(o options) (int64, int64, error) {
	limit := o.durableStoreByteLimit
	if limit == 0 {
		limit = durableSnapshotLimit
	}
	budget := o.durableCacheByteBudget
	if !o.streamingWorkload && (limit != durableSnapshotLimit || budget != 0) {
		return 0, 0, errors.New("large durable reader requires explicit streaming workload")
	}
	if limit < durableSnapshotLimit || limit > 512<<20 || budget < 0 || budget > 2<<30 || (limit > durableSnapshotLimit && budget == 0) || (budget > 0 && budget < limit) {
		return 0, 0, errors.New("durable store limit/cache budget invalid (16..512MiB per file, explicit cache budget up to 2GiB)")
	}
	return limit, budget, nil
}
func newWorkloadDurableReader(migration chain.ConsensusMigrationState, paths []string, o options) (*durableReader, error) {
	limit, budget, err := durableReadLimits(o)
	if err != nil {
		return nil, err
	}
	return newDurableReaderWithLimits(migration, paths, limit, budget)
}

// These methods run with the explicit-profile observation mutex held. It is
// acquired before any slot mutex, so cross-slot eviction cannot deadlock a peer.
// One full observation/capture/decode runs at a time in this opt-in mode.
func (r *durableReader) cachedStoreInputBytes() int64 {
	var total int64
	for _, slot := range r.slots {
		if slot.state != nil {
			total += slot.storeInputBytes
		}
	}
	return total
}
func clearDurableCache(slot *durableSnapshotSlot) {
	slot.state = nil
	slot.fees = nil
	slot.nonces = nil
	slot.digest = [sha256.Size]byte{}
	slot.snapshotDigest = [sha256.Size]byte{}
	slot.format = ""
	slot.journalCompleteBytes = 0
	slot.journalIncompleteTail = false
	slot.storeInputBytes = 0
	slot.lastUse = 0
}
func (r *durableReader) reserveStoreCache(current *durableSnapshotSlot, incoming int64) error {
	if incoming < 0 || incoming > r.storeByteLimit || incoming > r.cacheByteBudget {
		return errors.New("incoming durable file exceeds explicit cache budget")
	}
	// A changed generation has no reusable execution index. Drop it before capture.
	clearDurableCache(current)
	names := make([]string, 0, len(r.slots))
	for name := range r.slots {
		names = append(names, name)
	}
	sort.Strings(names)
	for r.cachedStoreInputBytes()+incoming > r.cacheByteBudget {
		var victim *durableSnapshotSlot
		for _, name := range names {
			slot := r.slots[name]
			if slot != current && slot.state != nil && (victim == nil || slot.lastUse < victim.lastUse) {
				victim = slot
			}
		}
		if victim == nil {
			return errors.New("durable cache reservation cannot be satisfied")
		}
		victim.mu.Lock()
		clearDurableCache(victim)
		victim.mu.Unlock()
		r.cacheEvictions++
	}
	return nil
}
