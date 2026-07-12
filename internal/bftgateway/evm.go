package bftgateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
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
			return evmCommittedTransaction(tx, upstream.Index), nil
		}
		gasUsed, err := parseCometGas(upstream.TxResult.GasUsed)
		if err != nil {
			return nil, err
		}
		cumulativeGasUsed, err := g.committedCumulativeGas(ctx, tx.BlockNum, upstream.Index, gasUsed)
		if err != nil {
			return nil, err
		}
		return evmCommittedReceipt(tx, upstream.Index, gasUsed, cumulativeGasUsed), nil
	case "eth_getLogs":
		if err := g.validateEVMLogFilter(ctx, params); err != nil {
			return nil, err
		}
		// Current BFT envelopes are native transfers and application actions. Neither
		// executes EVM LOG opcodes, so the only truthful committed result is empty.
		return []any{}, nil
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

func evmCommittedTransaction(t chain.Transaction, index uint32) map[string]any {
	var to any = t.To
	if t.To == "" {
		to = nil
	}
	return map[string]any{
		"hash": t.Hash, "from": t.From, "to": to,
		"value": hexEVMQuantity(uint64(t.Amount)), "nonce": hexEVMQuantity(t.Nonce),
		"blockHash":   "0x" + strings.ToLower(strings.TrimPrefix(t.BlockHash, "0x")),
		"blockNumber": hexEVMQuantity(t.BlockNum), "transactionIndex": hexEVMQuantity(uint64(index)),
		"gas": "0x1", "gasPrice": "0x1", "input": "0x", "type": "0x0",
	}
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
	if len(params) > 1 {
		return errors.New("eth_getLogs accepts at most one filter")
	}
	status, err := g.status(ctx)
	if err != nil {
		return err
	}
	from, to := status.Height, status.Height
	if len(params) == 1 && string(params[0]) != "null" {
		var filter map[string]json.RawMessage
		if err := json.Unmarshal(params[0], &filter); err != nil {
			return errors.New("eth_getLogs filter must be an object")
		}
		for key := range filter {
			switch key {
			case "fromBlock", "toBlock", "address", "topics":
			default:
				return fmt.Errorf("unsupported eth_getLogs filter field %q", key)
			}
		}
		if raw, ok := filter["fromBlock"]; ok {
			from, err = parseCommittedBlockTag(raw, status.EarliestBlockHeight, status.Height)
			if err != nil {
				return err
			}
		}
		if raw, ok := filter["toBlock"]; ok {
			to, err = parseCommittedBlockTag(raw, status.EarliestBlockHeight, status.Height)
			if err != nil {
				return err
			}
		}
		if raw, ok := filter["address"]; ok {
			if err := validateEVMAddresses(raw); err != nil {
				return err
			}
		}
		if raw, ok := filter["topics"]; ok {
			if err := validateEVMTopics(raw); err != nil {
				return err
			}
		}
	}
	return validateCommittedLogRange(from, to)
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
