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

// Keep the bounded stream's original suffix initializer; only certificate
// construction changes relative to the bounded native-clone control.
func NewBoundedBlockJournalCanonicalNativePrefixDecoder(migration chain.ConsensusMigrationState, limit int) (*BlockJournalPrefixDecoder, error) {
	d, err := NewBoundedBlockJournalNativeClonePrefixDecoder(migration, limit)
	if err == nil {
		d.canonicalNative = true
	}
	return d, err
}

// Same original bounds/private full validation; avoid rebuilding a genesis
// application before replaying a suffix over already validated private state.
func NewBoundedBlockJournalNativeSuffixPrefixDecoder(migration chain.ConsensusMigrationState, limit int) (*BlockJournalPrefixDecoder, error) {
	d, err := NewBoundedBlockJournalNativeClonePrefixDecoder(migration, limit)
	if err == nil {
		d.nativeSuffixSetup = true
	}
	return d, err
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

// NativeSuffixSetupEnabled reports immutable constructor selection, not a caller
// report flag. Successful replay work is measured separately in SuffixSetup.
func (d *BlockJournalPrefixDecoder) NativeSuffixSetupEnabled() bool {
	return d != nil && d.nativeSuffixSetup
}

// NewBoundedBlockJournalPreparedNativePrefixDecoder is an explicit candidate:
// privately normalize+encode only states this decoder just replayed. Original
// native clone/strict JSON paths remain fallback and all reused states still
// run full Validate. The encoded bound is unchanged; external RSS is separate.
func NewBoundedBlockJournalPreparedNativePrefixDecoder(migration chain.ConsensusMigrationState, limit int) (*BlockJournalPrefixDecoder, error) {
	d, err := NewBoundedBlockJournalNativeClonePrefixDecoder(migration, limit)
	if err == nil {
		d.preparedNative = true
	}
	return d, err
}
func (d *BlockJournalPrefixDecoder) PreparedNativePublicationEnabled() bool {
	return d != nil && d.preparedNative
}

const PreparedNativeOriginalJSON = "original-json"
const PreparedNativeFeeJSON = "fee-time-json-indent"

// NewBoundedBlockJournalPreparedNativeJSONPrefixDecoder selects only the
// prepared snapshot encoder at construction. Both encoders retain the same
// normalization, bounds, full validation, publication and independent copies.
func NewBoundedBlockJournalPreparedNativeJSONPrefixDecoder(migration chain.ConsensusMigrationState, limit int, encoding string) (*BlockJournalPrefixDecoder, error) {
	if encoding != PreparedNativeOriginalJSON && encoding != PreparedNativeFeeJSON {
		return nil, errors.New("unsupported prepared native snapshot JSON encoding")
	}
	d, err := NewBoundedBlockJournalPreparedNativePrefixDecoder(migration, limit)
	if err == nil {
		d.preparedOriginalJSON = encoding == PreparedNativeOriginalJSON
	}
	return d, err
}

func (d *BlockJournalPrefixDecoder) PreparedNativeJSONEncoding() string {
	if d == nil || !d.preparedNative {
		return ""
	}
	if d.preparedOriginalJSON {
		return PreparedNativeOriginalJSON
	}
	return PreparedNativeFeeJSON
}
