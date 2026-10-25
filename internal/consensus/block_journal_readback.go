package consensus

import (
	"bytes"
	"context"
	"errors"

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
	if err := witness.valid(); err != nil {
		return BlockJournalReadback{}, err
	}
	migration := witness.migration
	var result BlockJournalReadback
	if err := ctx.Err(); err != nil {
		return result, err
	}
	header := []byte(blockJournalMagic + migration.StateHash + "\n")
	if len(data) > blockJournalMaxFrame+blockJournalCheckpointBlocks*(2*blockJournalMaxRequest+snapshotJournalHeader)+len(header) {
		return result, errors.New("block journal readback exceeds bounded capacity")
	}
	j := &blockJournal{io: &snapshotJournal{header: header}}
	state, err := replayBlockJournalOwned(ctx, bytes.NewReader(data), witness, j, facts, authority)
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
	return BlockJournalReadback{State: state, SnapshotJSON: payload, CompleteBytes: int(j.io.end), IncompleteTail: j.io.end < int64(len(data)), ReplayedBlocks: j.blocks, ReplayedTransactionInputs: j.replayedTxInputs}, nil
}
