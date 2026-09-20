package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
)

func TestEthereumNativeBlockProjectionBoundary(t *testing.T) {
	for _, count := range []int{1200, 1201} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
			if err := d.SetEthereumNativeTransfers(true); err != nil {
				t.Fatal(err)
			}
			key := testExchangeKey(86)
			from, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := d.Faucet(from, 5000); err != nil {
				t.Fatal(err)
			}
			d.ProduceBlock()
			s := newServerWithConfig(d, ServerConfig{})
			var last chain.Transaction
			for n := 1; n <= count; n++ {
				payload, _ := testSignedTransfer(t, key, "0x3535353535353535353535353535353535353535", 1, uint64(n), 6423)
				last, _, err = s.submitSignedTransaction(payload)
				if err != nil {
					t.Fatal(err)
				}
			}
			d.ProduceBlock()
			// Materialize the large synthetic batch once before querying durable
			// receipts; per-transfer persistence is unrelated to gas boundaries.
			payload, err := d.ReplicationSnapshotJSON()
			if err != nil {
				t.Fatal(err)
			}
			persistent, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if _, err = persistent.ApplyReplicationSnapshotJSON(payload, true); err != nil {
				t.Fatal(err)
			}
			d = persistent
			if err = d.SetEthereumNativeTransfers(true); err != nil {
				t.Fatal(err)
			}
			s = newServerWithConfig(d, ServerConfig{})
			block := d.LatestBlock()
			before, _ := d.Account(from)
			wantGas := hexQuantity(uint64(count) * ethnative.TransferGas)
			for _, query := range []struct{ method, identifier string }{
				{"eth_getBlockByNumber", hexQuantity(block.Height)},
				{"eth_getBlockByNumber", "latest"},
				{"eth_getBlockByHash", evmHash(block.Hash)},
			} {
				for _, full := range []bool{false, true} {
					response := s.rpcResponse(rpcRequest{JSONRPC: "2.0", ID: 1, Method: query.method, Params: []any{query.identifier, full}})
					if count == 1200 {
						if response.Error != nil {
							t.Fatalf("boundary block rejected: %+v", response)
						}
						result := response.Result.(map[string]any)
						if result["gasUsed"] != wantGas || result["gasLimit"] != wantGas || len(result["transactions"].([]any)) != count {
							t.Fatalf("boundary block projection lost fees or transactions: %v", result)
						}
					} else {
						rpcError, ok := response.Error.(map[string]any)
						if response.Result != nil || !ok || rpcError["code"] != -32004 {
							t.Fatalf("oversized block must be explicitly unsupported: %+v", response)
						}
						data := rpcError["data"].(map[string]any)
						if data["status"] != "native_block_projection_unsupported" || data["blockHash"] != evmHash(block.Hash) || data["blockNumber"] != hexQuantity(block.Height) || data["feeEquivalentGas"] != wantGas || data["projectionGasLimit"] != hexQuantity(ethnative.MaxGasLimit) || data["nativeBlockPath"] != fmt.Sprintf("/blocks/%d", block.Height) {
							t.Fatalf("unsupported response lacks exact public reconciliation data: %v", data)
						}
					}
				}
			}
			receipt, err := s.evmResult("eth_getTransactionReceipt", []any{last.Hash})
			if err != nil {
				t.Fatal(err)
			}
			r := receipt.(map[string]any)
			if r["cumulativeGasUsed"] != wantGas || r["gasUsed"] != hexQuantity(ethnative.TransferGas) {
				t.Fatalf("receipt fee accounting was truncated: %v", r)
			}
			out := httptest.NewRecorder()
			s.mux.ServeHTTP(out, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/blocks/%d", block.Height), nil))
			var native chain.Block
			if err := json.Unmarshal(out.Body.Bytes(), &native); err != nil || out.Code != http.StatusOK || !reflect.DeepEqual(native, block) {
				t.Fatalf("native block must remain complete: status=%d error=%v", out.Code, err)
			}
			after, _ := d.Account(from)
			if !reflect.DeepEqual(before, after) || after.Balance != 5000-int64(2*count) || after.Nonce != uint64(count) {
				t.Fatal("block projection changed account state")
			}
		})
	}
}
