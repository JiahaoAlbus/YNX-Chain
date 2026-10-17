package main

import (
	"sort"
	"time"
)

type inclusionBlock struct {
	Height                    int64     `json:"height"`
	Time                      time.Time `json:"signedBlockTime"`
	BlockHash                 string    `json:"blockHash"`
	ObservedValidTransactions int       `json:"observedValidWorkloadTransactions"`
	ProofTotal                int64     `json:"merkleProofTotalTransactions"`
	Complete                  bool      `json:"allBlockTransactionsObservedValid"`
	indices                   map[uint32]bool
	consistent                bool
}

type blockStatistics struct {
	Blocks                          []inclusionBlock `json:"blocks"`
	CompleteObservedBlockCoverage   bool             `json:"completeObservedBlockCoverage"`
	ActiveOfferInteriorIntervals    int              `json:"activeOfferInteriorIntervals"`
	ActiveOfferInteriorTransactions int              `json:"activeOfferInteriorTransactions"`
	ActiveOfferInteriorSeconds      float64          `json:"activeOfferInteriorSeconds"`
	ActiveOfferInteriorTPS          *float64         `json:"activeOfferInteriorEffectiveTPS"`
	Interpretation                  string           `json:"interpretation"`
}

func summarizeBlocks(results []transactionResult) blockStatistics {
	s := blockStatistics{Interpretation: "Only complete consecutive interior blocks within the offer window contribute. Interior TPS is withheld if observed block coverage has a gap or incomplete block, avoiding selection of successful intervals. This finite observation is not sustained/steady-state qualification."}
	byHeight := map[int64]*inclusionBlock{}
	var firstOffer, lastOffer time.Time
	for _, r := range results {
		if r.OfferedAt != nil {
			if firstOffer.IsZero() || r.OfferedAt.Before(firstOffer) {
				firstOffer = *r.OfferedAt
			}
			if lastOffer.IsZero() || r.OfferedAt.After(lastOffer) {
				lastOffer = *r.OfferedAt
			}
		}
		if !verifiedBusinessInclusion(r) || r.BlockTime == nil || r.BlockTxTotal < 1 {
			continue
		}
		block := byHeight[r.Height]
		if block == nil {
			block = &inclusionBlock{Height: r.Height, Time: *r.BlockTime, BlockHash: r.BlockHash, ProofTotal: r.BlockTxTotal, indices: map[uint32]bool{}, consistent: true}
			byHeight[r.Height] = block
		}
		if block.BlockHash != r.BlockHash || !block.Time.Equal(*r.BlockTime) || block.ProofTotal != r.BlockTxTotal || int64(r.BlockTxIndex) >= r.BlockTxTotal || block.indices[r.BlockTxIndex] {
			block.consistent = false
		}
		block.indices[r.BlockTxIndex] = true
		block.ObservedValidTransactions++
	}
	for _, block := range byHeight {
		block.Complete = block.consistent && int64(block.ObservedValidTransactions) == block.ProofTotal && len(block.indices) == block.ObservedValidTransactions
		s.Blocks = append(s.Blocks, *block)
	}
	sort.Slice(s.Blocks, func(i, j int) bool { return s.Blocks[i].Height < s.Blocks[j].Height })
	s.CompleteObservedBlockCoverage = len(s.Blocks) > 0
	for i, block := range s.Blocks {
		if !block.Complete || (i > 0 && block.Height != s.Blocks[i-1].Height+1) {
			s.CompleteObservedBlockCoverage = false
		}
	}
	for _, r := range results {
		if r.Round > 1 {
			s.Interpretation = "Repeated rounds contain finality barriers. Full block observations are retained, but active-offer interior TPS is withheld; full-window throughput includes all barriers and drain. This is not sustained capacity."
			return s
		}
	}
	for i := 1; i < len(s.Blocks)-1; i++ {
		previous, current := s.Blocks[i-1], s.Blocks[i]
		if !previous.Complete || !current.Complete || current.Height != previous.Height+1 || firstOffer.IsZero() || previous.Time.Before(firstOffer) || current.Time.After(lastOffer) {
			continue
		}
		seconds := current.Time.Sub(previous.Time).Seconds()
		if seconds <= 0 {
			continue
		}
		s.ActiveOfferInteriorIntervals++
		s.ActiveOfferInteriorTransactions += current.ObservedValidTransactions
		s.ActiveOfferInteriorSeconds += seconds
	}
	if s.ActiveOfferInteriorSeconds > 0 && s.CompleteObservedBlockCoverage {
		rate := float64(s.ActiveOfferInteriorTransactions) / s.ActiveOfferInteriorSeconds
		s.ActiveOfferInteriorTPS = &rate
	}
	return s
}
