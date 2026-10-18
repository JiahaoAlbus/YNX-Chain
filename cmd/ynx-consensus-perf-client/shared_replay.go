package main

import (
	"context"
	"crypto/sha256"
	"sync"
	"time"
)

// Only canonical bytes from a successful full replay are retained. Each hit
// receives private bytes and reconstructs/validates its own state and indexes.
type sharedReplayValue struct {
	payload        []byte
	format         string
	completeBytes  int
	incompleteTail bool
	reused         bool
}

type sharedReplayStats struct {
	Lookups              uint64 `json:"lookups"`
	Hits                 uint64 `json:"hits"`
	Joins                uint64 `json:"joins"`
	FullReplays          uint64 `json:"fullReplays"`
	Failures             uint64 `json:"failures"`
	Bypasses             uint64 `json:"bypasses"`
	WaitNs               int64  `json:"waitNs"`
	CachedCanonicalBytes int    `json:"cachedCanonicalBytes"`
	CanonicalByteLimit   int    `json:"canonicalByteLimit"`
	PeakFlights          int    `json:"peakFlights"`
}

type sharedReplayFlight struct {
	done  chan struct{}
	value sharedReplayValue
	err   error
}

type sharedReplayCache struct {
	mu      sync.Mutex
	key     [sha256.Size]byte
	value   *sharedReplayValue                        // One entry, at most16MiB canonical JSON.
	flights map[[sha256.Size]byte]*sharedReplayFlight // At most four manifest slots.
	stats   sharedReplayStats
}

func copySharedReplay(v sharedReplayValue, reused bool) sharedReplayValue {
	v.payload = append([]byte(nil), v.payload...)
	v.reused = reused
	return v
}

func (c *sharedReplayCache) snapshot() sharedReplayStats {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := c.stats
	s.CanonicalByteLimit = durableSnapshotLimit
	if c.value != nil {
		s.CachedCanonicalBytes = len(c.value.payload)
	}
	return s
}

func (c *sharedReplayCache) get(ctx context.Context, key [sha256.Size]byte, produce func() (sharedReplayValue, error)) (sharedReplayValue, error) {
	if err := ctx.Err(); err != nil {
		return sharedReplayValue{}, err
	}
	c.mu.Lock()
	c.stats.Lookups++
	if c.value != nil && c.key == key {
		c.stats.Hits++
		v := *c.value
		c.mu.Unlock()
		return copySharedReplay(v, true), nil
	}
	if f := c.flights[key]; f != nil {
		c.stats.Joins++
		c.mu.Unlock()
		started := time.Now()
		select {
		case <-ctx.Done():
			c.mu.Lock()
			c.stats.WaitNs += time.Since(started).Nanoseconds()
			c.mu.Unlock()
			return sharedReplayValue{}, ctx.Err()
		case <-f.done:
			c.mu.Lock()
			c.stats.WaitNs += time.Since(started).Nanoseconds()
			c.mu.Unlock()
			if err := ctx.Err(); err != nil {
				return sharedReplayValue{}, err
			}
			if f.err != nil {
				return sharedReplayValue{}, f.err
			}
			return copySharedReplay(f.value, true), nil
		}
	}
	if len(c.flights) >= 4 {
		c.stats.Bypasses++
		c.mu.Unlock()
		return produce()
	}
	if c.flights == nil {
		c.flights = make(map[[sha256.Size]byte]*sharedReplayFlight)
	}
	f := &sharedReplayFlight{done: make(chan struct{})}
	c.flights[key] = f
	c.stats.FullReplays++
	if len(c.flights) > c.stats.PeakFlights {
		c.stats.PeakFlights = len(c.flights)
	}
	c.mu.Unlock()
	v, err := produce()
	if err == nil {
		err = ctx.Err()
	}
	c.mu.Lock()
	if err == nil {
		f.value = copySharedReplay(v, false)
		if len(v.payload) <= durableSnapshotLimit {
			c.key = key
			c.value = &f.value
		} else {
			c.stats.Bypasses++
		}
	} else {
		c.stats.Failures++
	}
	f.err = err
	delete(c.flights, key)
	close(f.done)
	c.mu.Unlock()
	return v, err
}
