package main

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"time"
)

// Successful output work only. Failed attempts retain their separate count and
// duration; partial failed replay work is not reported as completed blocks.
type durablePrefixReplayStats struct {
	Calls                     uint64 `json:"calls"`
	FullReplays               uint64 `json:"successfulFullReplays"`
	PrefixReuses              uint64 `json:"successfulPrefixReuses"`
	Failures                  uint64 `json:"failures"`
	DurationNs                int64  `json:"durationNs"`
	ReplayedBlocks            uint64 `json:"replayedBlocks"`
	ReplayedTransactionInputs uint64 `json:"replayedTransactionInputs"`
	CanonicalByteLimit        int    `json:"canonicalByteLimit"`
}

func (r *durableReader) decodePrefixSnapshot(ctx context.Context, data []byte) (decodedDurableSnapshot, error) {
	started := time.Now()
	var result consensus.BlockJournalPrefixReadback
	var err error
	if !consensus.IsBlockJournal(data) {
		err = errors.New("prefix replay requires original block-journal input")
	} else {
		result, err = r.prefixDecoder.Decode(ctx, data)
	}
	elapsed := time.Since(started)
	r.prefixMu.Lock()
	r.prefixStats.Calls++
	r.prefixStats.DurationNs += elapsed.Nanoseconds()
	if err != nil {
		r.prefixStats.Failures++
	} else {
		if result.ReusedPrefixBytes > 0 {
			r.prefixStats.PrefixReuses++
		} else {
			r.prefixStats.FullReplays++
		}
		r.prefixStats.ReplayedBlocks += uint64(result.ReplayedBlocks)
		r.prefixStats.ReplayedTransactionInputs += uint64(result.ReplayedTransactionInputs)
	}
	r.prefixMu.Unlock()
	if err != nil {
		return decodedDurableSnapshot{}, err
	}
	return decodedDurableSnapshot{state: result.State, payload: result.SnapshotJSON, format: "block-journal", completeBytes: result.CompleteBytes, incompleteTail: result.IncompleteTail, replayedBlocks: result.ReplayedBlocks, replayedTxInputs: result.ReplayedTransactionInputs}, nil
}
