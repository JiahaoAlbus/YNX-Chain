package bftgateway

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
)

// importedEVMTransaction selects immutable original history by explicit source
// membership. Its block position is native source data, never a Comet index or
// a newly manufactured receipt. A failed source observation cannot fall back.
func (g *Gateway) importedEVMTransaction(ctx context.Context, hash string, receipt bool) (map[string]any, bool, error) {
	original, found, err := g.importedTransaction(ctx, hash)
	if err != nil || !found {
		return nil, found, err
	}
	var view consensus.MigrationHistoryBlockView
	height, err := g.queryMigrationHistory(ctx, consensus.MigrationHistoryBlockPath+strconv.FormatUint(original.BlockNum, 10), &view)
	if err != nil {
		return nil, true, err
	}
	if err := g.validateMigrationHistory(ctx, view.MigrationHistoryAnchor, height); err != nil {
		return nil, true, err
	}
	if view.MigrationHistoryAnchor != original.MigrationHistoryAnchor || !view.Found || view.Block == nil {
		return nil, true, errors.New("original Ethereum transaction has no matching source block")
	}
	block := view.Block
	if block.Height != original.BlockNum || block.Height > view.MigrationHeight || block.Hash != original.BlockHash || !identityHash(block.Hash) || block.Height == 0 && block.Hash != view.OriginalGenesisHash || block.Height == view.MigrationHeight && block.Hash != view.MigrationBlockHash {
		return nil, true, errors.New("original Ethereum source block identity differs from its transaction")
	}
	index, matches := 0, 0
	for i, tx := range block.Transactions {
		if tx.Hash == hash {
			if !reflect.DeepEqual(tx, original.Transaction) {
				return nil, true, errors.New("original Ethereum transaction differs between source queries")
			}
			index, matches = i, matches+1
		}
	}
	if matches != 1 {
		return nil, true, errors.New("original Ethereum transaction requires one unique source block position")
	}
	if receipt {
		return nil, true, errors.New("original source history has no retained Ethereum execution receipt; gas, status and receipt roots are unavailable")
	}
	eth, present, err := ethnative.FromMemo(original.Memo, original.NativeChainID)
	if err != nil {
		return nil, true, fmt.Errorf("invalid original Ethereum envelope: %w", err)
	}
	if !present {
		return nil, true, errors.New("original native transaction has no Ethereum envelope; historical Ethereum projection is unsupported")
	}
	if original.Type != "transfer" || !ethnative.Matches(eth, original.Hash, original.From, original.To, original.Amount, original.Fee, original.Nonce) {
		return nil, true, errors.New("original Ethereum envelope differs from the retained native transaction")
	}
	// FromMemo re-verifies the original bounded legacy RLP. That profile requires
	// empty calldata, a plain recipient, EIP-155 and low-S; gas is the signed gas
	// limit, not measured execution gas. Value remains the original wei quantity.
	return map[string]any{
		"hash": eth.Hash, "from": eth.From, "to": eth.To,
		"value": ethnative.Quantity(eth.Value), "nonce": hexEVMQuantity(eth.Nonce),
		"gas": hexEVMQuantity(eth.Gas), "gasPrice": ethnative.Quantity(eth.GasPrice),
		"input": "0x", "type": "0x0", "chainId": hexEVMQuantity(uint64(original.NativeChainID)),
		"v": ethnative.Quantity(eth.V), "r": fmt.Sprintf("0x%064x", eth.R), "s": fmt.Sprintf("0x%064x", eth.S),
		"blockHash": "0x" + strings.TrimPrefix(block.Hash, "0x"), "blockNumber": hexEVMQuantity(block.Height),
		"transactionIndex":       hexEVMQuantity(uint64(index)),
		"ynxTransactionEncoding": "ethereum-legacy-eip155",
		"ynxSourceHistory":       original.MigrationHistoryAnchor, "independentFinality": false,
	}, true, nil
}
