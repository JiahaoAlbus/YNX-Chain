package bftgateway

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
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
			if err := consensus.ValidateBFTEVMReceipt(ideReceipt); err != nil {
				return nil, fmt.Errorf("ABCI EVM receipt evidence is invalid: %w", err)
			}
			if ideReceipt.TxHash != hash || uint64(ideReceipt.BlockHeight) != tx.BlockNum || ideReceipt.From != tx.From || ideReceipt.To != tx.To || ideReceipt.Action != tx.Type {
				return nil, errors.New("ABCI IDE receipt does not match CometBFT transaction evidence")
			}
			logs, err := g.evmReceiptLogs(ctx, ideReceipt, tx, upstream.Index)
			if err != nil {
				return nil, err
			}
			return evmIDEReceipt(tx, upstream.Index, gasUsed, cumulativeGasUsed, ideReceipt, logs, upstream.Tx), nil
		} else if err.Error() != "EVM receipt not found" {
			return nil, err
		}
		return evmCommittedReceipt(tx, upstream.Index, gasUsed, cumulativeGasUsed, upstream.Tx), nil
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

func (g *Gateway) evmCommittedAccountResult(ctx context.Context, method string, raw json.RawMessage) (any, error) {
	var params []json.RawMessage
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, errors.New("JSON-RPC params must be an array")
	}
	if len(params) != 2 {
		return nil, fmt.Errorf("%s requires an address and block tag", method)
	}
	var address string
	if err := json.Unmarshal(params[0], &address); err != nil || !isCanonicalEVMAddress(address) {
		return nil, errors.New("canonical lowercase EVM account address is required")
	}
	status, err := g.status(ctx)
	if err != nil {
		return nil, err
	}
	height, err := parseCommittedBlockTag(params[1], status.EarliestBlockHeight, status.Height)
	if err != nil {
		return nil, err
	}
	if height != status.Height {
		return nil, errors.New("historical account state is not available from the current CometBFT gateway")
	}
	var account chain.ConsensusAccount
	if err := g.queryABCIJSON(ctx, "/accounts/"+address, &account); err != nil {
		if err.Error() == "YNX account not found" {
			return "0x0", nil
		}
		return nil, err
	}
	if account.Address != address || account.Balance < 0 {
		return nil, errors.New("ABCI account evidence is invalid")
	}
	switch method {
	case "eth_getBalance":
		return hexEVMQuantity(uint64(account.Balance)), nil
	case "eth_getTransactionCount":
		return hexEVMQuantity(account.Nonce), nil
	default:
		return nil, errors.New("unsupported committed EVM account method")
	}
}

func (g *Gateway) evmCommittedContractCode(ctx context.Context, raw json.RawMessage) (any, int, error) {
	var params []json.RawMessage
	if err := json.Unmarshal(raw, &params); err != nil || len(params) != 2 {
		return nil, -32602, errors.New("eth_getCode requires an address and block tag")
	}
	var address string
	if err := json.Unmarshal(params[0], &address); err != nil || !isCanonicalEVMAddress(address) {
		return nil, -32602, errors.New("canonical lowercase contract address is required")
	}
	if code, err := g.requireCurrentCommittedTag(ctx, params[1]); err != nil {
		return nil, code, err
	}
	contract, found, err := g.committedContract(ctx, address)
	if err != nil {
		return nil, -32603, err
	}
	if !found {
		return "0x", 0, nil
	}
	return contract.DeployedBytecode, 0, nil
}

