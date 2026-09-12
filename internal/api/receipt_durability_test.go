package api

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mutationfreeze"
)

func requireDurability(t *testing.T, s *Server, hash, want string) map[string]any {
	t.Helper()
	result, err := s.evmResult("ynx_getTransactionDurability", []any{hash})
	if err != nil {
		t.Fatal(err)
	}
	proof := result.(map[string]any)
	if proof["version"] != "ynx-local-durability-v1" || proof["scope"] != "local-snapshot" || proof["status"] != want || proof["transactionHash"] != hash {
		t.Fatalf("wrong durability proof: %v", proof)
	}
	if want == "durable" || want == "pending_durable" {
		if !isCanonicalData(proof["checkpointBlockHash"].(string), 32) || !isCanonicalData(proof["snapshotIntegrity"].(string), 32) {
			t.Fatalf("malformed checkpoint: %v", proof)
		}
		h, err := parseCanonicalQuantity(proof["checkpointBlockNumber"].(string))
		if err != nil {
			t.Fatal(err)
		}
		if want == "durable" {
			b, err := parseCanonicalQuantity(proof["blockNumber"].(string))
			if err != nil || b == 0 || h < b || !isCanonicalData(proof["blockHash"].(string), 32) {
				t.Fatalf("invalid mined binding: %v", proof)
			}
			r, err := s.evmResult("eth_getTransactionReceipt", []any{hash})
			if err != nil {
				t.Fatal(err)
			}
			receipt := r.(map[string]any)
			if !reflect.DeepEqual(receipt["ynxDurability"], proof) || receipt["blockHash"] != proof["blockHash"] || receipt["blockNumber"] != proof["blockNumber"] || receipt["transactionHash"] != proof["transactionHash"] {
				t.Fatalf("receipt proof mismatch: %v", receipt)
			}
			native := receipt["ynxNativeTransaction"].(map[string]any)
			transaction, _ := s.devnet.Transaction(hash)
			identity := receipt["ynxNativeIdentity"].(map[string]any)
			if native["type"] != "transfer" || native["amountYNXT"] != "2" || native["feeYNXT"] != "1" || native["nonce"] != "0x1" || len(native) != 4 || identity["from"] != transaction.From || identity["to"] != transaction.To {
				t.Fatalf("native tx binding: %v", receipt["ynxNativeTransaction"])
			}
		} else if _, ok := proof["blockNumber"]; ok {
			t.Fatal("pending proof claimed block inclusion")
		}
	} else if _, ok := proof["snapshotIntegrity"]; ok {
		t.Fatal("non-durable proof exposed checkpoint attestation")
	}
	return proof
}

func obstructReceiptCheckpoint(t *testing.T, path string) func() {
	t.Helper()
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "blocker"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	return func() {
		if err := os.RemoveAll(path); err != nil {
			t.Fatal(err)
		}
	}
}

