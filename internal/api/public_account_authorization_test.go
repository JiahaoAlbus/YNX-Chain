package api

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestPublicAccountMutationsRequireSignedTransactions(t *testing.T) {
	for _, network := range []string{"testnet", "mainnet"} {
		t.Run(network, func(t *testing.T) {
			cfg := chain.DefaultNetworkConfig(network)
			d := chain.NewDevnet(cfg)
			key := testExchangeKey(84)
			from, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
			to := "0x3535353535353535353535353535353535353535"
			if _, err := d.Faucet(from, 100); err != nil {
				t.Fatal(err)
			}
			d.ProduceBlock()
			server := httptest.NewServer(NewServer(d))
			defer server.Close()
			before, _ := d.Account(from)
			beforeJSON, _ := json.Marshal(before)
			for _, path := range []string{"/transfer", "/staking/stake", "/ide/deploy", "/ide/execute"} {
				var response map[string]any
				doJSON(t, http.MethodPost, server.URL+path, map[string]any{"from": from, "address": from, "deployer": from, "to": to, "amount": 2}, http.StatusForbidden, &response)
			}
			var rpcResponse map[string]any
			doRPC(t, server.URL, "eth_sendTransaction", []any{map[string]any{"from": from, "to": to, "data": "0x12345678"}}, &rpcResponse)
			assertRPCErrorCode(t, rpcResponse, -32601)
			after, _ := d.Account(from)
			afterJSON, _ := json.Marshal(after)
			if !reflect.DeepEqual(beforeJSON, afterJSON) || d.Status()["pendingTxCount"] != 0 {
				t.Fatal("rejected unsigned request changed account state or pending transactions")
			}
			if _, exists := d.Account(to); exists {
				t.Fatal("rejected unsigned request created recipient account")
			}
			payload, _ := testSignedTransfer(t, key, to, 2, 1, cfg.ChainID)
			var accepted map[string]any
			doRawJSON(t, server.URL+"/transactions/broadcast", payload, http.StatusCreated, &accepted)
			account, _ := d.Account(from)
			if account.Balance != 97 || account.Nonce != 1 {
				t.Fatalf("valid signed transfer failed after unsigned rejection: %+v", account)
			}
		})
	}
}

func TestBroadcastReportsUncertainDurabilityAndStableRetry(t *testing.T) {
	for _, mode := range []string{"REST", "native RPC", "Ethereum RPC"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
			if err != nil {
				t.Fatal(err)
			}
			key := testExchangeKey(85)
			from, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
			payload, _ := testSignedTransfer(t, key, "0x3535353535353535353535353535353535353535", 2, 1, 6423)
			hash := consensus.SignedTransactionHash(payload)
			if mode == "Ethereum RPC" {
				v := loadRPCVectors(t)[0]
				from, hash = v.Sender, v.Hash
				payload, err = hex.DecodeString(strings.TrimPrefix(v.Raw, "0x"))
				if err != nil {
					t.Fatal(err)
				}
				if err := d.SetEthereumNativeTransfers(true); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := d.Faucet(from, 100); err != nil {
				t.Fatal(err)
			}
			d.ProduceBlock()
			marker := filepath.Join(dir, "devnet-state.integrity-version")
			if err := os.Remove(marker); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(marker, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(marker, "blocked"), []byte("fixture"), 0600); err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(NewServer(d))
			defer server.Close()
			var response map[string]any
			if mode == "REST" {
				doRawJSON(t, server.URL+"/transactions/broadcast", payload, http.StatusServiceUnavailable, &response)
				if response["status"] != "transaction_durability_uncertain" || response["transactionHash"] != hash {
					t.Fatalf("missing uncertain transaction identity: %v", response)
				}
			} else {
				doRPC(t, server.URL, "eth_sendRawTransaction", []any{"0x" + hex.EncodeToString(payload)}, &response)
				assertRPCErrorCode(t, response, -32002)
				data := response["error"].(map[string]any)["data"].(map[string]any)
				if data["transactionHash"] != hash || data["status"] != "transaction_durability_uncertain" {
					t.Fatalf("missing RPC reconciliation data: %v", response)
				}
			}
			encoded, _ := json.Marshal(response)
			if strings.Contains(string(encoded), dir) {
				t.Fatal("broadcast error exposed node filesystem path")
			}
			if _, exists := d.Transaction(hash); !exists {
				t.Fatal("uncertain transaction must remain available for reconciliation")
			}
			if err := os.RemoveAll(marker); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(marker, []byte("2\n"), 0600); err != nil {
				t.Fatal(err)
			}
			if mode == "REST" {
				doRawJSON(t, server.URL+"/transactions/broadcast", payload, http.StatusOK, &response)
				if response["replayed"] != true {
					t.Fatalf("repaired exact retry was not idempotent: %v", response)
				}
			} else {
				assertRPCResultValue(t, server.URL, "eth_sendRawTransaction", []any{"0x" + hex.EncodeToString(payload)}, hash)
			}
			a, _ := d.Account(from)
			if a.Balance != 97 || a.Nonce != 1 {
				t.Fatalf("retry changed already accepted balance/nonce: %+v", a)
			}
		})
	}
}
