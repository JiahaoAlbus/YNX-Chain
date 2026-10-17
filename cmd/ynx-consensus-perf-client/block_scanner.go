package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/merkle"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	blockScanCacheBytes    = 8 << 20
	blockScanCacheBlocks   = 16
	blockScanStepsPerPoll  = 8
	blockScanWindowHeights = 128
)

var errBlockScanNotReady = errors.New("block inclusion not observed yet")

type blockObservationClient interface {
	observationClient
	Block(context.Context, *int64) (*coretypes.ResultBlock, error)
	BlockResults(context.Context, *int64) (*coretypes.ResultBlockResults, error)
}

type scannedBlock struct {
	commit *coretypes.ResultCommit
	txs    map[string]*coretypes.ResultTx
	bytes  int
}

// One worker owns a node's scanner. Only authenticated blocks advance next;
// cached signed headers/proofs own their bytes, and no cache entry is a durable
// execution receipt. Current disk bytes and published Info remain mandatory.
type blockInclusionScanner struct {
	manifest    consensus.EphemeralNetworkManifest
	trusted     *cmttypes.ValidatorSet
	client      blockObservationClient
	stats       *groupedObservationStats
	start, next int64
	blocks      []*scannedBlock
	bytes       int
	poisoned    error
}

func (s *blockInclusionScanner) fatal(err error) error { s.poisoned = err; return err }

func (s *blockInclusionScanner) refresh(ctx context.Context) error {
	if s.poisoned != nil {
		return s.poisoned
	}
	if err := observationDeadline(ctx); err != nil {
		return err
	}
	if s.start <= 0 || s.next < s.start {
		return s.fatal(errors.New("invalid block scanner start"))
	}
	s.stats.BlockQueries++
	latest, err := s.client.Block(ctx, nil)
	if err != nil {
		return fmt.Errorf("%w: latest block query: %v", errBlockScanNotReady, err)
	}
	if err := s.validateEnvelope(latest, 0); err != nil {
		return s.fatal(err)
	}
	tip := latest.Block.Height
	if tip < s.next-1 {
		return s.fatal(errors.New("block scanner tip regressed"))
	}
	if tip < s.start {
		return errBlockScanNotReady
	}
	if tip-s.start >= blockScanWindowHeights {
		return s.fatal(errors.New("block scanner finite height bound exceeded"))
	}
	for steps := 0; s.next <= tip && steps < blockScanStepsPerPoll; steps++ {
		if err := observationDeadline(ctx); err != nil {
			return err
		}
		height := s.next
		block := latest
		if height != tip {
			s.stats.BlockQueries++
			block, err = s.client.Block(ctx, &height)
			if err != nil {
				return fmt.Errorf("%w: block query: %v", errBlockScanNotReady, err)
			}
		}
		if err := s.validateEnvelope(block, height); err != nil {
			return s.fatal(err)
		}
		s.stats.CommitQueries++
		commit, err := s.client.Commit(ctx, &height)
		if err != nil {
			return fmt.Errorf("%w: commit query: %v", errBlockScanNotReady, err)
		}
		page, perPage := 1, 100
		s.stats.ValidatorQueries++
		validators, err := s.client.Validators(ctx, &height, &page, &perPage)
		if err != nil {
			return fmt.Errorf("%w: validators query: %v", errBlockScanNotReady, err)
		}
		s.stats.QuorumVerifications++
		if err := verifyBlockConfirmation(s.manifest, s.trusted, validators, commit, height); err != nil {
			return s.fatal(err)
		}
		if !bytes.Equal(block.Block.Header.Hash(), commit.Header.Hash()) || !block.BlockID.Equals(commit.Commit.BlockID) {
			return s.fatal(errors.New("scanned block differs from authenticated commit"))
		}
		s.stats.BlockResultsQueries++
		results, err := s.client.BlockResults(ctx, &height)
		if err != nil {
			return fmt.Errorf("%w: block results query: %v", errBlockScanNotReady, err)
		}
		entry, err := captureScannedBlock(block, commit, results)
		if err != nil {
			return s.fatal(err)
		}
		if err := observationDeadline(ctx); err != nil {
			return err
		}
		s.blocks = append(s.blocks, entry)
		s.bytes += entry.bytes
		for len(s.blocks) > blockScanCacheBlocks || s.bytes > blockScanCacheBytes {
			s.bytes -= s.blocks[0].bytes
			s.blocks[0] = nil
			s.blocks = s.blocks[1:]
		}
		if uint64(s.bytes) > s.stats.PeakCachedBlockBytes {
			s.stats.PeakCachedBlockBytes = uint64(s.bytes)
		}
		s.next++
		s.stats.ScannedBlocks++
	}
	return nil
}

