package bftgateway

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayBroadcastsAndLooksUpBoundedEthereumLegacyTransfer(t *testing.T) {
	senderKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 51))
	recipientKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 52))
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	payload, ethereumTx, err := consensus.NewEthereumLegacyTransfer(senderKey, 6423, 0, 2, recipient, 125)
	if err != nil {
		t.Fatal(err)
	}
	cometHash := consensus.SignedTransactionHash(payload)
	cometHashUpper := strings.ToUpper(strings.TrimPrefix(cometHash, "0x"))
	blockHash := strings.Repeat("b", 64)
	appHash := strings.Repeat("d", 64)
	dataHash := strings.Repeat("a", 64)
	blockTime := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	receipt := consensus.BFTEVMReceipt{
		TxHash: ethereumTx.Hash, From: ethereumTx.From, To: ethereumTx.To,
		Action: consensus.EthereumLegacyTransferType, Status: "success", EncodedResult: "0x",
		Logs: []consensus.BFTEVMLog{}, BlockHeight: 17,
	}
	receipt.AuditHash = consensus.BFTEVMReceiptAuditHash(receipt)
	receiptPayload, err := json.Marshal(receipt)
	if err != nil {
		t.Fatal(err)
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/broadcast_tx_commit":
			if r.URL.Query().Get("tx") != fmt.Sprintf("0x%x", payload) {
				t.Errorf("unexpected Ethereum broadcast payload: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"check_tx": map[string]any{"code": 0}, "tx_result": map[string]any{"code": 0, "gas_used": "21000"},
				"hash": cometHashUpper, "height": "17",
			}})
		case "/tx":
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32603, "message": "tx not found"}})
		case "/abci_query":
			path, _ := strconv.Unquote(r.URL.Query().Get("path"))
			value := receiptPayload
			if path == "/evm/logs" {
				value = []byte("[]")
			} else if path != "/evm/receipts/"+ethereumTx.Hash {
				t.Errorf("unexpected ABCI query path: %s", path)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{
				"code": 0, "height": "17", "value": base64.StdEncoding.EncodeToString(value),
			}}})
		case "/block":
			if r.URL.Query().Get("height") != "17" {
				t.Errorf("unexpected Ethereum block query: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"block_id": map[string]any{"hash": strings.ToUpper(blockHash)},
				"block": map[string]any{
					"header": map[string]any{
						"height": "17", "time": blockTime, "proposer_address": strings.Repeat("c", 40),
						"app_hash": strings.ToUpper(appHash), "data_hash": strings.ToUpper(dataHash),
						"last_block_id": map[string]any{"hash": strings.Repeat("f", 64)},
					},
					"data": map[string]any{"txs": []string{base64.StdEncoding.EncodeToString(payload)}},
				},
			}})
		case "/block_results":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"height": "17", "txs_results": []map[string]any{{"code": 0, "log": consensus.EthereumLegacyTransferType, "gas_used": "21000"}},
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	result, err := gateway.broadcastSignedTransaction(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Committed || result.Height != 17 || result.Transaction.Hash != ethereumTx.Hash || result.Transaction.From != ethereumTx.From || result.Transaction.To != ethereumTx.To || result.Transaction.Nonce != 0 || result.Transaction.Fee != 42_000 || result.CometHash != strings.ToLower(cometHashUpper) {
		t.Fatalf("unexpected Ethereum broadcast result: %+v", result)
	}

	upstreamTx, mapped, found, err := gateway.committedTransaction(context.Background(), ethereumTx.Hash)
	if err != nil || !found {
		t.Fatalf("Ethereum hash lookup failed: found=%v err=%v", found, err)
	}
	if mapped.Hash != ethereumTx.Hash || upstreamTx.Hash != cometHashUpper || upstreamTx.Index != 0 || upstreamTx.TxResult.GasUsed != "21000" {
		t.Fatalf("Ethereum dual-hash evidence mismatch: upstream=%+v mapped=%+v", upstreamTx, mapped)
	}
	mappedFromComet, err := gateway.mapCometTransaction(context.Background(), upstreamTx)
	if err != nil || mappedFromComet.Hash != ethereumTx.Hash {
		t.Fatalf("CometBFT transaction mapping did not preserve the Ethereum external hash: mapped=%+v err=%v", mappedFromComet, err)
	}
	restRequest := httptest.NewRequest(http.MethodGet, "/transactions/"+ethereumTx.Hash, nil)
	restRequest.SetPathValue("hash", ethereumTx.Hash)
	restResponse := httptest.NewRecorder()
	gateway.handleTransaction(restResponse, restRequest)
	if restResponse.Code != http.StatusOK || !strings.Contains(restResponse.Body.String(), ethereumTx.Hash) {
		t.Fatalf("REST Ethereum-hash lookup failed: status=%d body=%s", restResponse.Code, restResponse.Body.String())
	}
	object := evmCommittedTransaction(mapped, upstreamTx.Index, upstreamTx.Tx)
	if object["hash"] != ethereumTx.Hash || object["nonce"] != "0x0" || object["gas"] != "0x5208" || object["gasPrice"] != "0x2" || object["value"] != "0x7d" || object["type"] != "0x0" || object["chainId"] != "0x1917" || object["v"] != hexEVMQuantity(ethereumTx.V) {
		t.Fatalf("unexpected Ethereum JSON-RPC transaction object: %+v", object)
	}
	if r, ok := object["r"].(string); !ok || len(r) != 66 {
		t.Fatalf("Ethereum transaction object has invalid r signature scalar: %+v", object)
	}
	if s, ok := object["s"].(string); !ok || len(s) != 66 {
		t.Fatalf("Ethereum transaction object has invalid s signature scalar: %+v", object)
	}
	receiptObject, err := gateway.evmCommittedResult(context.Background(), "eth_getTransactionReceipt", json.RawMessage(fmt.Sprintf(`[%q]`, ethereumTx.Hash)))
	if err != nil {
		t.Fatal(err)
	}
	mappedReceipt := receiptObject.(map[string]any)
	if mappedReceipt["transactionHash"] != ethereumTx.Hash || mappedReceipt["gasUsed"] != "0x5208" || mappedReceipt["effectiveGasPrice"] != "0x2" || mappedReceipt["status"] != "0x1" {
		t.Fatalf("unexpected Ethereum JSON-RPC receipt: %+v", mappedReceipt)
	}
}

