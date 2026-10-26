package consensus

import (
	"bytes"
	"context"
	"errors"
	"io"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type BlockJournalReadback struct {
	State                     CommittedState
	SnapshotJSON              []byte // independently owned canonical reconstructed state
	CompleteBytes             int
	IncompleteTail            bool
	ReplayedBlocks            int
	ReplayedTransactionInputs int
}

func IsBlockJournal(data []byte) bool { return bytes.HasPrefix(data, []byte(blockJournalMagic)) }

// DecodeBlockJournal reuses the node's exact checkpoint/delta replay without
// opening a file, acquiring a writer lease, Sync, truncation or submission.
// Live callers must separately lock stable input and corroborate published Info.
func DecodeBlockJournal(ctx context.Context, data []byte, migration chain.ConsensusMigrationState) (BlockJournalReadback, error) {
	return decodeBlockJournalWithFacts(ctx, data, migration, nil)
}

// DecodeBlockJournalReader reuses the identical checkpoint/delta decoder with
// an exact-size, read-only section. It avoids a second complete journal buffer
// and retains the known remaining size used to reject absent oversized tails.
// The caller must hold and verify the original file identity and whole SHA256;
// this function neither acquires a writer lease nor changes the source offset.
func DecodeBlockJournalReader(ctx context.Context, source io.ReaderAt, size int64, migration chain.ConsensusMigrationState) (BlockJournalReadback, error) {
	if source == nil || size < 0 {
		return BlockJournalReadback{}, errors.New("block journal reader requires an exact nonnegative source size")
	}
	witness, err := newValidatedMigration(migration, nil)
	if err != nil {
		return BlockJournalReadback{}, err
	}
	return decodeBlockJournalReaderOwned(ctx, io.NewSectionReader(source, 0, size), size, witness, nil, nil)
}

// BlockJournalDecoder retains bounded successful native cryptographic facts
// across independent full replays. It holds no reconstructed state/file data,
// and does not authorize execution, nonce advancement, publication or durability.
// The cache's own mutex permits concurrent Decode calls without sharing Apps.
// Like its mutex-containing cache, a decoder must not be copied after use.
type BlockJournalDecoder struct {
	migration          chain.ConsensusMigrationState
	validatedMigration *validatedMigration
	native             nativeVerificationCache
}

type BlockJournalVerificationStats nativeVerificationStats

func NewBlockJournalDecoder(migration chain.ConsensusMigrationState) (*BlockJournalDecoder, error) {
	witness, err := newValidatedMigration(migration, nil)
	if err != nil {
		return nil, err
	}
	return &BlockJournalDecoder{migration: witness.migration, validatedMigration: witness}, nil
}

func (d *BlockJournalDecoder) Decode(ctx context.Context, data []byte) (BlockJournalReadback, error) {
	if d == nil {
		return BlockJournalReadback{}, errors.New("missing block journal decoder")
	}
	return decodeBlockJournalOwned(ctx, data, d.validatedMigration, &d.native, nil)
}
func (d *BlockJournalDecoder) VerificationStats() BlockJournalVerificationStats {
	return BlockJournalVerificationStats(d.native.stats())
}

func decodeBlockJournalWithFacts(ctx context.Context, data []byte, migration chain.ConsensusMigrationState, facts *nativeVerificationCache) (BlockJournalReadback, error) {
	return decodeBlockJournalWithAuthority(ctx, data, migration, facts, nil)
}

func decodeBlockJournalWithAuthority(ctx context.Context, data []byte, migration chain.ConsensusMigrationState, facts *nativeVerificationCache, authority *blockJournalReplayAuthority) (BlockJournalReadback, error) {
	var bootstrap *ConsensusBootstrap
	if authority != nil {
		bootstrap = authority.bootstrap
	}
	witness, err := newValidatedMigration(migration, bootstrap)
	if err != nil {
		return BlockJournalReadback{}, err
	}
	if authority != nil {
		ownedAuthority := *authority
		ownedAuthority.bootstrap = witness.bootstrap
		authority = &ownedAuthority
	}
	return decodeBlockJournalOwned(ctx, data, witness, facts, authority)
}

func decodeBlockJournalOwned(ctx context.Context, data []byte, witness *validatedMigration, facts *nativeVerificationCache, authority *blockJournalReplayAuthority) (BlockJournalReadback, error) {
	return decodeBlockJournalReaderOwned(ctx, bytes.NewReader(data), int64(len(data)), witness, facts, authority)
}

func decodeBlockJournalReaderOwned(ctx context.Context, source io.Reader, size int64, witness *validatedMigration, facts *nativeVerificationCache, authority *blockJournalReplayAuthority) (BlockJournalReadback, error) {
	if err := witness.valid(); err != nil {
		return BlockJournalReadback{}, err
	}
	migration := witness.migration
	var result BlockJournalReadback
	if err := ctx.Err(); err != nil {
		return result, err
	}
	header := []byte(blockJournalMagic + migration.StateHash + "\n")
	if size < 0 || size > int64(blockJournalMaxFrame+blockJournalCheckpointBlocks*(2*blockJournalMaxRequest+snapshotJournalHeader)+len(header)) {
		return result, errors.New("block journal readback exceeds bounded capacity")
	}
	j := &blockJournal{io: &snapshotJournal{header: header}}
	state, err := replayBlockJournalOwned(ctx, source, witness, j, facts, authority)
	if err != nil {
		return result, err
	}
	payload, err := encodeCommittedStateJSON(state)
	if err != nil {
		return result, err
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	return BlockJournalReadback{State: state, SnapshotJSON: payload, CompleteBytes: int(j.io.end), IncompleteTail: j.io.end < size, ReplayedBlocks: j.blocks, ReplayedTransactionInputs: j.replayedTxInputs}, nil
}
