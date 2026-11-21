package bftgateway

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestEVMUnversionedValueUnitsHeldBeforeBroadcast(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 51))
	recipient, err := consensus.NativeAddress(secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 52)).PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	legacy, _, err := consensus.NewEthereumLegacyTransfer(key, 6423, 0, 1, recipient, 1)
	if err != nil {
		t.Fatal(err)
	}
	access, _, err := consensus.NewEthereumAccessListTransfer(key, 6423, 0, 1, recipient, 1)
	if err != nil {
		t.Fatal(err)
	}
	dynamic, _, err := consensus.NewEthereumDynamicFeeTransfer(key, 6423, 0, 1, 2, recipient, 1)
	if err != nil {
		t.Fatal(err)
	}
	var calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		http.Error(w, "unexpected broadcast", http.StatusInternalServerError)
	}))
	defer upstream.Close()
	g, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	for _, payload := range [][]byte{legacy, access, dynamic} {
		_, code, err := g.evmSendRawTransaction(context.Background(), json.RawMessage(fmt.Sprintf(`["0x%x"]`, payload)))
		if err == nil || code != -32004 || !strings.Contains(err.Error(), "units are ambiguous") {
			t.Fatalf("ambiguous signed value not held: %d %v", code, err)
		}
	}
	if calls != 0 {
		t.Fatalf("ambiguous value reached Comet %d times", calls)
	}
}