func TestGatewayRejectsTamperedEthereumReceiptAuditEvidence(t *testing.T) {
	senderKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 53))
	recipientKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 54))
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	_, ethereumTx, err := consensus.NewEthereumLegacyTransfer(senderKey, 6423, 0, 1, recipient, 1)
	if err != nil {
		t.Fatal(err)
	}
	receipt := consensus.BFTEVMReceipt{
		TxHash: ethereumTx.Hash, From: ethereumTx.From, To: ethereumTx.To,
		Action: consensus.EthereumLegacyTransferType, Status: "success", EncodedResult: "0x",
		Logs: []consensus.BFTEVMLog{}, BlockHeight: 17,
	}
	receipt.AuditHash = consensus.BFTEVMReceiptAuditHash(receipt)
	receipt.To = ethereumTx.From
	receiptPayload, err := json.Marshal(receipt)
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/tx":
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32603, "message": "tx not found"}})
		case "/abci_query":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{
				"code": 0, "height": "17", "value": base64.StdEncoding.EncodeToString(receiptPayload),
			}}})
		default:
			t.Fatalf("tampered receipt reached unexpected upstream path %s", r.URL.Path)
		}
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, found, err := gateway.committedTransaction(context.Background(), ethereumTx.Hash); err == nil || found || !strings.Contains(err.Error(), "audit mismatch") {
		t.Fatalf("tampered receipt audit evidence was accepted: found=%v err=%v", found, err)
	}
}

func TestCommittedEthereumLookupDoesNotMaskNonNotFoundCometError(t *testing.T) {
	hash := "0x" + strings.Repeat("1", 64)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/tx" {
			t.Fatalf("unexpected fallback request after non-not-found CometBFT error: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32603, "message": "upstream index unavailable"}})
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, found, err := gateway.committedTransaction(context.Background(), hash); err == nil || found || !strings.Contains(err.Error(), "upstream index unavailable") {
		t.Fatalf("non-not-found CometBFT error was masked by receipt fallback: found=%v err=%v", found, err)
	}
}

func TestGatewayRejectsMalformedWrongChainAndTypedEthereumBroadcasts(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 61))
	recipientKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 62))
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	wrongChain, _, err := consensus.NewEthereumLegacyTransfer(key, 1, 0, 1, recipient, 1)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name    string
		payload []byte
		status  int
	}{
		{name: "malformed RLP", payload: []byte{0xc1}, status: http.StatusBadRequest},
		{name: "typed EIP-1559", payload: []byte{0x02, 0xc0}, status: http.StatusBadRequest},
		{name: "wrong chain", payload: wrongChain, status: http.StatusUnprocessableEntity},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, status, err := broadcastTransactionIdentity(test.payload)
			if err == nil || status != test.status {
				t.Fatalf("unexpected validation result: status=%d err=%v", status, err)
			}
		})
	}
}
