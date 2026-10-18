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

// Nested call wall durations, not independent CPU or finality measurements.
// Fixed value fields keep snapshots private and bound retained diagnostics.
type sharedReplayPhaseWork struct {
	Calls      uint64 `json:"calls"`
	Errors     uint64 `json:"errors"`
	DurationNs int64  `json:"durationNs"`
}

func (p *sharedReplayPhaseWork) add(elapsed time.Duration, err error) {
	p.Calls++
	if err != nil {
		p.Errors++
	}
	p.DurationNs += elapsed.Nanoseconds()
}

type sharedReplayWork struct {
	Produce            sharedReplayPhaseWork `json:"produce"`
	CanonicalCopy      sharedReplayPhaseWork `json:"canonicalCopy"`
	PrivateJSON        sharedReplayPhaseWork `json:"privateJSON"`
	PrivateValidate    sharedReplayPhaseWork `json:"privateValidate"`
	CanonicalCopyBytes uint64                `json:"canonicalCopyBytes"`
}

type sharedReplayStats struct {
	WorkPhases           sharedReplayWork `json:"workPhases"`
	Lookups              uint64           `json:"lookups"`
	Hits                 uint64           `json:"hits"`
	Joins                uint64           `json:"joins"`
	FullReplays          uint64           `json:"fullReplays"`
	Failures             uint64           `json:"failures"`
	Bypasses             uint64           `json:"bypasses"`
	WaitNs               int64            `json:"waitNs"`
	CachedCanonicalBytes int              `json:"cachedCanonicalBytes"`
	CanonicalByteLimit   int              `json:"canonicalByteLimit"`
	PeakFlights          int              `json:"peakFlights"`
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

func (c *sharedReplayCache) produceTimed(produce func() (sharedReplayValue, error)) (sharedReplayValue, error) {
	started := time.Now()
	v, err := produce()
	elapsed := time.Since(started)
	c.mu.Lock()
	c.stats.WorkPhases.Produce.add(elapsed, err)
	c.mu.Unlock()
	return v, err
}
func (c *sharedReplayCache) copyForReader(v sharedReplayValue) sharedReplayValue {
	started := time.Now()
	copied := copySharedReplay(v, true)
	elapsed := time.Since(started)
	c.mu.Lock()
	c.stats.WorkPhases.CanonicalCopy.add(elapsed, nil)
	c.stats.WorkPhases.CanonicalCopyBytes += uint64(len(v.payload))
	c.mu.Unlock()
	return copied
}
func (c *sharedReplayCache) recordPrivateWork(jsonDecode bool, started time.Time, err error) {
	elapsed := time.Since(started)
	c.mu.Lock()
	if jsonDecode {
		c.stats.WorkPhases.PrivateJSON.add(elapsed, err)
	} else {
		c.stats.WorkPhases.PrivateValidate.add(elapsed, err)
	}
	c.mu.Unlock()
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
		return c.copyForReader(v), nil
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
			return c.copyForReader(f.value), nil
		}
	}
	if len(c.flights) >= 4 {
		c.stats.Bypasses++
		c.mu.Unlock()
		return c.produceTimed(produce)
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
	v, err := c.produceTimed(produce)
	if err == nil {
		err = ctx.Err()
	}
	c.mu.Lock()
	if err == nil {
		copyStarted := time.Now()
		f.value = copySharedReplay(v, false)
		c.stats.WorkPhases.CanonicalCopy.add(time.Since(copyStarted), nil)
		c.stats.WorkPhases.CanonicalCopyBytes += uint64(len(v.payload))
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
