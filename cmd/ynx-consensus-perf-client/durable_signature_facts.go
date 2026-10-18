package main

import (
	"crypto/sha256"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const durableSignatureCapacity = 2048
const durableSignatureStringLimit = 2 << 20

type durableSignatureKey struct {
	chain  int64
	digest [sha256.Size]byte
}
type durableSignatureFact struct {
	raw   string
	tx    consensus.SignedTransaction
	bytes int
}
type durableSignatureStats struct {
	Entries     int    `json:"entries"`
	StringBytes int    `json:"retainedStringBytes"`
	Hits        uint64 `json:"hits"`
	Verified    uint64 `json:"successfulVerifications"`
	Capacity    int    `json:"capacity"`
	StringLimit int    `json:"stringLimit"`
}

// Successful cryptographic facts only. Current-file freshness, decoded state,
// fee membership and nonce are always checked independently by the reader.
type durableSignatureFacts struct {
	mu             sync.Mutex
	entries        map[durableSignatureKey]durableSignatureFact
	order          [durableSignatureCapacity]durableSignatureKey
	head           int
	bytes          int
	hits, verified uint64
}

func (c *durableSignatureFacts) decode(raw []byte, chain int64) (consensus.SignedTransaction, error) {
	key := durableSignatureKey{chain: chain, digest: sha256.Sum256(raw)}
	c.mu.Lock()
	fact, found := c.entries[key]
	if found && fact.raw == string(raw) {
		c.hits++
		c.mu.Unlock()
		return fact.tx, nil
	}
	c.mu.Unlock()
	// Own miss bytes before validation and retention; callers can reuse buffers.
	owned := string(raw)
	tx, err := consensus.DecodeSignedTransaction([]byte(owned))
	if err != nil {
		return consensus.SignedTransaction{}, err
	}
	if err := tx.Verify(chain); err != nil {
		return consensus.SignedTransaction{}, err
	}
	key.digest = sha256.Sum256([]byte(owned))
	cost := len(owned) + len(tx.Type) + len(tx.From) + len(tx.To) + len(tx.PublicKey) + len(tx.Signature)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.verified++
	if _, exists := c.entries[key]; exists || cost > durableSignatureStringLimit {
		return tx, nil
	}
	if c.entries == nil {
		c.entries = make(map[durableSignatureKey]durableSignatureFact)
	}
	for len(c.entries) >= durableSignatureCapacity || c.bytes+cost > durableSignatureStringLimit {
		old := c.order[c.head]
		c.bytes -= c.entries[old].bytes
		delete(c.entries, old)
		c.head = (c.head + 1) % durableSignatureCapacity
	}
	c.order[(c.head+len(c.entries))%durableSignatureCapacity] = key
	c.entries[key] = durableSignatureFact{raw: owned, tx: tx, bytes: cost}
	c.bytes += cost
	return tx, nil
}

func (c *durableSignatureFacts) stats() durableSignatureStats {
	c.mu.Lock()
	defer c.mu.Unlock()
	return durableSignatureStats{Entries: len(c.entries), StringBytes: c.bytes, Hits: c.hits, Verified: c.verified, Capacity: durableSignatureCapacity, StringLimit: durableSignatureStringLimit}
}
