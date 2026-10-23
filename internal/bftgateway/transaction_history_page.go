package bftgateway

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

type ImportedTransactionReference struct {
	Hash        string `json:"hash"`
	Type        string `json:"type"`
	Height      uint64 `json:"height"`
	NativeIndex uint32 `json:"nativeIndex,string"`
}

// Preserve the existing Whole, unsupported-envelope and ordinary projection
// rules for both list readers. Imported rows never enter this Comet projector.
func (g *Gateway) projectTransactionRows(ctx context.Context, rows []cometTx) (TransactionList, error) {
	result := TransactionList{TransactionOrder: make([]CometTransactionReference, 0, len(rows)), Transactions: make([]chain.Transaction, 0, len(rows))}
	for _, row := range rows {
		if isWholeEnvelope(row.Tx) {
			view, err := g.projectPQWhole(ctx, row)
			if err != nil {
				return TransactionList{}, err
			}
			result.PQBatches = append(result.PQBatches, compactWhole(view))
			result.TransactionOrder = append(result.TransactionOrder, CometTransactionReference{Hash: view.ABCITransactionHash, Type: consensus.PQWholeType, CometIndex: row.Index, Height: view.ExecutionHeight})
			continue
		}
		ref, unsupported, err := unmappedPQTransaction(row)
		if err != nil {
			return TransactionList{}, err
		}
		if unsupported {
			result.UnmappedTransactions = append(result.UnmappedTransactions, ref)
			result.TransactionOrder = append(result.TransactionOrder, ref)
			continue
		}
		mapped, err := g.mapCometTransaction(ctx, row)
		if err != nil {
			return TransactionList{}, err
		}
		result.Transactions = append(result.Transactions, mapped)
		result.TransactionOrder = append(result.TransactionOrder, CometTransactionReference{Hash: mapped.Hash, Type: mapped.Type, CometIndex: row.Index, Height: mapped.BlockNum})
	}
	return result, nil
}

func historyWindowRows(total, offset, limit uint64) uint64 {
	if offset >= total {
		return 0
	}
	if total-offset < limit {
		return total - offset
	}
	return limit
}

// Comet rows are bounded to the ABCI height captured before either namespace
// is read. A later new block cannot move the page's C/S boundary mid-request.
func (g *Gateway) historicalCometRows(ctx context.Context, upper int64, page, limit int) ([]cometTx, uint64, error) {
	query := url.Values{"query": {fmt.Sprintf(`"tx.height > %d AND tx.height <= %d"`, g.migrationHeight, upper)}, "prove": {"true"}, "page": {strconv.Itoa(page)}, "per_page": {strconv.Itoa(limit)}, "order_by": {`"desc"`}}
	var upstream cometTxSearch
	if err := g.client.getBounded(ctx, "/tx_search", query, &upstream, int64(limit)*(2<<20)+(64<<10)); err != nil {
		return nil, 0, err
	}
	if upstream.Error != nil {
		return nil, 0, errors.New(cometError(upstream.Error))
	}
	total, err := strconv.ParseUint(upstream.Result.TotalCount, 10, 64)
	if err != nil || strconv.FormatUint(total, 10) != upstream.Result.TotalCount {
		return nil, 0, errors.New("Comet history search returned a noncanonical total")
	}
	offset := uint64(page-1) * uint64(limit)
	if uint64(len(upstream.Result.Txs)) != historyWindowRows(total, offset, uint64(limit)) {
		return nil, 0, errors.New("Comet history search row count differs from its total/window")
	}
	seen := make(map[string]bool, len(upstream.Result.Txs))
	var priorHeight int64
	var priorIndex uint32
	for index, row := range upstream.Result.Txs {
		height, err := identityHeight(row.Height)
		hash := strings.ToLower(row.Hash)
		if err != nil || height <= 0 || uint64(height) <= g.migrationHeight || height > upper || len(row.Tx) == 0 || !identityHash(hash) || !strings.EqualFold(strings.TrimPrefix(consensus.SignedTransactionHash(row.Tx), "0x"), row.Hash) || seen[hash] || index > 0 && (height > priorHeight || height == priorHeight && row.Index >= priorIndex) {
			return nil, 0, errors.New("Comet history search substituted a hash, height, order or duplicate row")
		}
		seen[hash], priorHeight, priorIndex = true, height, row.Index
	}
	return upstream.Result.Txs, total, nil
}

