package bftgateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
)

// Only explicit native heights and successful source membership select this
// namespace. A failed source read never falls through to Comet. Latest/safe/
// finalized/pending retain the existing Comet reader's semantics.
func (g *Gateway) importedEVMBlock(ctx context.Context, byHash bool, raw json.RawMessage) (*importedBlockView, bool, int, error) {
	if g.migrationHeight == 0 {
		return nil, false, 0, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, true, -32602, errors.New("block identifier must be a string")
	}
	var path string
	var requestedHeight uint64
	if byHash {
		if !transactionHashPattern.MatchString(value) {
			return nil, true, -32602, errors.New("canonical lowercase block hash is required")
		}
		path = consensus.MigrationHistoryBlockHashPath + strings.TrimPrefix(value, "0x")
	} else {
		if err := validateCommittedBlockLookupTagSyntax(raw); err != nil {
			return nil, true, -32602, err
		}
		switch value {
		case "latest", "safe", "finalized", "pending":
			return nil, false, 0, nil
		case "earliest":
			requestedHeight = 0
		default:
			requestedHeight, _ = strconv.ParseUint(value[2:], 16, 64)
			if requestedHeight > g.migrationHeight {
				return nil, false, 0, nil
			}
		}
		path = consensus.MigrationHistoryBlockPath + strconv.FormatUint(requestedHeight, 10)
	}
	var view consensus.MigrationHistoryBlockView
	height, err := g.queryMigrationHistory(ctx, path, &view)
	if err != nil {
		return nil, true, -32603, err
	}
	if err := g.validateMigrationHistory(ctx, view.MigrationHistoryAnchor, height); err != nil {
		return nil, true, -32603, err
	}
	if view.Found != (view.Block != nil) {
		return nil, true, -32603, errors.New("source block membership and record disagree")
	}
	if !view.Found {
		if byHash {
			return nil, false, 0, nil
		}
		return nil, true, -32603, errors.New("original source block is missing inside the complete migration height range")
	}
	block := view.Block
	if block.Height > g.migrationHeight || !identityHash(block.Hash) || byHash && block.Hash != strings.TrimPrefix(value, "0x") || !byHash && block.Height != requestedHeight || block.Height == 0 && (block.Hash != view.OriginalGenesisHash || block.ParentHash != "") || block.Height > 0 && !identityHash(block.ParentHash) || block.Height == g.migrationHeight && block.Hash != g.migrationBlockHash {
		return nil, true, -32603, errors.New("source block differs from the requested identity or original migration")
	}
	seen := make(map[string]bool, len(block.Transactions))
	for _, tx := range block.Transactions {
		hash := strings.TrimPrefix(tx.Hash, "0x")
		if !sourceTransactionHash(tx.Hash) || tx.BlockNum != block.Height || tx.BlockHash != block.Hash || seen[hash] {
			return nil, true, -32603, errors.New("source block transaction differs from original hash, height or order")
		}
		seen[hash] = true
	}
	return &importedBlockView{Block: *block, MigrationHistoryAnchor: view.MigrationHistoryAnchor}, true, 0, nil
}