func (s *blockInclusionScanner) validateEnvelope(result *coretypes.ResultBlock, height int64) error {
	if result == nil || result.Block == nil || result.Block.Height <= 0 || result.Block.ChainID != s.manifest.ChainID || (height > 0 && result.Block.Height != height) {
		return errors.New("block query identity/height mismatch")
	}
	if err := result.Block.Header.ValidateBasic(); err != nil {
		return err
	}
	if !bytes.Equal(result.BlockID.Hash, result.Block.Header.Hash()) {
		return errors.New("block query hash mismatch")
	}
	if len(result.Block.Data.Txs) > maxTransactions {
		return errors.New("block transaction count bound exceeded")
	}
	total := 0
	for _, raw := range result.Block.Data.Txs {
		total += len(raw)
		if total > 8<<20 {
			return errors.New("block transaction byte bound exceeded")
		}
	}
	return nil
}

func captureScannedBlock(block *coretypes.ResultBlock, commit *coretypes.ResultCommit, results *coretypes.ResultBlockResults) (*scannedBlock, error) {
	if results == nil || results.Height != block.Block.Height || len(results.TxsResults) != len(block.Block.Data.Txs) {
		return nil, errors.New("block results height/count mismatch")
	}
	encoded, err := commit.SignedHeader.ToProto().Marshal()
	if err != nil {
		return nil, err
	}
	var pb cmtproto.SignedHeader
	if err = pb.Unmarshal(encoded); err != nil {
		return nil, err
	}
	owned, err := cmttypes.SignedHeaderFromProto(&pb)
	if err != nil {
		return nil, err
	}
	entry := &scannedBlock{commit: &coretypes.ResultCommit{SignedHeader: *owned, CanonicalCommit: commit.CanonicalCommit}, txs: map[string]*coretypes.ResultTx{}, bytes: len(encoded)}
	raws := make(cmttypes.Txs, len(block.Block.Data.Txs))
	leaves := make([][]byte, len(raws))
	for i, raw := range block.Block.Data.Txs {
		raws[i] = append(cmttypes.Tx(nil), raw...)
		leaves[i] = raws[i].Hash()
	}
	// Build the Merkle tree once for all members, avoiding Txs.Proof's repeated
	// construction of the complete tree for every transaction.
	root, proofs := merkle.ProofsFromByteSlices(leaves)
	if !bytes.Equal(root, owned.Header.DataHash) {
		return nil, errors.New("block payload does not match authenticated DataHash")
	}
	for i, raw := range raws {
		execution := results.TxsResults[i]
		if execution == nil || len(execution.Log) > 4096 {
			return nil, errors.New("missing or oversized execution result")
		}
		tx := &coretypes.ResultTx{Hash: leaves[i], Height: owned.Header.Height, Index: uint32(i), Tx: raw, TxResult: abci.ExecTxResult{Code: execution.Code, Log: execution.Log}, Proof: cmttypes.TxProof{RootHash: root, Data: raw, Proof: *proofs[i]}}
		key := string(tx.Hash)
		if prior := entry.txs[key]; prior != nil {
			if !bytes.Equal(prior.Tx, raw) || (prior.TxResult.Code == 0 && tx.TxResult.Code == 0) {
				return nil, errors.New("ambiguous successful transaction identity in block")
			}
			if prior.TxResult.Code == 0 {
				continue
			}
		}
		entry.txs[key] = tx
		entry.bytes += len(raw) + len(execution.Log) + 256 + 32*len(tx.Proof.Proof.Aunts)
		if entry.bytes > blockScanCacheBytes {
			return nil, errors.New("single block evidence exceeds cache bound")
		}
	}
	return entry, nil
}

func (s *blockInclusionScanner) find(raw cmttypes.Tx) (*coretypes.ResultTx, error) {
	if s.poisoned != nil {
		return nil, s.poisoned
	}
	var selected *coretypes.ResultTx
	key := string(raw.Hash())
	for _, block := range s.blocks {
		if tx := block.txs[key]; tx != nil {
			if !bytes.Equal(tx.Tx, raw) {
				return nil, s.fatal(errors.New("scanned transaction hash/bytes mismatch"))
			}
			if selected == nil || (selected.TxResult.Code != 0 && tx.TxResult.Code == 0) {
				selected = tx
				continue
			}
			if selected.TxResult.Code == 0 && tx.TxResult.Code == 0 {
				return nil, s.fatal(errors.New("successful transaction repeated at multiple heights"))
			}
		}
	}
	if selected == nil {
		return nil, errBlockScanNotReady
	}
	return selected, nil
}

func (s *blockInclusionScanner) confirmation(height int64) *coretypes.ResultCommit {
	if s.poisoned != nil {
		return nil
	}
	for _, block := range s.blocks {
		if block.commit.Header.Height == height {
			return block.commit
		}
	}
	return nil
}