func (g *Gateway) evmCommittedContractCall(ctx context.Context, method string, raw json.RawMessage) (any, int, error) {
	var params []json.RawMessage
	if err := json.Unmarshal(raw, &params); err != nil || len(params) < 1 || len(params) > 2 {
		return nil, -32602, fmt.Errorf("%s requires a call object and optional block tag", method)
	}
	if len(params) == 2 {
		if code, err := g.requireCurrentCommittedTag(ctx, params[1]); err != nil {
			return nil, code, err
		}
	} else if code, err := g.requireCurrentCommittedTag(ctx, json.RawMessage(`"latest"`)); err != nil {
		return nil, code, err
	}
	address, calldata, err := parseBoundedEVMCallObject(params[0])
	if err != nil {
		return nil, -32602, err
	}
	if _, found, err := g.committedContract(ctx, address); err != nil {
		return nil, -32603, err
	} else if !found {
		return nil, -32000, errors.New("committed bounded contract not found")
	}
	var result struct {
		Address         string `json:"address"`
		EncodedResult   string `json:"encodedResult"`
		OpcodeStepCount int    `json:"opcodeStepCount"`
		RuntimeMode     string `json:"runtimeMode"`
	}
	if err := g.queryABCIJSON(ctx, "/ide/call/"+address+"/"+calldata, &result); err != nil {
		return nil, -32000, err
	}
	if result.Address != address || result.RuntimeMode != chain.BoundedContractRuntimeMode || !isCanonicalEVMData(result.EncodedResult, 0, 64<<10) || result.OpcodeStepCount <= 0 {
		return nil, -32603, errors.New("ABCI bounded contract call evidence is invalid")
	}
	if method == "eth_estimateGas" {
		return "0x1", 0, nil
	}
	return result.EncodedResult, 0, nil
}

func (g *Gateway) requireCurrentCommittedTag(ctx context.Context, raw json.RawMessage) (int, error) {
	status, err := g.status(ctx)
	if err != nil {
		return -32603, err
	}
	height, err := parseCommittedBlockTag(raw, status.EarliestBlockHeight, status.Height)
	if err != nil {
		return -32602, err
	}
	if height != status.Height {
		return -32602, errors.New("historical contract state is not available from the current CometBFT gateway")
	}
	return 0, nil
}

func (g *Gateway) committedContract(ctx context.Context, address string) (consensus.BFTContract, bool, error) {
	var contract consensus.BFTContract
	if err := g.queryABCIJSON(ctx, "/ide/contracts/"+address, &contract); err != nil {
		if err.Error() == "IDE contract not found" {
			return consensus.BFTContract{}, false, nil
		}
		return consensus.BFTContract{}, false, err
	}
	if contract.Address != address || contract.RuntimeMode != chain.BoundedContractRuntimeMode || contract.BlockHeight <= 0 || contract.LastUpdatedHeight < contract.BlockHeight || !transactionHashPattern.MatchString(contract.TxHash) {
		return consensus.BFTContract{}, false, errors.New("ABCI bounded contract evidence is invalid")
	}
	bytecodeHash, err := chain.ValidateBoundedPinnedIdentity(contract.Name, contract.SourceHash, contract.DeployedBytecode)
	if err != nil || bytecodeHash != contract.DeployedBytecodeHash || !isCanonicalEVMData(contract.DeployedBytecode, 1, 12<<10) {
		return consensus.BFTContract{}, false, errors.New("ABCI bounded contract artifact identity is invalid")
	}
	return contract, true, nil
}

func parseBoundedEVMCallObject(raw json.RawMessage) (string, string, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return "", "", errors.New("call parameter must be an object")
	}
	allowed := map[string]bool{"to": true, "data": true, "input": true, "from": true, "gas": true, "gasPrice": true, "maxFeePerGas": true, "maxPriorityFeePerGas": true, "value": true}
	for field := range fields {
		if !allowed[field] {
			return "", "", fmt.Errorf("unsupported bounded call field %q", field)
		}
	}
	address, err := requiredEVMStringField(fields, "to")
	if err != nil || !isCanonicalEVMAddress(address) {
		return "", "", errors.New("canonical lowercase call target is required")
	}
	data, hasData, err := optionalEVMStringField(fields, "data")
	if err != nil {
		return "", "", err
	}
	input, hasInput, err := optionalEVMStringField(fields, "input")
	if err != nil {
		return "", "", err
	}
	if !hasData && !hasInput {
		return "", "", errors.New("bounded call data or input is required")
	}
	if hasData && hasInput && data != input {
		return "", "", errors.New("call data and input differ")
	}
	calldata := data
	if !hasData {
		calldata = input
	}
	if !isCanonicalEVMData(calldata, 4, 4096) {
		return "", "", errors.New("bounded call data must be canonical lowercase hexadecimal with at least a four-byte selector")
	}
	if from, ok, err := optionalEVMStringField(fields, "from"); err != nil || (ok && !isCanonicalEVMAddress(from)) {
		return "", "", errors.New("call from must be a canonical lowercase EVM address")
	}
	for _, field := range []string{"gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"} {
		if value, ok, err := optionalEVMStringField(fields, field); err != nil || (ok && !isCanonicalEVMQuantity(value)) {
			return "", "", fmt.Errorf("call %s must be a canonical hexadecimal quantity", field)
		}
	}
	if value, ok, err := optionalEVMStringField(fields, "value"); err != nil || (ok && value != "0x0") {
		return "", "", errors.New("bounded static calls do not support non-zero value")
	}
	return address, calldata, nil
}