// Native history has no Ethereum header roots, execution gas or miner proof.
// Null fields are intentional: even an existing Comet AppHash is not evidence
// for these old blocks. The complete original block remains available inline.
func projectImportedEVMBlock(source importedBlockView, full bool) (map[string]any, error) {
	block := source.Block
	transactions := make([]any, 0, len(block.Transactions))
	for index, tx := range block.Transactions {
		if full {
			projected, err := projectImportedEVMTransaction(tx, uint64(index), source.MigrationHistoryAnchor)
			if err != nil {
				return nil, err
			}
			transactions = append(transactions, projected)
		} else {
			transactions = append(transactions, "0x"+strings.TrimPrefix(tx.Hash, "0x"))
		}
	}
	unavailable := []string{"stateRoot", "transactionsRoot", "receiptsRoot", "logsBloom", "gasLimit", "gasUsed", "miner", "baseFeePerGas", "difficulty", "totalDifficulty", "nonce", "sha3Uncles", "extraData", "size", "mixHash", "uncles"}
	result := map[string]any{
		"number": hexEVMQuantity(block.Height), "hash": "0x" + block.Hash,
		"parentHash": nil, "timestamp": nil, "transactions": transactions,
		"transactionCount": hexEVMQuantity(uint64(len(block.Transactions))),
		"ynxSourceBlock":   block, "ynxSourceHistory": source.MigrationHistoryAnchor,
		"ynxEncoding": "native-source-block", "independentFinality": false,
	}
	for _, field := range unavailable {
		result[field] = nil
	}
	if block.ParentHash != "" {
		result["parentHash"] = "0x" + block.ParentHash
	} else {
		unavailable = append(unavailable, "parentHash")
	}
	if !block.Time.IsZero() && block.Time.Unix() >= 0 {
		result["timestamp"] = hexEVMQuantity(uint64(block.Time.Unix()))
	} else {
		unavailable = append(unavailable, "timestamp")
	}
	result["ynxUnavailableFields"] = unavailable
	return result, nil
}

// A persisted legacy Ethereum memo contains an authenticated signed envelope;
// its declared gas/value/signature can be read honestly. Ordinary native rows
// have no such Ethereum envelope: preserve their original fields separately and
// leave Ethereum nonce/value/gas/signature fields null instead of inventing one.
func projectImportedEVMTransaction(tx chain.Transaction, index uint64, anchor consensus.MigrationHistoryAnchor) (map[string]any, error) {
	unknown := []string{"value", "nonce", "gas", "gasPrice", "input", "type", "chainId", "v", "r", "s", "gasUsed", "effectiveGasPrice"}
	result := map[string]any{
		"hash": "0x" + strings.TrimPrefix(tx.Hash, "0x"), "blockHash": "0x" + tx.BlockHash,
		"blockNumber": hexEVMQuantity(tx.BlockNum), "transactionIndex": hexEVMQuantity(index),
		"from": nil, "to": nil, "ynxNativeIndex": strconv.FormatUint(index, 10),
		"ynxNativeTransaction": tx, "ynxSourceHistory": anchor,
		"ynxEncoding": "native-source", "independentFinality": false,
	}
	for _, field := range unknown {
		result[field] = nil
	}
	if evmAddressPattern.MatchString(tx.From) {
		result["from"] = tx.From
	} else {
		unknown = append(unknown, "from")
	}
	if evmAddressPattern.MatchString(tx.To) {
		result["to"] = tx.To
	} else {
		unknown = append(unknown, "to")
	}
	ethereum, present, err := ethnative.FromMemo(tx.Memo, anchor.NativeChainID)
	if err != nil || present && (tx.Type != "transfer" || !ethnative.Matches(ethereum, tx.Hash, tx.From, tx.To, tx.Amount, tx.Fee, tx.Nonce)) {
		return nil, errors.New("original Ethereum memo signature or native ledger fields disagree")
	}
	if present {
		result["ynxEncoding"] = "ethereum-legacy-source"
		result["from"], result["to"] = ethereum.From, ethereum.To
		result["value"], result["nonce"] = ethnative.Quantity(ethereum.Value), hexEVMQuantity(ethereum.Nonce)
		result["gas"], result["gasPrice"] = hexEVMQuantity(ethereum.Gas), ethnative.Quantity(ethereum.GasPrice)
		result["input"], result["type"], result["chainId"] = "0x", "0x0", hexEVMQuantity(uint64(anchor.NativeChainID))
		result["v"] = ethnative.Quantity(ethereum.V)
		result["r"], result["s"] = fmt.Sprintf("0x%064x", ethereum.R), fmt.Sprintf("0x%064x", ethereum.S)
		unknown = []string{"gasUsed", "effectiveGasPrice"}
	}
	result["ynxUnavailableFields"] = unknown
	return result, nil
}
