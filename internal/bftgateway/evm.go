package bftgateway

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"golang.org/x/crypto/sha3"
)

const maxEVMLogBlockRange = uint64(1000)

var (
	evmAddressPattern = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
	evmTopicPattern   = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
)

func (g *Gateway) evmCommittedResult(ctx context.Context, method string, raw json.RawMessage) (any, error) {
	var params []json.RawMessage
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, errors.New("JSON-RPC params must be an array")
		}
	}
	switch method {
	case "eth_getTransactionByHash", "eth_getTransactionReceipt":
		if len(params) != 1 {
			return nil, errors.New("exactly one transaction hash is required")
		}
		var hash string
		if err := json.Unmarshal(params[0], &hash); err != nil || !transactionHashPattern.MatchString(hash) {
			return nil, errors.New("canonical lowercase transaction hash is required")
		}
		upstream, tx, found, err := g.committedTransaction(ctx, hash)
		if err != nil || !found {
			return nil, err
		}
		if method == "eth_getTransactionByHash" {
			return evmCommittedTransaction(tx, upstream.Index, upstream.Tx), nil
		}
		gasUsed, err := parseCometGas(upstream.TxResult.GasUsed)
		if err != nil {
			return nil, err
		}
		cumulativeGasUsed, err := g.committedCumulativeGas(ctx, tx.BlockNum, upstream.Index, gasUsed)
		if err != nil {
			return nil, err
		}
		var ideReceipt consensus.BFTEVMReceipt
		if err := g.queryABCIJSON(ctx, "/evm/receipts/"+hash, &ideReceipt); err == nil {
			if ideReceipt.TxHash != hash || uint64(ideReceipt.BlockHeight) != tx.BlockNum {
				return nil, errors.New("ABCI IDE receipt does not match CometBFT transaction evidence")
			}
			logs, err := g.evmReceiptLogs(ctx, ideReceipt, tx, upstream.Index)
			if err != nil {
				return nil, err
			}
			return evmIDEReceipt(tx, upstream.Index, gasUsed, cumulativeGasUsed, ideReceipt, logs), nil
		} else if err.Error() != "EVM receipt not found" {
			return nil, err
		}
		return evmCommittedReceipt(tx, upstream.Index, gasUsed, cumulativeGasUsed), nil
	case "eth_getLogs":
		filter, err := g.committedLogFilter(ctx, params)
		if err != nil {
			return nil, err
		}
		return g.evmCommittedLogs(ctx, filter)
	default:
		return nil, errors.New("unsupported committed EVM method")
	}
}

func (g *Gateway) committedTransaction(ctx context.Context, hash string) (cometTx, chain.Transaction, bool, error) {
	var upstream cometTxLookup
	if err := g.client.get(ctx, "/tx", url.Values{"hash": {hash}, "prove": {"true"}}, &upstream); err != nil {
		return cometTx{}, chain.Transaction{}, false, err
	}
	if upstream.Error != nil {
		return cometTx{}, chain.Transaction{}, false, nil
	}
	tx, err := g.mapCometTransaction(ctx, upstream.Result)
	if err != nil {
		return cometTx{}, chain.Transaction{}, false, err
	}
	if tx.Hash != hash {
		return cometTx{}, chain.Transaction{}, false, errors.New("CometBFT transaction lookup hash mismatch")
	}
	return upstream.Result, tx, true, nil
}

func evmCommittedTransaction(t chain.Transaction, index uint32, raws ...[]byte) map[string]any {
	var to any = t.To
	input := "0x"
	var raw []byte
	if len(raws) > 0 {
		raw = raws[0]
	}
	if action, err := consensus.DecodeSignedApplicationAction(raw); err == nil && action.Action == consensus.ActionIDEContractCall {
		var payload consensus.IDEContractCallPayload
		if json.Unmarshal(action.Payload, &payload) == nil {
			to, input = payload.Address, payload.Calldata
		}
	}
	if t.To == "" {
		to = nil
	}
	return map[string]any{
		"hash": t.Hash, "from": t.From, "to": to,
		"value": hexEVMQuantity(uint64(t.Amount)), "nonce": hexEVMQuantity(t.Nonce),
		"blockHash":   "0x" + strings.ToLower(strings.TrimPrefix(t.BlockHash, "0x")),
		"blockNumber": hexEVMQuantity(t.BlockNum), "transactionIndex": hexEVMQuantity(uint64(index)),
		"gas": "0x1", "gasPrice": "0x1", "input": input, "type": "0x0",
	}
}