func saveDurabilityFixture(t *testing.T, name string, value any) {
	t.Helper()
	if output := os.Getenv("YNX_DURABILITY_FIXTURE_OUTPUT"); output != "" {
		b, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(filepath.Dir(output), name), append(b, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestReceiptRequiresDurableInclusion(t *testing.T) {
	for _, phase := range []string{"admission-marker", "block-before-rename", "block-marker"} {
		t.Run(phase, func(t *testing.T) {
			dir := t.TempDir()
			d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
			if err != nil {
				t.Fatal(err)
			}
			v := loadRPCVectors(t)[0]
			if _, err = d.Faucet(v.Sender, 100); err != nil {
				t.Fatal(err)
			}
			d.ProduceBlock()
			if err = d.SetEthereumNativeTransfers(true); err != nil {
				t.Fatal(err)
			}
			s := newServerWithConfig(d, ServerConfig{})
			var clear func()
			if phase == "admission-marker" {
				clear = obstructReceiptCheckpoint(t, filepath.Join(dir, "devnet-state.integrity-version.tmp"))
			}
			_, err = s.evmResult("eth_sendRawTransaction", []any{v.Raw})
			if phase == "admission-marker" {
				if err == nil {
					t.Fatal("fault admission unexpectedly succeeded")
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				requireDurability(t, s, v.Hash, "pending_durable")
				path := "devnet-state.json.tmp"
				if phase == "block-marker" {
					path = "devnet-state.integrity-version.tmp"
				}
				clear = obstructReceiptCheckpoint(t, filepath.Join(dir, path))
			}
			d.ProduceBlock()
			requireDurability(t, s, v.Hash, "uncertain")
			uncertainReceipt := s.rpcResponse(rpcRequest{JSONRPC: "2.0", ID: 1, Method: "eth_getTransactionReceipt", Params: []any{v.Hash}})
			if tx, ok := d.Transaction(v.Hash); !ok || tx.BlockNum == 0 {
				t.Fatal("fault fixture did not expose in-memory inclusion")
			}
			if result, err := s.evmResult("eth_getTransactionReceipt", []any{v.Hash}); err == nil || result != nil {
				t.Errorf("uncheckpointed block exposed a complete receipt: result=%v err=%v", result, err)
			} else {
				var rpc *rpcMethodError
				if !errors.As(err, &rpc) || rpc.code != -32002 || rpc.data.(map[string]any)["status"] != "transaction_durability_uncertain" {
					t.Fatalf("missing structured uncertainty: %v", err)
				}
			}
			if result, err := s.evmResult("eth_sendRawTransaction", []any{v.Raw}); err == nil || result != nil {
				t.Errorf("replay failed to confirm block persistence: result=%v err=%v", result, err)
			}
			uncertainReplay := s.rpcResponse(rpcRequest{JSONRPC: "2.0", ID: 2, Method: "eth_sendRawTransaction", Params: []any{v.Raw}})
			clear()
			// A separate cold-copy constructor must confirm its own checkpoint;
			// merely observing the old file does not transfer process-local proof.
			coldDir := t.TempDir()
			for _, name := range []string{"devnet-state.json", "devnet-state.integrity-version"} {
				b, err := os.ReadFile(filepath.Join(dir, name))
				if err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(coldDir, name), b, 0600); err != nil {
					t.Fatal(err)
				}
			}
			cold, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), coldDir)
			if err != nil {
				t.Fatal(err)
			}
			coldServer := newServerWithConfig(cold, ServerConfig{})
			coldWant := "durable"
			if phase == "block-before-rename" {
				coldWant = "pending_durable"
			}
			requireDurability(t, coldServer, v.Hash, coldWant)
			if result, err := s.evmResult("eth_sendRawTransaction", []any{v.Raw}); err != nil || result != v.Hash {
				t.Fatalf("replay recovery: %v %v", result, err)
			}
			if result, err := s.evmResult("eth_getTransactionReceipt", []any{v.Hash}); err != nil || result == nil {
				t.Fatalf("recovered receipt: %v %v", result, err)
			}
			if acct, _ := d.Account(v.Sender); acct.Balance != 97 || acct.Nonce != 1 {
				t.Fatal("replay debited twice")
			}
			requireDurability(t, s, v.Hash, "durable")
			recovered, _ := s.evmResult("eth_getTransactionReceipt", []any{v.Hash})
			saveDurabilityFixture(t, "ethereum-"+phase+".json", map[string]any{"uncertainReceipt": uncertainReceipt, "uncertainReplay": uncertainReplay, "recoveredReceipt": recovered})
		})
	}
}

func TestNativeJSONDurabilityContractAndColdRestart(t *testing.T) {
	dir := t.TempDir()
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	key := testExchangeKey(47)
	from, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = d.Faucet(from, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	payload, _ := testSignedTransfer(t, key, "0x3535353535353535353535353535353535353535", 2, 1, 6423)
	hash := consensus.SignedTransactionHash(payload)
	s := newServerWithConfig(d, ServerConfig{}) // Native JSON, adapter disabled.
	if d.EthereumNativeTransfersEnabled() {
		t.Fatal("fixture must test disabled adapter")
	}
	model, err := s.evmResult("ynx_getDurabilityModel", nil)
	if err != nil || model.(map[string]any)["version"] != chain.TransactionDurabilityVersion || model.(map[string]any)["consensusFinality"] != false {
		t.Fatalf("model: %v %v", model, err)
	}
	fee, err := s.evmResult("ynx_getFeeModel", nil)
	if err != nil || !reflect.DeepEqual(fee.(map[string]any)["durability"], model) {
		t.Fatal("fee model omitted independent capability")
	}
	requireDurability(t, s, hash, "not_found")
	if r, err := s.evmResult("eth_sendRawTransaction", []any{"0x" + hex.EncodeToString(payload)}); err != nil || r != hash {
		t.Fatalf("native JSON raw: %v %v", r, err)
	}
	requireDurability(t, s, hash, "pending_durable")
	if r, err := s.evmResult("eth_getTransactionReceipt", []any{hash}); err != nil || r != nil {
		t.Fatal("pending native tx got mined receipt")
	}
	d.ProduceBlock()
	proof := requireDurability(t, s, hash, "durable")
	cold, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	coldProof := requireDurability(t, newServerWithConfig(cold, ServerConfig{}), hash, "durable")
	for _, field := range []string{"transactionHash", "blockHash", "blockNumber"} {
		if proof[field] != coldProof[field] {
			t.Fatal("cold inclusion changed")
		}
	}
	for _, params := range [][]any{nil, {strings.TrimPrefix(hash, "0x")}, {strings.ToUpper(hash)}, {1}, {hash, hash}} {
		if _, err = s.evmResult("ynx_getTransactionDurability", params); err == nil {
			t.Fatalf("accepted malformed hash params %v", params)
		}
	}
	if _, err = s.evmResult("ynx_getDurabilityModel", []any{hash}); err == nil {
		t.Fatal("accepted capability parameters")
	}
	// A machine-readable fixture uses only this synthetic signed native tx.
	if out := os.Getenv("YNX_DURABILITY_FIXTURE_OUTPUT"); out != "" {
		r, _ := s.evmResult("eth_getTransactionReceipt", []any{hash})
		b, err := json.MarshalIndent(map[string]any{"capability": model, "nativeJSONTransactionHash": hash, "durableReceipt": r, "coldProof": coldProof}, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(out, append(b, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMemoryOnlyReceiptNeverAttestsDurability(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	v := loadRPCVectors(t)[0]
	if _, err := d.Faucet(v.Sender, 100); err != nil {
		t.Fatal(err)
	}
	if err := d.SetEthereumNativeTransfers(true); err != nil {
		t.Fatal(err)
	}
	s := newServerWithConfig(d, ServerConfig{})
	if _, err := s.evmResult("eth_sendRawTransaction", []any{v.Raw}); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	requireDurability(t, s, v.Hash, "memory_only")
	r, err := s.evmResult("eth_getTransactionReceipt", []any{v.Hash})
	var rpc *rpcMethodError
	if r != nil || !errors.As(err, &rpc) || rpc.code != -32004 || rpc.data.(map[string]any)["status"] != "transaction_durability_unavailable" {
		t.Fatalf("memory-only receipt claimed confirmation: %v %v", r, err)
	}
}

func TestDurabilityQueriesStayReadOnlyOnFrozenFollower(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
		if err := d.SetEthereumNativeTransfers(enabled); err != nil {
			t.Fatal(err)
		}
		marker := filepath.Join(t.TempDir(), "freeze")
		if err := os.WriteFile(marker, []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
		handler := mutationfreeze.Wrap(NewServerWithConfig(d, ServerConfig{ReadOnlyReplica: true}), marker)
		query := `[{"jsonrpc":"2.0","id":1,"method":"ynx_getDurabilityModel","params":[]},{"jsonrpc":"2.0","id":2,"method":"ynx_getTransactionDurability","params":["0x` + strings.Repeat("a", 64) + `"]}]`
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, httptest.NewRequest(http.MethodPost, "/evm", strings.NewReader(query)))
		if out.Code != 200 || strings.Contains(out.Body.String(), `"error"`) || !strings.Contains(out.Body.String(), `"not_found"`) {
			t.Fatalf("read-only durability blocked: %d %s", out.Code, out.Body.String())
		}
		mixed := strings.TrimSuffix(query, "]") + `,{"jsonrpc":"2.0","id":3,"method":"eth_sendRawTransaction","params":["0x01"]}]`
		out = httptest.NewRecorder()
		handler.ServeHTTP(out, httptest.NewRequest(http.MethodPost, "/evm", strings.NewReader(mixed)))
		if out.Code != 503 {
			t.Fatalf("mixed batch escaped freeze: %d", out.Code)
		}
	}
}