func requiredEVMStringField(fields map[string]json.RawMessage, name string) (string, error) {
	value, ok, err := optionalEVMStringField(fields, name)
	if err != nil {
		return "", err
	}
	if !ok || value == "" {
		return "", fmt.Errorf("call %s is required", name)
	}
	return value, nil
}

func optionalEVMStringField(fields map[string]json.RawMessage, name string) (string, bool, error) {
	raw, ok := fields[name]
	if !ok {
		return "", false, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", true, fmt.Errorf("call %s must be a string", name)
	}
	return value, true, nil
}

func isCanonicalEVMQuantity(value string) bool {
	if value == "0x0" {
		return true
	}
	if len(value) < 3 || len(value) > 66 || !strings.HasPrefix(value, "0x") || value[2] == '0' {
		return false
	}
	for _, character := range value[2:] {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func isCanonicalEVMData(value string, minBytes, maxBytes int) bool {
	if !strings.HasPrefix(value, "0x") || len(value)%2 != 0 {
		return false
	}
	byteLength := (len(value) - 2) / 2
	if byteLength < minBytes || byteLength > maxBytes {
		return false
	}
	for _, character := range value[2:] {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func (g *Gateway) evmSendRawTransaction(ctx context.Context, raw json.RawMessage) (any, int, error) {
	var params []json.RawMessage
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, -32602, errors.New("JSON-RPC params must be an array")
	}
	if len(params) != 1 {
		return nil, -32602, errors.New("eth_sendRawTransaction requires one signed transaction data value")
	}
	var encoded string
	if err := json.Unmarshal(params[0], &encoded); err != nil || !strings.HasPrefix(encoded, "0x") || len(encoded) <= 2 || len(encoded)%2 != 0 {
		return nil, -32602, errors.New("signed transaction data must be non-empty, 0x-prefixed, and byte-aligned")
	}
	if (len(encoded)-2)/2 > consensus.MaxSignedTransactionSize {
		return nil, -32602, errors.New("signed transaction data exceeds maximum size")
	}
	payload, err := hex.DecodeString(encoded[2:])
	if err != nil {
		return nil, -32602, errors.New("signed transaction data must be hexadecimal")
	}
	result, err := g.broadcastSignedTransaction(ctx, payload)
	if err != nil {
		failure, ok := err.(*signedTransactionBroadcastError)
		if !ok || failure.Status >= http.StatusInternalServerError {
			return nil, -32603, err
		}
		return nil, -32003, err
	}
	return result.Transaction.Hash, 0, nil
}

func (g *Gateway) evmCommittedBlockResult(ctx context.Context, method string, raw json.RawMessage) (any, error) {
	var params []json.RawMessage
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, errors.New("JSON-RPC params must be an array")
	}
	if len(params) != 2 {
		return nil, fmt.Errorf("%s requires a block identifier and full-transaction boolean", method)
	}
	var full bool
	if err := json.Unmarshal(params[1], &full); err != nil {
		return nil, errors.New("full-transaction parameter must be boolean")
	}
	var evidence committedBlockEvidence
	switch method {
	case "eth_getBlockByNumber":
		status, err := g.status(ctx)
		if err != nil {
			return nil, err
		}
		height, found, err := parseCommittedBlockLookupTag(params[0], status.EarliestBlockHeight, status.Height)
		if err != nil || !found {
			return nil, err
		}
		evidence, err = g.blockAtHeight(ctx, height)
		if err != nil {
			return nil, err
		}
		if height == status.Height && evidence.Block.Hash != status.LatestBlockHash {
			return nil, errors.New("CometBFT latest block evidence differs from status")
		}
		if height == status.EarliestBlockHeight && evidence.Block.Hash != status.EarliestBlockHash {
			return nil, errors.New("CometBFT earliest block evidence differs from status")
		}
	case "eth_getBlockByHash":
		var hash string
		if err := json.Unmarshal(params[0], &hash); err != nil || !transactionHashPattern.MatchString(hash) {
			return nil, errors.New("canonical lowercase block hash is required")
		}
		var found bool
		var err error
		evidence, found, err = g.blockByHash(ctx, hash)
		if err != nil || !found {
			return nil, err
		}
	default:
		return nil, errors.New("unsupported committed EVM block method")
	}
	if evidence.AppHash == "" || !blockHashPattern.MatchString(evidence.AppHash) {
		return nil, errors.New("CometBFT block is missing a valid AppHash")
	}
	if len(evidence.Block.Transactions) > 0 && (evidence.DataHash == "" || !blockHashPattern.MatchString(evidence.DataHash)) {
		return nil, errors.New("CometBFT transaction block is missing a valid data hash")
	}
	gasUsed, err := g.committedBlockGas(ctx, evidence.Block.Height, len(evidence.Block.Transactions))
	if err != nil {
		return nil, err
	}
	return evmCommittedBlock(evidence, full, gasUsed), nil
}

func (g *Gateway) evmCommittedBlockTransactionResult(ctx context.Context, method string, raw json.RawMessage) (any, int, error) {
	var params []json.RawMessage
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, -32602, errors.New("JSON-RPC params must be an array")
	}
	countLookup := method == "eth_getBlockTransactionCountByNumber" || method == "eth_getBlockTransactionCountByHash"
	if countLookup {
		if len(params) != 1 {
			return nil, -32602, fmt.Errorf("%s requires one block identifier", method)
		}
	} else if len(params) != 2 {
		return nil, -32602, fmt.Errorf("%s requires a block identifier and transaction index", method)
	}
	byHash := method == "eth_getBlockTransactionCountByHash" || method == "eth_getTransactionByBlockHashAndIndex"
	evidence, found, code, err := g.committedEVMBlockTransactionEvidence(ctx, byHash, params[0])
	if err != nil || !found {
		return nil, code, err
	}
	if evidence.AppHash == "" || !blockHashPattern.MatchString(evidence.AppHash) {
		return nil, -32603, errors.New("CometBFT block is missing a valid AppHash")
	}
	if len(evidence.Block.Transactions) > 0 && (evidence.DataHash == "" || !blockHashPattern.MatchString(evidence.DataHash)) {
		return nil, -32603, errors.New("CometBFT transaction block is missing a valid data hash")
	}
	if len(evidence.RawTransactions) != len(evidence.Block.Transactions) {
		return nil, -32603, errors.New("CometBFT raw transaction evidence count does not match mapped transactions")
	}
	if countLookup {
		return hexEVMQuantity(uint64(len(evidence.Block.Transactions))), 0, nil
	}
	index, err := parseCanonicalEVMQuantity(params[1], "transaction index")
	if err != nil {
		return nil, -32602, err
	}
	if index >= uint64(len(evidence.Block.Transactions)) {
		return nil, 0, nil
	}
	return evmCommittedTransaction(evidence.Block.Transactions[index], uint32(index), evidence.RawTransactions[index]), 0, nil
}

func (g *Gateway) committedEVMBlockTransactionEvidence(ctx context.Context, byHash bool, raw json.RawMessage) (committedBlockEvidence, bool, int, error) {
	if byHash {
		var hash string
		if err := json.Unmarshal(raw, &hash); err != nil || !transactionHashPattern.MatchString(hash) {
			return committedBlockEvidence{}, false, -32602, errors.New("canonical lowercase block hash is required")
		}
		evidence, found, err := g.blockByHash(ctx, hash)
		if err != nil {
			return committedBlockEvidence{}, false, -32603, err
		}
		return evidence, found, 0, nil
	}
	if err := validateCommittedBlockLookupTagSyntax(raw); err != nil {
		return committedBlockEvidence{}, false, -32602, err
	}
	status, err := g.status(ctx)
	if err != nil {
		return committedBlockEvidence{}, false, -32603, err
	}
	height, found, err := parseCommittedBlockLookupTag(raw, status.EarliestBlockHeight, status.Height)
	if err != nil {
		return committedBlockEvidence{}, false, -32602, err
	}
	if !found {
		return committedBlockEvidence{}, false, 0, nil
	}
	evidence, err := g.blockAtHeight(ctx, height)
	if err != nil {
		return committedBlockEvidence{}, false, -32603, err
	}
	if height == status.Height && evidence.Block.Hash != status.LatestBlockHash {
		return committedBlockEvidence{}, false, -32603, errors.New("CometBFT latest block evidence differs from status")
	}
	if height == status.EarliestBlockHeight && evidence.Block.Hash != status.EarliestBlockHash {
		return committedBlockEvidence{}, false, -32603, errors.New("CometBFT earliest block evidence differs from status")
	}
	return evidence, true, 0, nil
}

func parseCanonicalEVMQuantity(raw json.RawMessage, label string) (uint64, error) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || !isCanonicalEVMQuantity(value) {
		return 0, fmt.Errorf("%s must be a canonical hexadecimal quantity", label)
	}
	parsed, err := strconv.ParseUint(value[2:], 16, 64)
	if err != nil {
		return 0, fmt.Errorf("%s exceeds uint64", label)
	}
	return parsed, nil
}

