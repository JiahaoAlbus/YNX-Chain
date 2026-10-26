package ynxconsensusauth

import (
	"container/list"
	"errors"
	"sync"
)

const registrationMathCacheEntries = 16
const registrationMathCacheKeyLimit = MaxRegistrationBytes + 4096
const registrationMathCacheDomain = "YNX-CONSENSUS-REGISTRATION-MATH-CACHE/v1\x00"

// RegistrationMathCache retains only successful fixed-suite mathematics. It
// cannot authenticate membership, a state/prefix/root, a height or an Append.
// Its owner supplies an independently authenticated bootstrap scope and starts
// with a fresh cache on cold construction. No cache is global or serialized.
// A cache must not be copied after use. The nil and zero values are disabled.
type RegistrationMathCache struct {
	mu         sync.Mutex
	enabled    bool
	scope      [32]byte
	entries    map[string]*list.Element
	lru        *list.List
	generation uint64
	bytes      int
	hits       uint64
	misses     uint64
}

type RegistrationMathCacheStats struct {
	Entries, Capacity, RetainedKeyBytes int
	Hits, Misses                        uint64
}

// scope is the exact independently pinned raw Comet Genesis SHA256, not a
// native chain ID or a root supplied alongside untrusted registration bytes.
func NewRegistrationMathCache(scope []byte) (*RegistrationMathCache, error) {
	if len(scope) != 32 || regZero(scope) {
		return nil, errors.New("registration mathematics cache requires a nonzero 32-byte bootstrap scope")
	}
	c := &RegistrationMathCache{enabled: true, entries: make(map[string]*list.Element), lru: list.New(), generation: 1}
	copy(c.scope[:], scope)
	return c, nil
}

// This authority is resolved by Append's original dynamic checks, not accepted
// from a caller claiming that the registration has already been authenticated.
type registrationMathAuthority struct {
	legacy []byte
	a, b   []byte
	epoch  uint64
}

func (c *RegistrationMathCache) verify(anchor RegistryAnchor, wire []byte, r Registration, trusted registrationMathAuthority) error {
	if c == nil || !c.enabled {
		return verifyRegistration(r)
	}
	// The complete owned wire contains the exact intent, all old/new public
	// keys, every signature and the AUTH/POP signing inputs. Include the actual
	// resolved authority separately, plus the trusted anchor and caller scope.
	// Fixed domains/suite/context are explicit internal cache namespaces only;
	// this framing does not change registration, state or protocol hash bytes.
	epoch := regPair(trusted.epoch)
	keyBytes, err := regEncode(registrationMathCacheKeyLimit,
		[]byte(registrationMathCacheDomain), regU32(RegistryVersion), c.scope[:], anchor.GenesisID, []byte(anchor.ChainID),
		[]byte(registrationAuthorityDomain), []byte(registrationPossessionDomain),
		[]byte("Ed25519/ML-DSA-87/SLH-DSA-SHA2-256f/pure-message/empty-context"),
		wire, trusted.legacy, trusted.a, trusted.b, epoch[0], epoch[1])
	if err != nil {
		// A cache bound may never reject an otherwise valid registration.
		return verifyRegistration(r)
	}
	key := string(keyBytes)
	c.mu.Lock()
	generation := c.generation
	if entry := c.entries[key]; entry != nil {
		c.lru.MoveToBack(entry)
		c.hits++
		c.mu.Unlock()
		return nil
	}
	c.misses++
	c.mu.Unlock()
	if err := verifyRegistration(r); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	// Clear fences a successful verification that was still in flight. Neither
	// exhaustion nor eviction changes the verification result or retries it.
	if generation != c.generation {
		return nil
	}
	if entry := c.entries[key]; entry != nil {
		c.lru.MoveToBack(entry)
		return nil
	}
	if len(c.entries) == registrationMathCacheEntries {
		old := c.lru.Front()
		oldKey := old.Value.(string)
		delete(c.entries, oldKey)
		c.bytes -= len(oldKey)
		c.lru.Remove(old)
	}
	c.entries[key] = c.lru.PushBack(key)
	c.bytes += len(key)
	return nil
}

func (c *RegistrationMathCache) Clear() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.enabled {
		return
	}
	c.entries = make(map[string]*list.Element)
	c.lru = list.New()
	c.bytes = 0
	c.generation++
}

func (c *RegistrationMathCache) Stats() RegistrationMathCacheStats {
	if c == nil {
		return RegistrationMathCacheStats{}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	capacity := 0
	if c.enabled {
		capacity = registrationMathCacheEntries
	}
	return RegistrationMathCacheStats{Entries: len(c.entries), Capacity: capacity, RetainedKeyBytes: c.bytes, Hits: c.hits, Misses: c.misses}
}