func (g *Gateway) transactionHistoryPage(ctx context.Context, page, limit int) (TransactionList, error) {
	var metadata consensus.MigrationHistoryPageView
	upper, err := g.queryMigrationHistory(ctx, consensus.MigrationHistoryPagePath+"0/0", &metadata)
	if err != nil {
		return TransactionList{}, err
	}
	if err := g.validateMigrationHistory(ctx, metadata.MigrationHistoryAnchor, upper); err != nil {
		return TransactionList{}, err
	}
	if metadata.Offset != 0 || metadata.Limit != 0 || metadata.Records == nil || len(metadata.Records) != 0 {
		return TransactionList{}, errors.New("source history metadata contains an unexpected window or records")
	}
	offset := uint64(page-1) * uint64(limit)
	searchPage, searchLimit := page, limit
	if page > 1 {
		searchPage, searchLimit = 1, 1
	}
	rows, cometTotal, err := g.historicalCometRows(ctx, upper, searchPage, searchLimit)
	if err != nil {
		return TransactionList{}, err
	}
	if metadata.Total > math.MaxUint64-cometTotal {
		return TransactionList{}, errors.New("combined transaction history total overflows")
	}
	total := cometTotal + metadata.Total
	if page > 1 {
		probe := rows
		rows = nil
		if offset < cometTotal {
			var observedTotal uint64
			rows, observedTotal, err = g.historicalCometRows(ctx, upper, page, limit)
			if err != nil {
				return TransactionList{}, err
			}
			if observedTotal != cometTotal {
				return TransactionList{}, errors.New("Comet history total changed within one fixed-height page")
			}
			for _, row := range rows {
				if len(probe) > 0 && strings.EqualFold(row.Hash, probe[0].Hash) {
					return TransactionList{}, errors.New("Comet history repeated the probe row on a later page")
				}
			}
		}
	}
	result, err := g.projectTransactionRows(ctx, rows)
	if err != nil {
		return TransactionList{}, err
	}
	wanted := historyWindowRows(total, offset, uint64(limit))
	if uint64(len(rows)) > wanted {
		return TransactionList{}, errors.New("Comet history exceeds the combined page window")
	}
	seen := make(map[string]bool, int(wanted))
	for _, row := range result.TransactionOrder {
		hash := strings.TrimPrefix(strings.ToLower(row.Hash), "0x")
		if seen[hash] {
			return TransactionList{}, errors.New("Comet history repeated a projected transaction identity")
		}
		seen[hash] = true
	}
	sourceCount := wanted - uint64(len(rows))
	if sourceCount > 0 {
		sourceOffset := uint64(0)
		if offset > cometTotal {
			sourceOffset = offset - cometTotal
		}
		var source consensus.MigrationHistoryPageView
		height, err := g.queryMigrationHistory(ctx, consensus.MigrationHistoryPagePath+strconv.FormatUint(sourceOffset, 10)+"/"+strconv.FormatUint(sourceCount, 10), &source)
		if err != nil {
			return TransactionList{}, err
		}
		if height < upper || source.MigrationHistoryAnchor != metadata.MigrationHistoryAnchor || source.Offset != sourceOffset || uint64(source.Limit) != sourceCount || source.Total != metadata.Total || source.Records == nil || uint64(len(source.Records)) != sourceCount {
			return TransactionList{}, errors.New("source history changed its anchor, total, coordinates or row count")
		}
		var prior consensus.MigrationHistoryPageEntry
		for index, entry := range source.Records {
			tx := entry.Transaction
			hash := strings.TrimPrefix(tx.Hash, "0x")
			if !sourceTransactionHash(tx.Hash) || !identityHash(tx.BlockHash) || tx.Type == "" || tx.BlockNum > g.migrationHeight || tx.BlockNum == 0 && tx.BlockHash != source.OriginalGenesisHash || tx.BlockNum == g.migrationHeight && tx.BlockHash != g.migrationBlockHash || seen[hash] || index > 0 && (tx.BlockNum > prior.Transaction.BlockNum || tx.BlockNum == prior.Transaction.BlockNum && (tx.BlockHash != prior.Transaction.BlockHash || uint64(entry.NativeIndex)+1 != uint64(prior.NativeIndex))) {
				return TransactionList{}, errors.New("source history substituted a record, order or duplicate native row")
			}
			seen[hash], prior = true, entry
			result.Transactions = append(result.Transactions, tx)
			result.ImportedTransactionOrder = append(result.ImportedTransactionOrder, ImportedTransactionReference{Hash: tx.Hash, Type: tx.Type, Height: tx.BlockNum, NativeIndex: entry.NativeIndex})
		}
	}
	result.ImportedHistory, result.CometHistoryUpperHeight = &metadata.MigrationHistoryAnchor, upper
	result.Page, result.Limit, result.Total, result.TruthfulStatus = page, limit, total, "cometbft-and-imported-source-history-backed"
	if offset+uint64(limit) < total {
		next := page + 1
		result.NextPage = &next
	}
	return result, nil
}