func (g *Gateway) committedBlockGas(ctx context.Context, height uint64, transactionCount int) (uint64, error) {
	var upstream cometBlockResults
	if err := g.client.get(ctx, "/block_results", url.Values{"height": {strconv.FormatUint(height, 10)}}, &upstream); err != nil {
		return 0, err
	}
	if upstream.Error != nil {
		return 0, errors.New(cometError(upstream.Error))
	}
	parsedHeight, err := strconv.ParseUint(upstream.Result.Height, 10, 64)
	if err != nil || parsedHeight != height || len(upstream.Result.TxsResults) != transactionCount {
		return 0, errors.New("CometBFT block result count does not match block transactions")
	}
	var total uint64
	for _, result := range upstream.Result.TxsResults {
		if result.Code != 0 {
			return 0, errors.New("CometBFT block result contains a failed transaction")
		}
		gas, err := parseCometGas(result.GasUsed)
		if err != nil || total > math.MaxUint64-gas {
			return 0, errors.New("CometBFT block result has invalid total gas evidence")
		}
		total += gas
	}
	return total, nil
}

func evmCommittedBlock(evidence committedBlockEvidence, full bool, gasUsed uint64) map[string]any {
	transactions := make([]any, 0, len(evidence.Block.Transactions))
	for index, transaction := range evidence.Block.Transactions {
		if full {
			var raw []byte
			if index < len(evidence.RawTransactions) {
				raw = evidence.RawTransactions[index]
			}
			transactions = append(transactions, evmCommittedTransaction(transaction, uint32(index), raw))
		} else {
			transactions = append(transactions, transaction.Hash)
		}
	}
	var parentHash any
	if evidence.Block.ParentHash != "" {
		parentHash = "0x" + evidence.Block.ParentHash
	}
	result := map[string]any{
		"number":           hexEVMQuantity(evidence.Block.Height),
		"hash":             "0x" + evidence.Block.Hash,
		"parentHash":       parentHash,
		"timestamp":        hexEVMQuantity(uint64(evidence.Block.Time.Unix())),
		"miner":            "0x" + evidence.Block.Validator,
		"stateRoot":        "0x" + evidence.AppHash,
		"gasUsed":          hexEVMQuantity(gasUsed),
		"transactions":     transactions,
		"transactionCount": hexEVMQuantity(uint64(len(transactions))),
	}
	if evidence.DataHash != "" {
		result["transactionsRoot"] = "0x" + evidence.DataHash
	}
	return result
}

