package api

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
	"golang.org/x/crypto/sha3"
)

func rpcUnsupported(message string) error { return &rpcMethodError{code: -32004, message: message} }

func (s *Server) ethereumNativeResult(method string, params []any) (any, bool, error) {
	respond := func(v any, e error) (any, bool, error) { return v, true, e }
	switch method {
	case "eth_gasPrice":
		if len(params) != 0 {
			return respond(nil, rpcInvalidParams("eth_gasPrice accepts no parameters"))
		}
		return respond(ethnative.Quantity(big.NewInt(ethnative.GasPriceWei)), nil)
	case "eth_maxPriorityFeePerGas", "eth_feeHistory":
		return respond(nil, rpcUnsupported("YNX native adapter uses legacy fixed fees; EIP-1559 is unsupported; use eth_gasPrice"))
	case "ynx_getFeeModel":
		if len(params) != 0 {
			return respond(nil, rpcInvalidParams("ynx_getFeeModel accepts no parameters"))
		}
		return respond(map[string]any{"version": "ynx-ethereum-native-v1", "enabled": s.devnet.EthereumNativeTransfersEnabled(), "chainId": hexQuantity(uint64(s.networkConfig.ChainID)), "transactionType": "0x0", "feeYNXT": "1", "feeWei": ethnative.Quantity(ethnative.Wei(1)), "gas": hexQuantity(ethnative.TransferGas), "gasPrice": ethnative.Quantity(big.NewInt(ethnative.GasPriceWei)), "decimals": 18, "amountQuantumWei": ethnative.Quantity(ethnative.Wei(1)), "scope": "whole-YNXT plain native transfers", "fullEVM": false, "eip1559": false, "durability": durabilityModel()}, nil)
	case "eth_getBalance", "eth_getTransactionCount", "eth_getCode":
		if len(params) < 1 || len(params) > 2 {
			return respond(nil, rpcInvalidParams(method+" requires address and optional latest/pending tag"))
		}
		addr, err := ethereumAddress(params[0])
		if err != nil {
			return respond(nil, rpcInvalidParams(err.Error()))
		}
		if len(params) == 2 && params[1] != "latest" && params[1] != "pending" {
			return respond(nil, rpcInvalidParams("only latest/pending state is supported"))
		}
		if method == "eth_getCode" {
			_, exists := s.devnet.Contract(addr)
			if !exists {
				return respond("0x", nil)
			}
			return respond(nil, rpcUnsupported("contract has no Ethereum runtime bytecode representation"))
		}
		acct, ok := s.devnet.Account(addr)
		if !ok {
			return respond("0x0", nil)
		}
		if method == "eth_getTransactionCount" {
			return respond(hexQuantity(acct.Nonce), nil)
		}
		if acct.Balance < 0 {
			return respond(nil, errors.New("negative native ledger balance"))
		}
		return respond(ethnative.Quantity(ethnative.Wei(acct.Balance)), nil)
	case "eth_estimateGas":
		if err := s.estimateEthereumNative(params); err != nil {
			return respond(nil, err)
		}
		return respond(hexQuantity(ethnative.TransferGas), nil)
	case "eth_sendTransaction":
		return respond(nil, rpcUnsupported("node holds no Ethereum signing keys; wallet must sign a legacy transaction and use eth_sendRawTransaction"))
	case "eth_sendRawTransaction":
		if len(params) != 1 {
			return respond(nil, rpcInvalidParams("eth_sendRawTransaction requires one signed transaction"))
		}
		text, ok := params[0].(string)
		if !ok {
			return respond(nil, rpcInvalidParams("signed transaction must be hex data"))
		}
		raw, err := decodeRPCData(text, 16*1024)
		if err != nil {
			return respond(nil, rpcInvalidParams(err.Error()))
		}
		if bytes.HasPrefix(raw, []byte("{")) {
			return nil, false, nil
		} // Existing native JSON protocol remains distinct.
		eth, err := ethnative.Verify(raw, s.networkConfig.ChainID)
		if err != nil {
			return respond(nil, rpcTransactionRejected(err.Error()))
		}
		tx, _, err := s.devnet.SubmitSignedTransfer(chain.SignedTransferInput{Hash: eth.Hash, From: eth.From, To: eth.To, Amount: eth.Amount, Fee: 1, Nonce: eth.Nonce + 1, EthereumRaw: raw})
		if err != nil {
			return respond(nil, rpcBroadcastFailure(tx, err))
		}
		return respond(tx.Hash, nil)
	case "eth_getTransactionReceipt":
		result, err := s.transactionReceiptResult(params, true)
		return respond(result, err)
	case "eth_getTransactionByHash":
		if len(params) != 1 || !isCanonicalData(fmt.Sprint(params[0]), 32) {
			return respond(nil, rpcInvalidParams("eth_getTransactionByHash requires one 32-byte transaction hash"))
		}
		tx, index, found := s.devnet.TransactionLocation(fmt.Sprint(params[0]))
		if !found {
			return respond(nil, nil)
		}
		result, err := s.ethereumTransactionAt(tx, index)
		return respond(result, err)
	case "eth_getBlockByNumber", "eth_getBlockByHash":
		var block chain.Block
		var full, found bool
		var err error
		if method == "eth_getBlockByNumber" {
			block, full, found, err = s.evmBlockByNumber(params)
		} else {
			block, full, found, err = s.evmBlockByHash(params)
		}
		if err != nil || !found {
			return respond(nil, err)
		}
		// Native block production has no EVM gas scheduler. Preserve its history
		// and reject blocks outside this adapter's fee-equivalent projection
		// instead of returning gasUsed above gasLimit or inventing a higher cap.
		gas := new(big.Int)
		for _, tx := range block.Transactions {
			gas.Add(gas, nativeFeeGas(tx.Fee))
		}
		if gas.Cmp(new(big.Int).SetUint64(ethnative.MaxGasLimit)) > 0 {
			return respond(nil, &rpcMethodError{
				code:    -32004,
				message: "native block exceeds the Ethereum adapter's fee-equivalent gas projection; use the native block endpoint",
				data: map[string]any{
					"status":      "native_block_projection_unsupported",
					"blockNumber": hexQuantity(block.Height), "blockHash": evmHash(block.Hash),
					"feeEquivalentGas": ethnative.Quantity(gas), "projectionGasLimit": hexQuantity(ethnative.MaxGasLimit),
					"gasSemantics":    "native fixed-fee accounting; no EVM block gas scheduling",
					"nativeBlockPath": fmt.Sprintf("/blocks/%d", block.Height),
				},
			})
		}
		result := evmBlock(block, false)
		result["gasLimit"] = hexQuantity(ethnative.MaxGasLimit)
		logs := []chain.EVMLog{}
		txs := make([]any, 0, len(block.Transactions))
		for _, tx := range block.Transactions {
			logs = append(logs, tx.Logs...)
			if full {
				item, err := s.ethereumTransaction(tx)
				if err != nil {
					return respond(nil, err)
				}
				txs = append(txs, item)
			} else {
				txs = append(txs, tx.Hash)
			}
		}
		result["transactions"], result["gasUsed"] = txs, ethnative.Quantity(gas)
		result["difficulty"], result["totalDifficulty"], result["extraData"], result["nonce"], result["uncles"] = "0x0", "0x0", "0x", "0x0000000000000000", []any{}
		bloom, err := nativeLogsBloom(logs)
		if err != nil {
			return respond(nil, err)
		}
		result["logsBloom"] = bloom
		// Absence of baseFeePerGas intentionally selects legacy fee mode.
		return respond(result, nil)
	}
	return nil, false, nil
}

