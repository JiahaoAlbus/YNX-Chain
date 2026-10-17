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
	state, err := replayBlockJournal(ctx, bytes.NewReader(data), migration, j)
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