func validateCommittedBlockLookupTagSyntax(raw json.RawMessage) error {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return errors.New("block identifier must be a string")
	}
	switch value {
	case "latest", "safe", "finalized", "earliest", "pending":
		return nil
	}
	if !strings.HasPrefix(value, "0x") || len(value) < 3 {
		return errors.New("invalid canonical block quantity")
	}
	height, err := strconv.ParseUint(value[2:], 16, 64)
	if err != nil || value != hexEVMQuantity(height) {
		return errors.New("invalid canonical block quantity")
	}
	return nil
}

func parseCommittedBlockLookupTag(raw json.RawMessage, earliest, latest uint64) (uint64, bool, error) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, false, errors.New("block identifier must be a string")
	}
	switch value {
	case "latest", "safe", "finalized":
		return latest, true, nil
	case "earliest":
		return earliest, true, nil
	case "pending":
		return 0, false, nil
	}
	if !strings.HasPrefix(value, "0x") || len(value) < 3 {
		return 0, false, errors.New("invalid canonical block quantity")
	}
	height, err := strconv.ParseUint(value[2:], 16, 64)
	if err != nil || value != hexEVMQuantity(height) {
		return 0, false, errors.New("invalid canonical block quantity")
	}
	if height < earliest || height > latest {
		return 0, false, nil
	}
	return height, true, nil
}