func evmIDEReceipt(t chain.Transaction, index uint32, gasUsed, cumulativeGasUsed uint64, receipt consensus.BFTEVMReceipt, logs []map[string]any) map[string]any {
	base := evmCommittedReceipt(t, index, gasUsed, cumulativeGasUsed)
	if receipt.To != "" {
		base["to"] = receipt.To
	}
	if receipt.ContractAddress != "" {
		base["contractAddress"] = receipt.ContractAddress
	}
	base["logs"], base["logsBloom"] = logs, evmLogsBloom(receipt.Logs)
	return base
}

func evmCommittedReceipt(t chain.Transaction, index uint32, gasUsed, cumulativeGasUsed uint64) map[string]any {
	var to any = t.To
	if t.To == "" {
		to = nil
	}
	return map[string]any{
		"transactionHash":  t.Hash,
		"transactionIndex": hexEVMQuantity(uint64(index)),
		"blockHash":        "0x" + strings.ToLower(strings.TrimPrefix(t.BlockHash, "0x")),
		"blockNumber":      hexEVMQuantity(t.BlockNum),
		"from":             t.From, "to": to, "contractAddress": nil,
		"cumulativeGasUsed": hexEVMQuantity(cumulativeGasUsed), "gasUsed": hexEVMQuantity(gasUsed),
		"effectiveGasPrice": "0x1", "status": "0x1", "type": "0x0",
		"logs": []any{}, "logsBloom": "0x" + strings.Repeat("0", 512),
	}
}

func (g *Gateway) committedCumulativeGas(ctx context.Context, height uint64, index uint32, expectedGas uint64) (uint64, error) {
	var upstream cometBlockResults
	if err := g.client.get(ctx, "/block_results", url.Values{"height": {strconv.FormatUint(height, 10)}}, &upstream); err != nil {
		return 0, err
	}
	if upstream.Error != nil {
		return 0, errors.New(cometError(upstream.Error))
	}
	parsedHeight, err := strconv.ParseUint(upstream.Result.Height, 10, 64)
	if err != nil || parsedHeight != height || uint64(index) >= uint64(len(upstream.Result.TxsResults)) {
		return 0, errors.New("CometBFT block result evidence does not match transaction height/index")
	}
	var cumulative uint64
	for i := uint32(0); i <= index; i++ {
		result := upstream.Result.TxsResults[i]
		if result.Code != 0 {
			return 0, errors.New("CometBFT block result contains a failed transaction before receipt index")
		}
		gas, err := parseCometGas(result.GasUsed)
		if err != nil || cumulative > math.MaxUint64-gas {
			return 0, errors.New("CometBFT block result has invalid cumulative gas evidence")
		}
		cumulative += gas
	}
	resultGas, err := parseCometGas(upstream.Result.TxsResults[index].GasUsed)
	if err != nil || resultGas != expectedGas {
		return 0, errors.New("CometBFT transaction and block result gas evidence mismatch")
	}
	return cumulative, nil
}

func parseCometGas(raw string) (uint64, error) {
	value, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
	if err != nil || value == 0 {
		return 0, errors.New("CometBFT transaction result has invalid gas_used evidence")
	}
	return value, nil
}

func (g *Gateway) validateEVMLogFilter(ctx context.Context, params []json.RawMessage) error {
	_, err := g.parseCommittedLogFilter(ctx, params)
	return err
}

type committedEVMLogFilter struct {
	from      uint64
	to        uint64
	addresses map[string]struct{}
	topics    [][]string
}