func TestEVMNativeSignedTransferProjectionUsesWei(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 51))
	recipient, err := consensus.NativeAddress(secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 52)).PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	tx, err := consensus.NewSignedTransfer(key, 6423, recipient, 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := consensus.EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	mapped, err := mappedTransaction(raw, 4, strings.Repeat("b", 64), time.Unix(4, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	projected := evmCommittedTransaction(mapped, 0, raw)
	if projected["value"] != "0x1bc16d674ec80000" || projected["hash"] != consensus.SignedTransactionHash(raw) {
		t.Fatalf("native ledger value or signed identity changed: %+v", projected)
	}
}

// The original public native-Ethereum route reports its ledger integer in
// wei. This exercises the normal JSON-RPC entry with a configured Comet RPC;
// neither a key nor a transaction signature is created by this fixture.
func TestEVMOriginalBalanceUnitCompatibility(t *testing.T) {
	const owner = "0x1111111111111111111111111111111111111111"
	var balance int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"node_info": map[string]any{"network": "ynx_6423-1"},
				"sync_info": map[string]any{"earliest_block_hash": strings.Repeat("a", 64), "earliest_block_height": "1", "earliest_block_time": "2026-01-01T00:00:00Z", "latest_block_hash": strings.Repeat("b", 64), "latest_block_height": "1", "latest_block_time": "2026-01-01T00:00:00Z"},
			}})
		case "/validators":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"validators": []any{map[string]any{}, map[string]any{}, map[string]any{}, map[string]any{}}}})
		case "/abci_query":
			if r.URL.Query().Get("path") != fmt.Sprintf("%q", "/accounts/"+owner) {
				t.Error("unexpected original account query", r.URL.RawQuery)
			}
			account, err := json.Marshal(chain.ConsensusAccount{Address: owner, Balance: balance, Nonce: 7})
			if err != nil {
				t.Fatal(err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": 0, "height": "1", "value": base64.StdEncoding.EncodeToString(account)}}})
		default:
			t.Error("unexpected Comet path", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()
	for _, balance = range []int64{0, 1, 100, math.MaxInt64} {
		want := ethnative.Quantity(ethnative.Wei(balance))
		if balance == 100 && want != "0x56bc75e2d63100000" {
			t.Fatal("original public 100-YNXT vector changed", want)
		}
		assertRPCResult(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":[%q,"latest"]}`, owner), want)
		assertRPCResult(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":2,"method":"eth_getTransactionCount","params":[%q,"latest"]}`, owner), "0x7")
	}
	balance = -1
	assertRPCError(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":3,"method":"eth_getBalance","params":[%q,"latest"]}`, owner), -32602)
}

func TestEVMOriginalSignedTransactionAndReceiptUnits(t *testing.T) {
	original, raw := originalPaddedEthereumFixture(t)
	tx := chain.Transaction{Hash: original.Hash, Type: consensus.EthereumLegacyTransferType, From: original.From, To: original.To, Amount: original.Amount, Fee: 1, Nonce: original.Nonce, BlockNum: 3, BlockHash: strings.Repeat("b", 64)}
	projected := evmCommittedTransaction(tx, 0, raw)
	if projected["hash"] != original.Hash || projected["value"] != "0x1bc16d674ec80000" || projected["gas"] != "0x7530" || projected["gasPrice"] != "0x246139ca8000" {
		t.Fatal("original signed wei fields or hash changed", projected)
	}
	receipt := evmCommittedReceipt(tx, 0, ethnative.TransferGas, ethnative.TransferGas, raw)
	if receipt["transactionHash"] != original.Hash || receipt["gasUsed"] != "0x61a8" || receipt["effectiveGasPrice"] != "0x246139ca8000" {
		t.Fatal("original charged gas or price changed", receipt)
	}
}

func originalPaddedEthereumFixture(t *testing.T) (ethnative.Transfer, []byte) {
	t.Helper()
	data, err := os.ReadFile("../../testdata/ethereum-native/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Vectors []struct{ Name, Raw string }
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	var raw []byte
	for _, v := range fixture.Vectors {
		if v.Name == "padded_gas" {
			raw, err = hex.DecodeString(strings.TrimPrefix(v.Raw, "0x"))
		}
	}
	original, err := ethnative.Verify(raw, 6423)
	if err != nil || original.Gas != 30_000 || original.Amount != 2 {
		t.Fatal("original signed fixture unavailable", err)
	}
	return original, raw
}

func TestEVMOriginalSignedBroadcastAndReadback(t *testing.T) {
	original, raw := originalPaddedEthereumFixture(t)
	cometHash := strings.ToUpper(strings.TrimPrefix(consensus.SignedTransactionHash(raw), "0x"))
	blockTime := time.Date(2026, 7, 27, 8, 45, 0, 0, time.UTC)
	receipt := consensus.BFTEVMReceipt{TxHash: original.Hash, From: original.From, To: original.To, Action: consensus.EthereumLegacyTransferType, Status: "success", EncodedResult: "0x", Logs: []consensus.BFTEVMLog{}, BlockHeight: 17}
	receipt.AuditHash = consensus.BFTEVMReceiptAuditHash(receipt)
	receiptBytes, err := json.Marshal(receipt)
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/broadcast_tx_commit":
			if r.URL.Query().Get("tx") != fmt.Sprintf("0x%x", raw) {
				t.Error("broadcast changed original signed bytes")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"check_tx": map[string]any{"code": 0, "gas_used": "25000"}, "tx_result": map[string]any{"code": 0, "gas_used": "25000"}, "hash": cometHash, "height": "17"}})
		case "/tx":
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32603, "message": "tx not found"}})
		case "/abci_query":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": 0, "height": "17", "value": base64.StdEncoding.EncodeToString(receiptBytes)}}})
		case "/block":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"block_id": map[string]any{"hash": strings.Repeat("B", 64)}, "block": map[string]any{"header": map[string]any{"height": "17", "time": blockTime, "proposer_address": strings.Repeat("1", 40), "app_hash": strings.Repeat("C", 64), "data_hash": strings.Repeat("D", 64), "last_block_id": map[string]any{"hash": strings.Repeat("A", 64)}}, "data": map[string]any{"txs": [][]byte{raw}}}}})
		case "/block_results":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"height": "17", "txs_results": []map[string]any{{"code": 0, "gas_used": "25000"}}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	result, code, err := gateway.evmSendRawTransaction(context.Background(), json.RawMessage(fmt.Sprintf(`["0x%x"]`, raw)))
	if err != nil || code != 0 || result != original.Hash {
		t.Fatalf("original signed broadcast failed: %v %d %v", result, code, err)
	}
	indexed, mapped, found, err := gateway.committedTransaction(context.Background(), original.Hash)
	if err != nil || !found || !bytes.Equal(indexed.Tx, raw) || mapped.Fee != 1 || mapped.Amount != original.Amount {
		t.Fatal("original committed readback changed bytes or ledger result", err)
	}
	if projected := evmCommittedTransaction(mapped, indexed.Index, indexed.Tx); projected["value"] != "0x1bc16d674ec80000" || projected["gas"] != "0x7530" || projected["hash"] != original.Hash {
		t.Fatal("original signed readback changed EVM value, budget or hash", projected)
	}
}
