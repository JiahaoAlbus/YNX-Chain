package consensus

import (
	"crypto/sha256"
	"sync"
)

const (
	nativeVerificationCapacity    = 4096
	nativeVerificationStringBytes = 4 << 20
)

type nativeVerificationKey struct {
	chainID int64
	digest  [sha256.Size]byte
}

type verifiedNativeEntry struct {
	payload     string
	tx          SignedTransaction
	stringBytes int
}

// Only immutable, successfully decoded and cryptographically verified native
// envelopes belong here. This is not admission or execution authorization.
// FIFO eviction bounds both entry count and retained string data. The map/ring
// overhead is additionally bounded by nativeVerificationCapacity.
type nativeVerificationCache struct {
	mu          sync.Mutex
	entries     map[nativeVerificationKey]verifiedNativeEntry
	order       []nativeVerificationKey
	head        int
	stringBytes int
	lookups     uint64
	hits        uint64
	verified    uint64
}

type nativeVerificationStats struct {
	Capacity                int    `json:"capacity"`
	StringByteLimit         int    `json:"string_byte_limit"`
	Entries                 int    `json:"entries"`
	RetainedStringBytes     int    `json:"retained_string_bytes"`
	Lookups                 uint64 `json:"lookups"`
	Hits                    uint64 `json:"hits"`
	SuccessfulVerifications uint64 `json:"successful_verifications"`
}

func (c *nativeVerificationCache) lookup(key nativeVerificationKey, payload []byte) (SignedTransaction, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lookups++
	entry, ok := c.entries[key]
	// The retained canonical bytes are checked as well as their digest.
	if !ok || entry.payload != string(payload) {
		return SignedTransaction{}, false
	}
	c.hits++
	return entry.tx, true
}

func (c *nativeVerificationCache) rememberVerified(key nativeVerificationKey, payload string, tx SignedTransaction) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.verified++
	if _, exists := c.entries[key]; exists {
		// Concurrent misses can verify the same bytes independently. A digest
		// collision never replaces an entry with different canonical bytes.
		return
	}
	cost := len(payload) + len(tx.Type) + len(tx.From) + len(tx.To) + len(tx.PublicKey) + len(tx.Signature)
	if cost > nativeVerificationStringBytes {
		return
	}
	if c.entries == nil {
		c.entries = make(map[nativeVerificationKey]verifiedNativeEntry)
		c.order = make([]nativeVerificationKey, nativeVerificationCapacity)
	}
	for len(c.entries) >= nativeVerificationCapacity || c.stringBytes+cost > nativeVerificationStringBytes {
		oldKey := c.order[c.head]
		c.stringBytes -= c.entries[oldKey].stringBytes
		delete(c.entries, oldKey)
		c.head = (c.head + 1) % nativeVerificationCapacity
	}
	index := (c.head + len(c.entries)) % nativeVerificationCapacity
	c.order[index] = key
	c.entries[key] = verifiedNativeEntry{payload: payload, tx: tx, stringBytes: cost}
	c.stringBytes += cost
}

func (c *nativeVerificationCache) stats() nativeVerificationStats {
	c.mu.Lock()
	defer c.mu.Unlock()
	return nativeVerificationStats{Capacity: nativeVerificationCapacity, StringByteLimit: nativeVerificationStringBytes, Entries: len(c.entries), RetainedStringBytes: c.stringBytes, Lookups: c.lookups, Hits: c.hits, SuccessfulVerifications: c.verified}
}

func (a *Application) decodeVerifiedNativeTransaction(payload []byte) (SignedTransaction, error) {
	if len(payload) == 0 || len(payload) > MaxSignedTransactionSize {
		return DecodeSignedTransaction(payload)
	}
	chainID := a.migration.Network.ChainID
	cache := &a.nativeVerification
	if a.replayVerificationFacts != nil {
		cache = a.replayVerificationFacts
	}
	key := nativeVerificationKey{chainID: chainID, digest: sha256.Sum256(payload)}
	if tx, ok := cache.lookup(key, payload); ok {
		return tx, nil
	}
	// Own the miss bytes before decoding/verifying and retaining them. Neither
	// caller-buffer reuse nor a returned transaction value can alter an entry.
	canonical := string(payload)
	owned := []byte(canonical)
	key.digest = sha256.Sum256(owned)
	tx, err := DecodeSignedTransaction(owned)
	if err != nil {
		return SignedTransaction{}, err
	}
	if err := tx.Verify(chainID); err != nil {
		return SignedTransaction{}, err
	}
	cache.rememberVerified(key, canonical, tx)
	return tx, nil
}
