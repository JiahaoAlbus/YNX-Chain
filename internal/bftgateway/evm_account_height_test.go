package bftgateway

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestEVMAccountReadRejectsSnapshotHeightMismatch(t *testing.T) {
	const owner = "0x1111111111111111111111111111111111111111"
	var accountHeight = "10"
	var missing bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"node_info": map[string]any{"network": "ynx_6423-1"}, "sync_info": map[string]any{"earliest_block_height": "1", "latest_block_height": "10", "earliest_block_hash": strings.Repeat("a", 64), "latest_block_hash": strings.Repeat("b", 64), "earliest_block_time": "2026-01-01T00:00:00Z", "latest_block_time": "2026-01-01T00:00:00Z"}}})
		case "/validators":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"validators": []any{map[string]any{}, map[string]any{}, map[string]any{}, map[string]any{}}}})
		case "/abci_query":
			if r.URL.Query().Get("height") != "10" {
				t.Errorf("account query was not pinned to committed height: %s", r.URL.RawQuery)
			}
			account, err := json.Marshal(chain.ConsensusAccount{Address: owner, Balance: 7, Nonce: 3})
			if err != nil {
				t.Fatal(err)
			}
			response := map[string]any{"height": accountHeight, "code": 0, "value": base64.StdEncoding.EncodeToString(account)}
			if missing {
				response = map[string]any{"height": accountHeight, "code": 1, "log": "YNX account not found"}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": response}})
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()
	for _, method := range []string{"eth_getBalance", "eth_getTransactionCount"} {
		request := `{"jsonrpc":"2.0","id":1,"method":"` + method + `","params":["` + owner + `","0xa"]}`
		for _, height := range []string{"9", "11", "", "010"} {
			accountHeight = height
			assertRPCError(t, server.URL+"/evm", request, -32602)
		}
		accountHeight = "11"
		missing = true
		assertRPCError(t, server.URL+"/evm", request, -32602)
		accountHeight = "10"
		missing = true
		assertRPCResult(t, server.URL+"/evm", request, "0x0")
		missing = false
		if strings.HasSuffix(method, "Balance") {
			assertRPCResult(t, server.URL+"/evm", request, "0x6124fee993bc0000")
		} else {
			assertRPCResult(t, server.URL+"/evm", request, "0x3")
		}
	}
}

func TestEVMContractReadRejectsSnapshotHeightMismatch(t *testing.T) {
	const address = "0x1111111111111111111111111111111111111111"
	height := "11"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"node_info": map[string]any{"network": "ynx_6423-1"}, "sync_info": map[string]any{"earliest_block_height": "1", "latest_block_height": "10", "earliest_block_hash": strings.Repeat("a", 64), "latest_block_hash": strings.Repeat("b", 64), "earliest_block_time": "2026-01-01T00:00:00Z", "latest_block_time": "2026-01-01T00:00:00Z"}}})
		case "/validators":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"validators": []any{map[string]any{}, map[string]any{}, map[string]any{}, map[string]any{}}}})
		case "/abci_query":
			if r.URL.Query().Get("height") != "10" {
				t.Errorf("contract query was not pinned to committed height: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"height": height, "code": 1, "log": "IDE contract not found"}}})
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()
	code := `{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["` + address + `","0xa"]}`
	storage := `{"jsonrpc":"2.0","id":2,"method":"eth_getStorageAt","params":["` + address + `","0x0","0xa"]}`
	call := `{"jsonrpc":"2.0","id":3,"method":"eth_call","params":[{"to":"` + address + `","data":"0x12345678"},"0xa"]}`
	estimate := `{"jsonrpc":"2.0","id":4,"method":"eth_estimateGas","params":[{"to":"` + address + `","data":"0x12345678"},"0xa"]}`
	for _, bad := range []string{"9", "11", "", "010"} {
		height = bad
		assertRPCError(t, server.URL+"/evm", code, -32603)
		assertRPCError(t, server.URL+"/evm", storage, -32603)
		assertRPCError(t, server.URL+"/evm", call, -32603)
		assertRPCError(t, server.URL+"/evm", estimate, -32603)
	}
	height = "10"
	assertRPCResult(t, server.URL+"/evm", code, "0x")
	assertRPCResult(t, server.URL+"/evm", storage, "0x"+strings.Repeat("0", 64))
	assertRPCError(t, server.URL+"/evm", call, -32000)
	assertRPCError(t, server.URL+"/evm", estimate, -32000)
}
