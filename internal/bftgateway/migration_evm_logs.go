package bftgateway

import (
	"context"
	"errors"
	"reflect"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// importedEVMLogs returns unchanged native provenance events. The range query
// is complete before address/topics filtering; source coordinates are checked
// against the corresponding original blocks, never replaced by Comet indexes.
func (g *Gateway) importedEVMLogs(ctx context.Context, filter committedEVMLogFilter) ([]map[string]any, error) {
	if filter.to > g.migrationHeight {
		return nil, errors.New("original log range exceeds the configured migration boundary")
	}
	if err := validateCommittedLogRange(filter.from, filter.to); err != nil {
		return nil, err
	}
	var view consensus.MigrationHistoryLogsView
	height, err := g.queryMigrationHistory(ctx, consensus.MigrationHistoryLogsPath+strconv.FormatUint(filter.from, 10)+"/"+strconv.FormatUint(filter.to, 10), &view)
	if err != nil {
		return nil, err
	}
	if err := g.validateMigrationHistory(ctx, view.MigrationHistoryAnchor, height); err != nil {
		return nil, err
	}
	if view.From != filter.from || view.To != filter.to || view.Logs == nil {
		return nil, errors.New("original log response differs from the complete requested range")
	}
	// A logs response alone cannot identify a wholly omitted block (including
	// an incorrectly empty response). Read the compact inventory independently,
	// then check only its nonempty blocks. Empty heights cause no block RPCs.
	var inventory consensus.MigrationHistoryLogBlocksView
	inventoryHeight, err := g.queryMigrationHistory(ctx, consensus.MigrationHistoryLogBlocksPath+strconv.FormatUint(filter.from, 10)+"/"+strconv.FormatUint(filter.to, 10), &inventory)
	if err != nil {
		return nil, err
	}
	if err := g.validateMigrationHistory(ctx, inventory.MigrationHistoryAnchor, inventoryHeight); err != nil {
		return nil, err
	}
	if inventory.MigrationHistoryAnchor != view.MigrationHistoryAnchor || inventory.From != filter.from || inventory.To != filter.to || inventory.Blocks == nil || uint64(len(inventory.Blocks)) > filter.to-filter.from+1 {
		return nil, errors.New("original log inventory differs from the complete requested range or import")
	}
	var total, previous uint64
	for index, block := range inventory.Blocks {
		if block.Height < filter.from || block.Height > filter.to || index > 0 && block.Height <= previous || block.Count == 0 || block.Count > uint64(len(view.Logs))-total {
			return nil, errors.New("original log inventory has invalid heights, counts or order")
		}
		total += block.Count
		previous = block.Height
	}
	if total != uint64(len(view.Logs)) {
		return nil, errors.New("original logs omit or add events from the complete source inventory")
	}
	result := make([]map[string]any, 0, len(view.Logs))
	start := 0
	for _, block := range inventory.Blocks {
		// The complete count check above bounds this conversion and slice.
		end := start + int(block.Count)
		for _, log := range view.Logs[start:end] {
			if log.BlockNumber != block.Height {
				return nil, errors.New("original log blocks differ from the complete source inventory")
			}
		}
		originals, err := g.importedLogsAtHeight(ctx, block.Height, view.MigrationHistoryAnchor)
		if err != nil {
			return nil, err
		}
		if !reflect.DeepEqual(view.Logs[start:end], originals) {
			return nil, errors.New("original log fields, complete block events or coordinates differ from source history")
		}
		for _, log := range view.Logs[start:end] {
			if !committedLogMatches(consensus.BFTEVMLog{Address: log.Address, Topics: log.Topics}, filter) {
				continue
			}
			result = append(result, map[string]any{
				"address": log.Address, "topics": log.Topics, "data": log.Data,
				"blockHash": log.BlockHash, "blockNumber": hexEVMQuantity(log.BlockNumber),
				"transactionHash": log.TransactionHash, "transactionIndex": hexEVMQuantity(log.TransactionIndex),
				"logIndex": hexEVMQuantity(log.LogIndex), "removed": log.Removed,
				"ynxSourceHistory": view.MigrationHistoryAnchor, "independentFinality": false,
			})
		}
		start = end
	}
	return result, nil
}

func (g *Gateway) importedLogsAtHeight(ctx context.Context, blockHeight uint64, anchor consensus.MigrationHistoryAnchor) ([]chain.EVMLog, error) {
	var view consensus.MigrationHistoryBlockView
	height, err := g.queryMigrationHistory(ctx, consensus.MigrationHistoryBlockPath+strconv.FormatUint(blockHeight, 10), &view)
	if err != nil {
		return nil, err
	}
	if err := g.validateMigrationHistory(ctx, view.MigrationHistoryAnchor, height); err != nil {
		return nil, err
	}
	if view.MigrationHistoryAnchor != anchor || !view.Found || view.Block == nil {
		return nil, errors.New("original logs have no matching source block")
	}
	block := view.Block
	if block.Height != blockHeight || block.Height > anchor.MigrationHeight || !identityHash(block.Hash) || block.Height == 0 && block.Hash != anchor.OriginalGenesisHash || block.Height == anchor.MigrationHeight && block.Hash != anchor.MigrationBlockHash {
		return nil, errors.New("original log block identity differs from its source range")
	}
	logs := make([]chain.EVMLog, 0)
	for index, tx := range block.Transactions {
		if tx.BlockNum != blockHeight || tx.BlockHash != block.Hash || !sourceTransactionHash(tx.Hash) {
			return nil, errors.New("original log transaction has inconsistent source block coordinates")
		}
		for _, log := range tx.Logs {
			if log.BlockNumber != blockHeight || log.BlockHash != "0x"+block.Hash || log.TransactionHash != tx.Hash || log.TransactionIndex != uint64(index) || log.LogIndex != uint64(len(logs)) || log.Removed {
				return nil, errors.New("original log has inconsistent source transaction coordinates")
			}
			logs = append(logs, log)
		}
	}
	return logs, nil
}