func ethereumAddress(value any) (string, error) {
	text, ok := value.(string)
	if !ok || len(text) != 42 || !strings.HasPrefix(text, "0x") {
		return "", errors.New("expected 20-byte Ethereum address")
	}
	return accountaddress.Normalize(text)
}

func (s *Server) estimateEthereumNative(params []any) error {
	if len(params) < 1 || len(params) > 2 {
		return rpcInvalidParams("eth_estimateGas requires a transaction and optional latest/pending tag")
	}
	if len(params) == 2 && params[1] != "latest" && params[1] != "pending" {
		return rpcInvalidParams("only latest/pending estimates are supported")
	}
	call, ok := params[0].(map[string]any)
	if !ok {
		return rpcInvalidParams("transaction must be an object")
	}
	allowed := map[string]bool{"from": true, "to": true, "value": true, "data": true, "input": true, "gas": true, "gasPrice": true, "nonce": true, "chainId": true, "type": true}
	for name := range call {
		if !allowed[name] {
			return rpcUnsupported("unsupported native transaction field: " + name)
		}
	}
	to, err := ethereumAddress(call["to"])
	if err != nil {
		return rpcInvalidParams("plain transfer recipient required; contract creation unsupported")
	}
	if _, exists := s.devnet.Contract(to); exists {
		return rpcUnsupported("transfers to contracts are unsupported by the native adapter")
	}
	for _, name := range []string{"data", "input"} {
		if value, exists := call[name]; exists && value != "0x" {
			return rpcUnsupported("contract calldata is unsupported")
		}
	}
	quantity := func(name string, fallback *big.Int) (*big.Int, error) {
		value, exists := call[name]
		if !exists {
			return fallback, nil
		}
		text, ok := value.(string)
		if !ok {
			return nil, rpcInvalidParams(name + " must be a hex quantity")
		}
		n, err := ethnative.ParseQuantity(text)
		if err != nil {
			return nil, rpcInvalidParams(name + ": " + err.Error())
		}
		return n, nil
	}
	value, err := quantity("value", new(big.Int))
	if err != nil {
		return err
	}
	if _, err := ethnative.NativeAmount(value); err != nil {
		return rpcTransactionRejected(err.Error())
	}
	price, err := quantity("gasPrice", big.NewInt(ethnative.GasPriceWei))
	if err != nil {
		return err
	}
	if price.Cmp(big.NewInt(ethnative.GasPriceWei)) != 0 {
		return rpcTransactionRejected("gasPrice must equal the fixed native adapter quote")
	}
	gas, err := quantity("gas", new(big.Int).SetUint64(ethnative.TransferGas))
	if err != nil {
		return err
	}
	if !gas.IsUint64() || gas.Uint64() < ethnative.TransferGas || gas.Uint64() > ethnative.MaxGasLimit {
		return rpcTransactionRejected("native transfer gas limit must be between 25000 and 30000000")
	}
	for _, check := range []struct {
		name string
		want *big.Int
	}{{"chainId", big.NewInt(s.networkConfig.ChainID)}, {"type", new(big.Int)}} {
		got, err := quantity(check.name, check.want)
		if err != nil {
			return err
		}
		if got.Cmp(check.want) != 0 {
			return rpcUnsupported("unsupported " + check.name)
		}
	}
	nonce, err := quantity("nonce", nil)
	if err != nil {
		return err
	}
	if nonce != nil && (!nonce.IsUint64() || nonce.Uint64() == ^uint64(0)) {
		return rpcInvalidParams("nonce exceeds adapter range")
	}
	if from, exists := call["from"]; exists {
		address, err := ethereumAddress(from)
		if err != nil {
			return rpcInvalidParams(err.Error())
		}
		if address == to {
			return rpcTransactionRejected("native sender and recipient must differ")
		}
		acct, found := s.devnet.Account(address)
		if !found {
			return rpcTransactionRejected("insufficient funds for value plus gas budget")
		}
		if nonce != nil && nonce.Uint64() != acct.Nonce {
			return rpcTransactionRejected("nonce does not match next Ethereum account nonce")
		}
		budget := new(big.Int).Add(value, new(big.Int).Mul(gas, price))
		if ethnative.Wei(acct.Balance).Cmp(budget) < 0 {
			return rpcTransactionRejected("insufficient funds for value plus gas budget")
		}
	}
	return nil
}

