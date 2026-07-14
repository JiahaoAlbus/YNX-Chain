package api

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestSignedYNXTBroadcastReplayPersistenceAndExchangeRPC(t *testing.T) {
	dataDir := t.TempDir()
	devnet, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()

	depositorKey := testExchangeKey(41)
	depositKey := testExchangeKey(42)
	recipientKey := testExchangeKey(43)
	depositor, _ := consensus.NativeAddress(depositorKey.PubKey().SerializeCompressed())
	depositAddress, _ := consensus.NativeAddress(depositKey.PubKey().SerializeCompressed())
	recipient, _ := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())

	var funded map[string]any
	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": depositor, "amount": 2_000}, http.StatusCreated, &funded)
	devnet.ProduceBlock()

	depositPayload, depositTx := testSignedTransfer(t, depositorKey, depositAddress, 1_000, 1, 6423)
	var broadcast map[string]any
	doRawJSON(t, server.URL+"/transactions/broadcast", depositPayload, http.StatusCreated, &broadcast)
	if broadcast["replayed"] != false || broadcast["truthfulStatus"] != "signature-verified-authoritative-native-transfer" {
		t.Fatalf("unexpected signed broadcast response: %v", broadcast)
	}
	depositHash := consensus.SignedTransactionHash(depositPayload)
	if broadcast["transaction"].(map[string]any)["hash"] != depositHash {
		t.Fatalf("signed broadcast hash mismatch: %v", broadcast)
	}
	doRawJSON(t, server.URL+"/transactions/broadcast", depositPayload, http.StatusOK, &broadcast)
	if broadcast["replayed"] != true {
		t.Fatalf("exact signed transaction replay was not idempotent: %v", broadcast)
	}

	changedPayload, _ := testSignedTransfer(t, depositorKey, depositAddress, 999, 1, 6423)
	var rejected map[string]any
	doRawJSON(t, server.URL+"/transactions/broadcast", changedPayload, http.StatusConflict, &rejected)
	wrongChainPayload, _ := testSignedTransfer(t, depositorKey, depositAddress, 1_000, 2, 1)
	doRawJSON(t, server.URL+"/transactions/broadcast", wrongChainPayload, http.StatusUnprocessableEntity, &rejected)

	depositBlock := devnet.ProduceBlock()
	assertRPCResultValue(t, server.URL, "eth_getTransactionCount", []any{depositAddress, "latest"}, "0x0")
	assertRPCResultValue(t, server.URL, "eth_getBalance", []any{depositAddress, "latest"}, "0x3e8")
	assertRPCResultValue(t, server.URL, "eth_getBlockByNumber", []any{hexQuantity(depositBlock.Height), false}, map[string]any{"hash": evmHash(depositBlock.Hash), "transaction": depositHash})
	assertRPCResultValue(t, server.URL, "eth_getBlockByHash", []any{evmHash(depositBlock.Hash), false}, map[string]any{"hash": evmHash(depositBlock.Hash), "transaction": depositHash})

	withdrawalPayload, withdrawalTx := testSignedTransfer(t, depositKey, recipient, 125, 1, 6423)
	withdrawalHash := consensus.SignedTransactionHash(withdrawalPayload)
	assertRPCResultValue(t, server.URL, "eth_sendRawTransaction", []any{"0x" + hex.EncodeToString(withdrawalPayload)}, withdrawalHash)
	assertRPCResultValue(t, server.URL, "eth_getTransactionReceipt", []any{withdrawalHash}, nil)
	assertRPCResultValue(t, server.URL, "eth_getTransactionCount", []any{depositAddress, "pending"}, "0x1")
	withdrawalBlock := devnet.ProduceBlock()
	var receipt map[string]any
	doRPC(t, server.URL, "eth_getTransactionReceipt", []any{withdrawalHash}, &receipt)
	result := receipt["result"].(map[string]any)
	if result["status"] != "0x1" || result["blockHash"] != evmHash(withdrawalBlock.Hash) || result["transactionIndex"] != "0x0" || len(result["logs"].([]any)) != 1 {
		t.Fatalf("withdrawal receipt lacks committed evidence: %v", receipt)
	}
	assertRPCResultValue(t, server.URL, "eth_getBalance", []any{recipient, "latest"}, "0x7d")

	var rpcFailure map[string]any
	doRPC(t, server.URL, "eth_sendRawTransaction", []any{"0x0"}, &rpcFailure)
	assertRPCErrorCode(t, rpcFailure, -32602)
	doRPC(t, server.URL, "eth_sendRawTransaction", []any{"0x01"}, &rpcFailure)
	assertRPCErrorCode(t, rpcFailure, -32003)
	doRPC(t, server.URL, "eth_sendRawTransaction", []any{"0x" + hex.EncodeToString(wrongChainPayload)}, &rpcFailure)
	assertRPCErrorCode(t, rpcFailure, -32003)
	doRPC(t, server.URL, "eth_notImplemented", []any{}, &rpcFailure)
	assertRPCErrorCode(t, rpcFailure, -32601)

	restored, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if account, ok := restored.Account(recipient); !ok || account.Balance != 125 {
		t.Fatalf("signed withdrawal did not survive restart: %+v %v", account, ok)
	}
	if transaction, ok := restored.Transaction(withdrawalHash); !ok || transaction.Nonce != withdrawalTx.Nonce || transaction.From != withdrawalTx.From || transaction.To != withdrawalTx.To {
		t.Fatalf("signed transaction did not survive restart: %+v %v", transaction, ok)
	}
	if depositTx.From != depositor || depositTx.To != depositAddress {
		t.Fatalf("test signed deposit identity mismatch: %+v", depositTx)
	}
}

