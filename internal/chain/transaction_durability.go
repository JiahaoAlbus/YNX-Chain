package chain

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
)

// TransactionDurabilityVersion is independent of the fee and execution model.
// It attests only to this node's completed local snapshot write, not consensus.
const TransactionDurabilityVersion = "ynx-local-durability-v1"

type TransactionDurability struct {
	Status                 string
	CheckpointHeight       uint64
	CheckpointHash         string
	SnapshotIntegrity      string
	FeesThroughTransaction []int64
}

type transactionCheckpoint struct {
	height       uint64
	hash         string
	integrity    string
	transactions map[string]checkpointTransaction
	blockFees    map[uint64][]int64
}

type checkpointTransaction struct {
	fingerprint [32]byte
	index       int
	mined       bool
}

func transactionFingerprint(tx Transaction) ([32]byte, error) {
	encoded, err := json.Marshal(tx)
	return sha256.Sum256(encoded), err
}

func checkpointForSnapshot(snapshot devnetSnapshot) (*transactionCheckpoint, error) {
	cp := &transactionCheckpoint{integrity: snapshot.StateIntegrity, transactions: map[string]checkpointTransaction{}, blockFees: map[uint64][]int64{}}
	if len(snapshot.Blocks) > 0 {
		tip := snapshot.Blocks[len(snapshot.Blocks)-1]
		cp.height, cp.hash = tip.Height, tip.Hash
	}
	add := func(tx Transaction, index int, mined bool) error {
		fingerprint, err := transactionFingerprint(tx)
		if err != nil {
			return fmt.Errorf("checkpoint transaction fingerprint: %w", err)
		}
		cp.transactions[tx.Hash] = checkpointTransaction{fingerprint: fingerprint, index: index, mined: mined}
		return nil
	}
	for _, block := range snapshot.Blocks {
		for index, tx := range block.Transactions {
			if tx.BlockNum != block.Height || tx.BlockHash != block.Hash {
				return nil, fmt.Errorf("checkpoint transaction inclusion does not match block")
			}
			cp.blockFees[block.Height] = append(cp.blockFees[block.Height], tx.Fee)
			if err := add(tx, index, true); err != nil {
				return nil, err
			}
		}
	}
	for _, tx := range snapshot.Pending {
		if err := add(tx, 0, false); err != nil {
			return nil, err
		}
	}
	return cp, nil
}

func checkpointCovers(cp *transactionCheckpoint, tx Transaction) bool {
	if cp == nil {
		return false
	}
	want, ok := cp.transactions[tx.Hash]
	if !ok {
		return false
	}
	got, err := transactionFingerprint(tx)
	return err == nil && got == want.fingerprint
}

func (d *Devnet) transactionCheckpointCovers(tx Transaction) bool {
	return checkpointCovers(d.durableCheckpoint.Load(), tx)
}

// TransactionWithDurability reads the transaction and exact checkpoint evidence
// together. Full transaction fingerprints bind fields/logs and inclusion; merely
// matching a tip height or an admission hash would accept unpersisted blocks.
// A disk read alone never creates a checkpoint: the constructor re-saves it.
func (d *Devnet) TransactionWithDurability(hash string) (Transaction, TransactionDurability, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	tx, found := d.transactionLocked(hash)
	status := TransactionDurability{Status: "uncertain"}
	if !found {
		status.Status = "not_found"
		return tx, status, false
	}
	if d.dataDir == "" {
		status.Status = "memory_only"
		return tx, status, true
	}
	cp := d.durableCheckpoint.Load()
	if !checkpointCovers(cp, tx) {
		return tx, status, true
	}
	status = TransactionDurability{Status: "pending_durable", CheckpointHeight: cp.height, CheckpointHash: cp.hash, SnapshotIntegrity: cp.integrity}
	entry := cp.transactions[tx.Hash]
	if entry.mined && tx.BlockNum > 0 && tx.BlockNum <= cp.height {
		status.Status = "durable"
		// Fees/index come from the same immutable checkpoint as the tx, never
		// a second live-block query that could observe another replication state.
		status.FeesThroughTransaction = append([]int64(nil), cp.blockFees[tx.BlockNum][:entry.index+1]...)
	}
	return tx, status, true
}

// retainedCheckpoint keeps only prior, already-fsynced transaction evidence
// whose exact fingerprint/inclusion also occurs in the proposed replacement.
// New admissions and pending-to-mined transitions gain no evidence here.
func retainedCheckpoint(prior, next *transactionCheckpoint, snapshot devnetSnapshot) *transactionCheckpoint {
	if prior == nil || next == nil || prior.integrity == "" {
		return nil
	}
	tipRetained := false
	if prior.height < uint64(len(snapshot.Blocks)) {
		b := snapshot.Blocks[prior.height]
		tipRetained = b.Height == prior.height && b.Hash == prior.hash
	}
	if !tipRetained {
		return nil
	}
	for height, fees := range prior.blockFees {
		other := next.blockFees[height]
		if len(other) != len(fees) {
			return nil
		}
		for i, fee := range fees {
			if fee != other[i] {
				return nil
			}
		}
	}
	retained := &transactionCheckpoint{height: prior.height, hash: prior.hash, integrity: prior.integrity, transactions: make(map[string]checkpointTransaction), blockFees: prior.blockFees}
	for hash, entry := range prior.transactions {
		if candidate, ok := next.transactions[hash]; ok && candidate == entry {
			retained.transactions[hash] = entry
		}
	}
	return retained
}