func nativeFeeGas(fee int64) *big.Int {
	return new(big.Int).Mul(big.NewInt(fee), new(big.Int).SetUint64(ethnative.TransferGas))
}

func nativeLogsBloom(logs []chain.EVMLog) (string, error) {
	bloom := make([]byte, 256)
	for _, log := range logs {
		values := append([]string{log.Address}, log.Topics...)
		for i, value := range values {
			length := 32
			if i == 0 {
				length = 20
			}
			if !isCanonicalData(value, length) {
				return "", errors.New("native event is not representable as Ethereum log data")
			}
			data, _ := hex.DecodeString(value[2:])
			h := sha3.NewLegacyKeccak256()
			_, _ = h.Write(data)
			digest := h.Sum(nil)
			for j := 0; j < 6; j += 2 {
				bit := (int(digest[j])<<8 | int(digest[j+1])) & 2047
				bloom[255-bit/8] |= 1 << uint(bit%8)
			}
		}
	}
	return "0x" + hex.EncodeToString(bloom), nil
}

func (s *Server) ethereumTransaction(tx chain.Transaction) (map[string]any, error) {
	return s.ethereumTransactionAt(tx, transactionIndex(s.devnet, tx))
}
func (s *Server) ethereumTransactionAt(tx chain.Transaction, index uint64) (map[string]any, error) {
	result := evmTx(tx)
	result["value"], result["gas"], result["gasPrice"], result["type"] = ethnative.Quantity(ethnative.Wei(tx.Amount)), ethnative.Quantity(nativeFeeGas(tx.Fee)), ethnative.Quantity(big.NewInt(ethnative.GasPriceWei)), "0x0"
	result["transactionIndex"] = nil
	if tx.BlockNum > 0 {
		result["transactionIndex"] = hexQuantity(index)
	}
	eth, present, err := ethnative.FromMemo(tx.Memo, s.networkConfig.ChainID)
	if err != nil {
		return nil, err
	}
	if present {
		result["gas"], result["nonce"] = hexQuantity(eth.Gas), hexQuantity(eth.Nonce)
		result["v"], result["r"], result["s"] = ethnative.Quantity(eth.V), fmt.Sprintf("0x%064x", eth.R), fmt.Sprintf("0x%064x", eth.S)
		result["chainId"] = hexQuantity(uint64(s.networkConfig.ChainID))
		result["ynxTransactionEncoding"] = "ethereum-legacy-eip155"
	} else {
		result["ynxTransactionEncoding"] = "ynx-native"
	}
	return result, nil
}
