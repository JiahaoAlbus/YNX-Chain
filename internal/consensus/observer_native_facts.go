package consensus

import "crypto/sha256"

// LookupVerifiedNativeForObserver reads decoder-owned successful immutable
// facts. A miss never certifies a transaction and never inserts an entry.
// expectedChainID binds the observer separately to this decoder migration.
// Observer hits do not change replay counters or authorize state execution.
func (d *BlockJournalPrefixDecoder) LookupVerifiedNativeForObserver(payload []byte, expectedChainID int64) (SignedTransaction, bool) {
	if d == nil || d.full == nil || expectedChainID != d.full.migration.Network.ChainID || len(payload) == 0 || len(payload) > MaxSignedTransactionSize {
		return SignedTransaction{}, false
	}
	c := &d.full.native
	key := nativeVerificationKey{chainID: d.full.migration.Network.ChainID, digest: sha256.Sum256(payload)}
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || entry.payload != string(payload) {
		return SignedTransaction{}, false
	}
	return entry.tx, true
}
