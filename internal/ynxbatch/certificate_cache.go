package ynxbatch

import (
	"container/list"
	"sync"
)

const MaxCertificateCacheEntries = 64

// Each key retains the exact certificate, trusted registration and 32-byte
// caller scope. Do not replace this with a key based only on a batch ID or owner.
const maxCertificateCacheKeyBytes = MaxCertificateBytes + 4096

// CertificateCache remembers successful dual-signature authentication only.
// It has no authority to authorize a member, select a policy or accept a height.
// Callers own its lifetime; there is no process-global cache or background work.
// The zero value is disabled. Construct an enabled instance with the constructor.
// A CertificateCache must not be copied after first use.
type CertificateCache struct {
	mu         sync.Mutex
	capacity   int
	entries    map[string]*list.Element
	lru        *list.List
	generation uint64
	bytes      int
	hits       uint64
	misses     uint64
}

type CertificateCacheStats struct {
	Entries, Capacity, RetainedKeyBytes int
	Hits, Misses                        uint64
}

func NewCertificateCache(entries int) (*CertificateCache, error) {
	if entries < 1 || entries > MaxCertificateCacheEntries {
		return nil, invalid("certificate cache capacity")
	}
	return &CertificateCache{capacity: entries, entries: make(map[string]*list.Element), lru: list.New(), generation: 1}, nil
}

func (c *CertificateCache) enabled() bool {
	return c != nil && c.capacity > 0 && c.capacity <= MaxCertificateCacheEntries
}

func (c *CertificateCache) lookup(key string) (generation uint64, hit bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry := c.entries[key]; entry != nil {
		c.lru.MoveToBack(entry)
		c.hits++
		return c.generation, true
	}
	c.misses++
	return c.generation, false
}

func (c *CertificateCache) remember(key string, generation uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Clear also fences a verification already in flight. Cache exhaustion never
	// changes an authentication result and never queues another caller's work.
	if !c.enabled() || c.generation != generation || len(key) > maxCertificateCacheKeyBytes {
		return
	}
	if entry := c.entries[key]; entry != nil {
		c.lru.MoveToBack(entry)
		return
	}
	if len(c.entries) == c.capacity {
		front := c.lru.Front()
		old := front.Value.(string)
		delete(c.entries, old)
		c.bytes -= len(old)
		c.lru.Remove(front)
	}
	c.entries[key] = c.lru.PushBack(key)
	c.bytes += len(key)
}

// Clear drops retained successes. Unlike Verifier.Clear, it does not revoke
// handles: handle validity still depends on its issuing verifier and live policy.
func (c *CertificateCache) Clear() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]*list.Element)
	c.lru = list.New()
	c.bytes = 0
	c.generation++
}

func (c *CertificateCache) Stats() CertificateCacheStats {
	if c == nil {
		return CertificateCacheStats{}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return CertificateCacheStats{Entries: len(c.entries), Capacity: c.capacity, RetainedKeyBytes: c.bytes, Hits: c.hits, Misses: c.misses}
}
