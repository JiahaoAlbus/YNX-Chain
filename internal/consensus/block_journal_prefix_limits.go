package consensus

import (
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// NewBoundedBlockJournalNativeClonePrefixDecoder is an explicit per-instance
// reader for history-growing workloads. Existing constructors retain16MiB.
// The selected limit bounds current journal input and the single canonical
// certificate; it is not a total decoded-heap/RSS budget or execution grant.
// Original signature, execution, complete-state validation and private-copy
// rules remain unchanged. A caller must separately admit the actual resource
// profile before starting any long-running nodes.
func NewBoundedBlockJournalNativeClonePrefixDecoder(migration chain.ConsensusMigrationState, limit int) (*BlockJournalPrefixDecoder, error) {
	if limit < blockJournalPrefixLimit || limit > 512<<20 {
		return nil, errors.New("explicit prefix byte limit must be16..512MiB")
	}
	d, err := NewBlockJournalNativeClonePrefixDecoder(migration)
	if err != nil {
		return nil, err
	}
	d.byteLimit = limit
	return d, nil
}

// ByteLimit is immutable after construction. It reports encoded input/canonical
// bounds only; native decoded snapshots and concurrent private clones also
// consume heap and remain subject to the external runtime RSS guard.
func (d *BlockJournalPrefixDecoder) ByteLimit() int {
	if d == nil || d.byteLimit == 0 {
		return blockJournalPrefixLimit
	}
	return d.byteLimit
}