func (g *Gateway) committedTransaction(ctx context.Context, hash string) (cometTx, chain.Transaction, bool, error) {
	var upstream cometTxLookup
	if err := g.client.get(ctx, "/tx", url.Values{"hash": {hash}, "prove": {"true"}}, &upstream); err != nil {
		return cometTx{}, chain.Transaction{}, false, err
	}
	if upstream.Error != nil {
		message := cometError(upstream.Error)
		if !strings.Contains(strings.ToLower(message), "not found") {
			return cometTx{}, chain.Transaction{}, false, errors.New(message)
		}
		return g.committedEthereumTransaction(ctx, hash)
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

func (g *Gateway) committedEthereumTransaction(ctx context.Context, hash string) (cometTx, chain.Transaction, bool, error) {
	var receipt consensus.BFTEVMReceipt
	if err := g.queryABCIJSON(ctx, "/evm/receipts/"+hash, &receipt); err != nil {
		if err.Error() == "EVM receipt not found" {
			return cometTx{}, chain.Transaction{}, false, nil
		}
		return cometTx{}, chain.Transaction{}, false, err
	}
	if err := consensus.ValidateBFTEVMReceipt(receipt); err != nil {
		return cometTx{}, chain.Transaction{}, false, fmt.Errorf("committed Ethereum receipt evidence is invalid: %w", err)
	}
	if receipt.TxHash != hash || receipt.Action != consensus.EthereumLegacyTransferType {
		return cometTx{}, chain.Transaction{}, false, errors.New("committed Ethereum receipt evidence is invalid")
	}
	height := uint64(receipt.BlockHeight)
	evidence, err := g.blockAtHeight(ctx, height)
	if err != nil {
		return cometTx{}, chain.Transaction{}, false, err
	}
	var results cometBlockResults
	if err := g.client.get(ctx, "/block_results", url.Values{"height": {strconv.FormatUint(height, 10)}}, &results); err != nil {
		return cometTx{}, chain.Transaction{}, false, err
	}
	if results.Error != nil {
		return cometTx{}, chain.Transaction{}, false, errors.New(cometError(results.Error))
	}
	resultHeight, err := strconv.ParseUint(results.Result.Height, 10, 64)
	if err != nil || resultHeight != height || len(results.Result.TxsResults) != len(evidence.RawTransactions) || len(evidence.Block.Transactions) != len(evidence.RawTransactions) {
		return cometTx{}, chain.Transaction{}, false, errors.New("CometBFT Ethereum transaction result evidence is incomplete")
	}
	for index, raw := range evidence.RawTransactions {
		ethereumTx, err := consensus.DecodeEthereumLegacyTransaction(raw)
		if err != nil || ethereumTx.Hash != hash {
			continue
		}
		if err := ethereumTx.Verify(6423); err != nil {
			return cometTx{}, chain.Transaction{}, false, errors.New("committed Ethereum transaction signature or chain evidence is invalid")
		}
		mapped := evidence.Block.Transactions[index]
		if mapped.Hash != hash || mapped.Type != consensus.EthereumLegacyTransferType || mapped.From != receipt.From || mapped.To != receipt.To || mapped.BlockNum != height ||
			mapped.Amount != ethereumTx.Value || mapped.Fee != ethereumTx.Fee || mapped.Nonce != ethereumTx.Nonce {
			return cometTx{}, chain.Transaction{}, false, errors.New("committed Ethereum receipt does not match block transaction evidence")
		}
		txResult := results.Result.TxsResults[index]
		gasUsed, gasErr := parseCometGas(txResult.GasUsed)
		if txResult.Code != 0 || gasErr != nil || gasUsed != ethereumTx.GasLimit {
			return cometTx{}, chain.Transaction{}, false, errors.New("committed Ethereum receipt points to invalid CometBFT execution evidence")
		}
		cometHash := strings.ToUpper(strings.TrimPrefix(consensus.SignedTransactionHash(raw), "0x"))
		return cometTx{
			Hash: cometHash, Height: strconv.FormatUint(height, 10), Index: uint32(index),
			TxResult: txResult, Tx: raw,
		}, mapped, true, nil
	}
	return cometTx{}, chain.Transaction{}, false, errors.New("committed Ethereum receipt has no matching block transaction")
}

func evmCommittedTransaction(t chain.Transaction, index uint32, raws ...[]byte) map[string]any {
	var to any = t.To
	input, gas, gasPrice, txType := "0x", "0x1", "0x1", "0x0"
	nonce := t.Nonce
	var raw []byte
	var ethereumEnvelope *consensus.EthereumLegacyTransaction
	if len(raws) > 0 {
		raw = raws[0]
	}
	if ethereumTx, err := consensus.DecodeEthereumLegacyTransaction(raw); err == nil {
		ethereumEnvelope = &ethereumTx
		nonce = ethereumTx.Nonce
		gas = hexEVMQuantity(ethereumTx.GasLimit)
		gasPrice = hexEVMQuantity(ethereumTx.GasPrice)
	} else if action, err := consensus.DecodeSignedApplicationAction(raw); err == nil && action.Action == consensus.ActionIDEContractCall {
		var payload consensus.IDEContractCallPayload
		if json.Unmarshal(action.Payload, &payload) == nil {
			to, input = payload.Address, payload.Calldata
		}
	}
	if t.To == "" {
		to = nil
	}
	result := map[string]any{
		"hash": t.Hash, "from": t.From, "to": to,
		"value": hexEVMQuantity(uint64(t.Amount)), "nonce": hexEVMQuantity(nonce),
		"blockHash":   "0x" + strings.ToLower(strings.TrimPrefix(t.BlockHash, "0x")),
		"blockNumber": hexEVMQuantity(t.BlockNum), "transactionIndex": hexEVMQuantity(uint64(index)),
		"gas": gas, "gasPrice": gasPrice, "input": input, "type": txType,
	}
	if ethereumEnvelope != nil {
		result["chainId"] = hexEVMQuantity(uint64(ethereumEnvelope.ChainID))
		result["v"] = hexEVMQuantity(ethereumEnvelope.V)
		result["r"] = "0x" + hex.EncodeToString(ethereumEnvelope.R[:])
		result["s"] = "0x" + hex.EncodeToString(ethereumEnvelope.S[:])
	}
	return result
}

func evmIDEReceipt(t chain.Transaction, index uint32, gasUsed, cumulativeGasUsed uint64, receipt consensus.BFTEVMReceipt, logs []map[string]any, raws ...[]byte) map[string]any {
	base := evmCommittedReceipt(t, index, gasUsed, cumulativeGasUsed, raws...)
	if receipt.To != "" {
		base["to"] = receipt.To
	}
	if receipt.ContractAddress != "" {
		base["contractAddress"] = receipt.ContractAddress
	}
	base["logs"], base["logsBloom"] = logs, evmLogsBloom(receipt.Logs)
	return base
}

func evmCommittedReceipt(t chain.Transaction, index uint32, gasUsed, cumulativeGasUsed uint64, raws ...[]byte) map[string]any {
	var to any = t.To
	if t.To == "" {
		to = nil
	}
	effectiveGasPrice := "0x1"
	if len(raws) > 0 {
		if ethereumTx, err := consensus.DecodeEthereumLegacyTransaction(raws[0]); err == nil {
			effectiveGasPrice = hexEVMQuantity(ethereumTx.GasPrice)
		}
	}
	return map[string]any{
		"transactionHash":  t.Hash,
		"transactionIndex": hexEVMQuantity(uint64(index)),
		"blockHash":        "0x" + strings.ToLower(strings.TrimPrefix(t.BlockHash, "0x")),
		"blockNumber":      hexEVMQuantity(t.BlockNum),
		"from":             t.From, "to": to, "contractAddress": nil,
		"cumulativeGasUsed": hexEVMQuantity(cumulativeGasUsed), "gasUsed": hexEVMQuantity(gasUsed),
		"effectiveGasPrice": effectiveGasPrice, "status": "0x1", "type": "0x0",
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