func testExchangeKey(value byte) *secp256k1.PrivateKey {
	key := make([]byte, 32)
	key[31] = value
	return secp256k1.PrivKeyFromBytes(key)
}

func testSignedTransfer(t *testing.T, key *secp256k1.PrivateKey, to string, amount int64, nonce uint64, chainID int64) ([]byte, consensus.SignedTransaction) {
	t.Helper()
	tx, err := consensus.NewSignedTransfer(key, chainID, to, amount, nonce)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := consensus.EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return payload, tx
}

func doRawJSON(t *testing.T, url string, payload []byte, expectedStatus int, output any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != expectedStatus {
		t.Fatalf("unexpected status %d (want %d): %s", resp.StatusCode, expectedStatus, body)
	}
	if err := json.Unmarshal(body, output); err != nil {
		t.Fatalf("decode response: %v: %s", err, body)
	}
}

func doRPC(t *testing.T, url, method string, params []any, output *map[string]any) {
	t.Helper()
	doJSON(t, http.MethodPost, url+"/evm", map[string]any{"jsonrpc": "2.0", "id": "exchange-test", "method": method, "params": params}, http.StatusOK, output)
}

func assertRPCErrorCode(t *testing.T, response map[string]any, expected float64) {
	t.Helper()
	errorObject, ok := response["error"].(map[string]any)
	if !ok || errorObject["code"] != expected {
		t.Fatalf("unexpected RPC error (want %v): %v", expected, response)
	}
}

func assertRPCResultValue(t *testing.T, url, method string, params []any, expected any) {
	t.Helper()
	var response map[string]any
	doRPC(t, url, method, params, &response)
	if expectedMap, ok := expected.(map[string]any); ok {
		result, ok := response["result"].(map[string]any)
		if !ok || result["hash"] != expectedMap["hash"] {
			t.Fatalf("unexpected %s block result: %v", method, response)
		}
		transactions, ok := result["transactions"].([]any)
		if !ok || len(transactions) != 1 || transactions[0] != expectedMap["transaction"] {
			t.Fatalf("unexpected %s transactions: %v", method, response)
		}
		return
	}
	actual, present := response["result"]
	if !present || actual != expected {
		t.Fatalf("unexpected %s result: got=%v want=%v response=%v", method, response["result"], expected, response)
	}
}