func (g *Gateway) parseCommittedLogFilter(ctx context.Context, params []json.RawMessage) (committedEVMLogFilter, error) {
	if len(params) > 1 {
		return committedEVMLogFilter{}, errors.New("eth_getLogs accepts at most one filter")
	}
	status, err := g.status(ctx)
	if err != nil {
		return committedEVMLogFilter{}, err
	}
	filter := committedEVMLogFilter{from: status.Height, to: status.Height}
	if len(params) == 1 && string(params[0]) != "null" {
		var rawFilter map[string]json.RawMessage
		if err := json.Unmarshal(params[0], &rawFilter); err != nil {
			return committedEVMLogFilter{}, errors.New("eth_getLogs filter must be an object")
		}
		for key := range rawFilter {
			switch key {
			case "fromBlock", "toBlock", "address", "topics":
			default:
				return committedEVMLogFilter{}, fmt.Errorf("unsupported eth_getLogs filter field %q", key)
			}
		}
		if raw, ok := rawFilter["fromBlock"]; ok {
			filter.from, err = parseCommittedBlockTag(raw, status.EarliestBlockHeight, status.Height)
			if err != nil {
				return committedEVMLogFilter{}, err
			}
		}
		if raw, ok := rawFilter["toBlock"]; ok {
			filter.to, err = parseCommittedBlockTag(raw, status.EarliestBlockHeight, status.Height)
			if err != nil {
				return committedEVMLogFilter{}, err
			}
		}
		if raw, ok := rawFilter["address"]; ok {
			if err := validateEVMAddresses(raw); err != nil {
				return committedEVMLogFilter{}, err
			}
			filter.addresses = map[string]struct{}{}
			var one string
			if json.Unmarshal(raw, &one) == nil {
				filter.addresses[one] = struct{}{}
			} else {
				var many []string
				_ = json.Unmarshal(raw, &many)
				for _, address := range many {
					filter.addresses[address] = struct{}{}
				}
			}
		}
		if raw, ok := rawFilter["topics"]; ok {
			if err := validateEVMTopics(raw); err != nil {
				return committedEVMLogFilter{}, err
			}
			var positions []json.RawMessage
			_ = json.Unmarshal(raw, &positions)
			filter.topics = make([][]string, len(positions))
			for i, position := range positions {
				if string(position) == "null" {
					continue
				}
				var one string
				if json.Unmarshal(position, &one) == nil {
					filter.topics[i] = []string{one}
				} else {
					_ = json.Unmarshal(position, &filter.topics[i])
				}
			}
		}
	}
	if err := validateCommittedLogRange(filter.from, filter.to); err != nil {
		return committedEVMLogFilter{}, err
	}
	return filter, nil
}

func (g *Gateway) committedLogFilter(ctx context.Context, params []json.RawMessage) (committedEVMLogFilter, error) {
	return g.parseCommittedLogFilter(ctx, params)
}

func (g *Gateway) evmCommittedLogs(ctx context.Context, filter committedEVMLogFilter) ([]map[string]any, error) {
	var records []consensus.BFTEVMLog
	if err := g.queryABCIJSON(ctx, "/evm/logs", &records); err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	ordinals := make(map[string]uint64, len(records))
	perBlock := map[int64]uint64{}
	for _, record := range records {
		ordinals[record.AuditHash] = perBlock[record.BlockHeight]
		perBlock[record.BlockHeight]++
	}
	cache := map[string]struct {
		upstream cometTx
		tx       chain.Transaction
	}{}
	for _, record := range records {
		if uint64(record.BlockHeight) < filter.from || uint64(record.BlockHeight) > filter.to || !committedLogMatches(record, filter) {
			continue
		}
		evidence, ok := cache[record.TxHash]
		if !ok {
			upstream, tx, found, err := g.committedTransaction(ctx, record.TxHash)
			if err != nil {
				return nil, err
			}
			if !found {
				return nil, errors.New("committed IDE log transaction is unavailable")
			}
			evidence = struct {
				upstream cometTx
				tx       chain.Transaction
			}{upstream, tx}
			cache[record.TxHash] = evidence
		}
		if uint64(record.BlockHeight) != evidence.tx.BlockNum {
			return nil, errors.New("committed IDE log height mismatch")
		}
		result = append(result, mapEVMLog(record, evidence.tx, evidence.upstream.Index, ordinals[record.AuditHash]))
	}
	return result, nil
}

