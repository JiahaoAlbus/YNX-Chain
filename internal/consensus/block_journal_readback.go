package consensus

import (
	"bytes"
	"context"
	"encoding/json"
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
	migration chain.ConsensusMigrationState
	native    nativeVerificationCache
}

type BlockJournalVerificationStats nativeVerificationStats

func NewBlockJournalDecoder(migration chain.ConsensusMigrationState) (*BlockJournalDecoder, error) {
	if err := migration.Validate(); err != nil {
		return nil, err
	}
	raw, err := migration.CanonicalJSON()
	if err != nil {
		return nil, err
	}
	d := &BlockJournalDecoder{}
	if err = json.Unmarshal(raw, &d.migration); err != nil {
		return nil, err
	}
	return d, nil
}

func (d *BlockJournalDecoder) Decode(ctx context.Context, data []byte) (BlockJournalReadback, error) {
	return decodeBlockJournalWithFacts(ctx, data, d.migration, &d.native)
}
func (d *BlockJournalDecoder) VerificationStats() BlockJournalVerificationStats {
	return BlockJournalVerificationStats(d.native.stats())
}

func decodeBlockJournalWithFacts(ctx context.Context, data []byte, migration chain.ConsensusMigrationState, facts *nativeVerificationCache) (BlockJournalReadback, error) {
	var result BlockJournalReadback
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if err := migration.Validate(); err != nil {
		return result, err
	}
	header := []byte(blockJournalMagic + migration.StateHash + "\n")
	if len(data) > blockJournalMaxFrame+blockJournalCheckpointBlocks*(2*blockJournalMaxRequest+snapshotJournalHeader)+len(header) {
		return result, errors.New("block journal readback exceeds bounded capacity")
	}
	j := &blockJournal{io: &snapshotJournal{header: header}}
	state, err := replayBlockJournalWithFacts(ctx, bytes.NewReader(data), migration, j, facts)
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
