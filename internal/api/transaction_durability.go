package api

import (
	"fmt"
	"math/big"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
)

func durabilityModel() map[string]any {
	return map[string]any{
		"version": chain.TransactionDurabilityVersion, "scope": "local-snapshot",
		"receiptField": "ynxDurability", "transactionStatusMethod": "ynx_getTransactionDurability",
		"nativeTransactionField": "ynxNativeTransaction",
		"minedStatus":            "durable", "pendingStatus": "pending_durable", "consensusFinality": false,
	}
}

func transactionDurabilityRPC(hash string, tx chain.Transaction, state chain.TransactionDurability) map[string]any {
	result := map[string]any{"version": chain.TransactionDurabilityVersion, "scope": "local-snapshot", "status": state.Status, "transactionHash": hash}
	if tx.BlockNum > 0 && tx.BlockHash != "" {
		result["blockNumber"], result["blockHash"] = hexQuantity(tx.BlockNum), evmHash(tx.BlockHash)
	}
	if state.Status == "durable" || state.Status == "pending_durable" {
		result["checkpointBlockNumber"], result["checkpointBlockHash"] = hexQuantity(state.CheckpointHeight), evmHash(state.CheckpointHash)
		result["snapshotIntegrity"] = evmHash(state.SnapshotIntegrity)
	}
	return result
}

func (s *Server) transactionDurabilityResult(params []any) (any, error) {
	if len(params) != 1 || !isCanonicalData(fmt.Sprint(params[0]), 32) {
		return nil, rpcInvalidParams("ynx_getTransactionDurability requires one 32-byte transaction hash")
	}
	hash := fmt.Sprint(params[0])
	tx, state, _ := s.devnet.TransactionWithDurability(hash)
	return transactionDurabilityRPC(hash, tx, state), nil
}

func (s *Server) transactionReceiptResult(params []any, nativeFees bool) (any, error) {
	if len(params) != 1 || !isCanonicalData(fmt.Sprint(params[0]), 32) {
		return nil, rpcInvalidParams("eth_getTransactionReceipt requires one 32-byte transaction hash")
	}
	hash := fmt.Sprint(params[0])
	tx, state, found := s.devnet.TransactionWithDurability(hash)
	if !found || tx.BlockNum == 0 || tx.BlockHash == "" {
		return nil, nil
	}
	proof := transactionDurabilityRPC(hash, tx, state)
	if state.Status != "durable" {
		code, status := -32002, "transaction_durability_uncertain"
		if state.Status == "memory_only" {
			code, status = -32004, "transaction_durability_unavailable"
		}
		return nil, &rpcMethodError{code: code, message: "local durable block inclusion is not confirmed", data: map[string]any{"status": status, "transactionHash": hash, "durabilityVersion": chain.TransactionDurabilityVersion, "ynxDurability": proof}}
	}
	index := uint64(len(state.FeesThroughTransaction) - 1)
	result := map[string]any{
		"transactionHash": tx.Hash, "transactionIndex": hexQuantity(index), "status": "0x1",
		"blockHash": evmHash(tx.BlockHash), "blockNumber": hexQuantity(tx.BlockNum),
		"from": nativeEVMIdentity(tx.From), "to": nativeEVMRecipient(tx.To), "contractAddress": nil,
		"gasUsed": hexQuantity(21_000), "cumulativeGasUsed": hexQuantity((index + 1) * 21_000),
		"logs": evmLogs(tx.Logs), "ynxDurability": proof,
		"ynxNativeTransaction": nativeTransactionProjection(tx), "ynxNativeIdentity": nativeIdentityProjection(tx),
	}
	if nativeFees {
		cumulative := new(big.Int)
		for _, fee := range state.FeesThroughTransaction {
			cumulative.Add(cumulative, nativeFeeGas(fee))
		}
		result["gasUsed"], result["cumulativeGasUsed"] = ethnative.Quantity(nativeFeeGas(tx.Fee)), ethnative.Quantity(cumulative)
		bloom, err := nativeLogsBloom(tx.Logs)
		if err != nil {
			return nil, err
		}
		result["effectiveGasPrice"], result["type"], result["logsBloom"] = ethnative.Quantity(big.NewInt(ethnative.GasPriceWei)), "0x0", bloom
		result["ynxLogSemantics"] = "native provenance events; no EVM execution"
		result["ynxFeeWei"] = ethnative.Quantity(ethnative.Wei(tx.Fee))
	}
	return result, nil
}