func committedLogMatches(log consensus.BFTEVMLog, filter committedEVMLogFilter) bool {
	if len(filter.addresses) > 0 {
		if _, ok := filter.addresses[log.Address]; !ok {
			return false
		}
	}
	for i, accepted := range filter.topics {
		if len(accepted) == 0 {
			continue
		}
		if i >= len(log.Topics) {
			return false
		}
		matched := false
		for _, topic := range accepted {
			if topic == log.Topics[i] {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	return true
}

func (g *Gateway) evmReceiptLogs(ctx context.Context, receipt consensus.BFTEVMReceipt, tx chain.Transaction, index uint32) ([]map[string]any, error) {
	var records []consensus.BFTEVMLog
	if err := g.queryABCIJSON(ctx, "/evm/logs", &records); err != nil {
		return nil, err
	}
	perBlock, ordinals := map[int64]uint64{}, map[string]uint64{}
	for _, record := range records {
		ordinals[record.AuditHash] = perBlock[record.BlockHeight]
		perBlock[record.BlockHeight]++
	}
	logs := make([]map[string]any, 0, len(receipt.Logs))
	for _, log := range receipt.Logs {
		logs = append(logs, mapEVMLog(log, tx, index, ordinals[log.AuditHash]))
	}
	return logs, nil
}

func mapEVMLog(log consensus.BFTEVMLog, tx chain.Transaction, txIndex uint32, logIndex uint64) map[string]any {
	return map[string]any{"address": log.Address, "topics": log.Topics, "data": log.Data, "blockNumber": hexEVMQuantity(tx.BlockNum), "transactionHash": log.TxHash, "transactionIndex": hexEVMQuantity(uint64(txIndex)), "blockHash": "0x" + strings.ToLower(strings.TrimPrefix(tx.BlockHash, "0x")), "logIndex": hexEVMQuantity(logIndex), "removed": false}
}

func evmLogsBloom(logs []consensus.BFTEVMLog) string {
	bloom := make([]byte, 256)
	for _, log := range logs {
		bloomAdd(bloom, strings.TrimPrefix(log.Address, "0x"))
		for _, topic := range log.Topics {
			bloomAdd(bloom, strings.TrimPrefix(topic, "0x"))
		}
	}
	return "0x" + hex.EncodeToString(bloom)
}

func bloomAdd(bloom []byte, value string) {
	raw, err := hex.DecodeString(value)
	if err != nil {
		return
	}
	hash := sha3.NewLegacyKeccak256()
	_, _ = hash.Write(raw)
	digest := hash.Sum(nil)
	for i := 0; i < 6; i += 2 {
		bit := (uint16(digest[i])<<8 | uint16(digest[i+1])) & 2047
		bloom[255-int(bit/8)] |= byte(1 << (bit % 8))
	}
}

func validateCommittedLogRange(from, to uint64) error {
	if from > to {
		return errors.New("eth_getLogs fromBlock exceeds toBlock")
	}
	if to-from >= maxEVMLogBlockRange {
		return fmt.Errorf("eth_getLogs block range exceeds %d blocks", maxEVMLogBlockRange)
	}
	return nil
}

func parseCommittedBlockTag(raw json.RawMessage, earliest, latest uint64) (uint64, error) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, errors.New("block tag must be a string")
	}
	switch value {
	case "latest", "safe", "finalized":
		return latest, nil
	case "earliest":
		return earliest, nil
	case "pending":
		return 0, errors.New("pending logs are not committed")
	}
	if !strings.HasPrefix(value, "0x") || len(value) < 3 {
		return 0, errors.New("invalid canonical block tag")
	}
	height, err := strconv.ParseUint(value[2:], 16, 64)
	if err != nil || value != hexEVMQuantity(height) {
		return 0, errors.New("invalid canonical block tag")
	}
	if height < earliest || height > latest {
		return 0, errors.New("block tag is outside retained committed history")
	}
	return height, nil
}

func validateEVMAddresses(raw json.RawMessage) error {
	var one string
	if json.Unmarshal(raw, &one) == nil {
		if isCanonicalEVMAddress(one) {
			return nil
		}
		return errors.New("invalid canonical log address")
	}
	var many []string
	if err := json.Unmarshal(raw, &many); err != nil || len(many) == 0 || len(many) > 64 {
		return errors.New("log address must be a string or bounded non-empty string array")
	}
	for _, address := range many {
		if !isCanonicalEVMAddress(address) {
			return errors.New("invalid canonical log address")
		}
	}
	return nil
}

func validateEVMTopics(raw json.RawMessage) error {
	var topics []json.RawMessage
	if err := json.Unmarshal(raw, &topics); err != nil || len(topics) > 4 {
		return errors.New("log topics must be an array with at most four positions")
	}
	for _, position := range topics {
		if string(position) == "null" {
			continue
		}
		var one string
		if json.Unmarshal(position, &one) == nil {
			if !evmTopicPattern.MatchString(one) {
				return errors.New("invalid canonical log topic")
			}
			continue
		}
		var many []string
		if err := json.Unmarshal(position, &many); err != nil || len(many) == 0 || len(many) > 64 {
			return errors.New("topic alternatives must be a bounded non-empty string array")
		}
		for _, topic := range many {
			if !evmTopicPattern.MatchString(topic) {
				return errors.New("invalid canonical log topic")
			}
		}
	}
	return nil
}

func isCanonicalEVMAddress(value string) bool {
	return evmAddressPattern.MatchString(value)
}

func hexEVMQuantity(value uint64) string { return fmt.Sprintf("0x%x", value) }
