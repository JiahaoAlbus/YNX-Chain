package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const blockJournalPrefixLimit = 16 << 20

// BlockJournalPrefixDecoder is a separate opt-in, read-only candidate. It keeps
// one independently encoded previously validated state and exact input-prefix
// digest. It does not change DecodeBlockJournal or the node writer protocol.
// It must not be copied. Callers still capture stable current bytes and verify
// publication/quorum/business evidence independently.
type BlockJournalPrefixDecoder struct {
	full   *BlockJournalDecoder
	gate   chan struct{}
	prefix *blockJournalPrefix
}
type blockJournalPrefix struct {
	payload []byte
	digest  [sha256.Size]byte
	end     int
	blocks  int
	height  int64
}
type BlockJournalPrefixReadback struct {
	BlockJournalReadback
	ReusedPrefixBytes int
}

func NewBlockJournalPrefixDecoder(migration chain.ConsensusMigrationState) (*BlockJournalPrefixDecoder, error) {
	full, err := NewBlockJournalDecoder(migration)
	if err != nil {
		return nil, err
	}
	d := &BlockJournalPrefixDecoder{full: full, gate: make(chan struct{}, 1)}
	d.gate <- struct{}{}
	return d, nil
}
func (d *BlockJournalPrefixDecoder) Decode(ctx context.Context, data []byte) (BlockJournalPrefixReadback, error) {
	var out BlockJournalPrefixReadback
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if d == nil || d.full == nil || d.gate == nil {
		return out, errors.New("prefix decoder not initialized")
	}
	if len(data) > blockJournalPrefixLimit {
		return out, errors.New("prefix decoder input exceeds explicit16MiB bound")
	}
	select {
	case <-ctx.Done():
		return out, ctx.Err()
	case <-d.gate:
	}
	defer func() { d.gate <- struct{}{} }()
	if err := ctx.Err(); err != nil {
		return out, err
	}
	p := d.prefix
	reused := p != nil && p.end > 0 && p.end <= len(data) && sha256.Sum256(data[:p.end]) == p.digest
	logicalBlocks := 0
	if reused {
		// Always reconstruct private state and fully validate its current AppHash.
		var state CommittedState
		if err := decodeStrictJSON(p.payload, &state); err != nil {
			return out, err
		}
		if err := state.Validate(d.full.migration); err != nil {
			return out, err
		}
		if p.end == len(data) {
			// Exact complete input already certified: private decode + full
			// Validate above still ran. No suffix exists to execute or encode.
			if err := ctx.Err(); err != nil {
				return out, err
			}
			payload := append([]byte(nil), p.payload...)
			if err := ctx.Err(); err != nil {
				return out, err
			}
			return BlockJournalPrefixReadback{BlockJournalReadback: BlockJournalReadback{State: state, SnapshotJSON: payload, CompleteBytes: p.end}, ReusedPrefixBytes: p.end}, nil
		}
		replay, err := NewApplication(d.full.migration)
		if err != nil {
			return out, err
		}
		replay.committed = state
		replay.replayVerificationFacts = &d.full.native
		j := &blockJournal{io: &snapshotJournal{end: int64(p.end), records: p.blocks + 1}, blocks: p.blocks}
		next, err := replayBlockJournalFrames(ctx, bytes.NewReader(data[p.end:]), d.full.migration, j, replay)
		if err != nil {
			return out, err
		}
		payload, err := encodeCommittedStateJSON(next)
		if err != nil {
			return out, err
		}
		out.BlockJournalReadback = BlockJournalReadback{State: next, SnapshotJSON: payload, CompleteBytes: int(j.io.end), IncompleteTail: j.io.end < int64(len(data)), ReplayedBlocks: j.blocks - p.blocks, ReplayedTransactionInputs: j.replayedTxInputs}
		out.ReusedPrefixBytes = p.end
		logicalBlocks = j.blocks
	} else {
		full, err := d.full.Decode(ctx, data)
		if err != nil {
			return out, err
		}
		out.BlockJournalReadback = full
		logicalBlocks = full.ReplayedBlocks
	}
	if err := ctx.Err(); err != nil {
		return BlockJournalPrefixReadback{}, err
	}
	// Never cache failures or caller-owned objects. Older captures cannot displace
	// a newer validated state. Rotation at equal/newer height can replace it.
	if len(out.SnapshotJSON) <= blockJournalPrefixLimit && (p == nil || out.State.Height >= p.height) {
		d.prefix = &blockJournalPrefix{payload: append([]byte(nil), out.SnapshotJSON...), digest: sha256.Sum256(data[:out.CompleteBytes]), end: out.CompleteBytes, blocks: logicalBlocks, height: out.State.Height}
	}
	return out, nil
}

// VerificationStats reports only the original bounded native mathematical facts;
// prefix reuse does not manufacture new signature verifications.
func (d *BlockJournalPrefixDecoder) VerificationStats() BlockJournalVerificationStats {
	if d == nil || d.full == nil {
		return BlockJournalVerificationStats{}
	}
	return d.full.VerificationStats()
}
