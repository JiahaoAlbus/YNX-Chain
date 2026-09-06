package api

import (
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mutationfreeze"
)

type rpcEthereumFixture struct {
	Name, Raw, Hash, Sender string
	Valid                   bool
}

func loadRPCVectors(t *testing.T) []rpcEthereumFixture {
	t.Helper()
	data, err := os.ReadFile("../../testdata/ethereum-native/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ Vectors []rpcEthereumFixture }
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.Vectors
}

func TestEthereumNativeRPCFeeLifecycle(t *testing.T) {
	vectors := loadRPCVectors(t)
	v := vectors[0]
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_, _ = d.Faucet(v.Sender, 100)
	d.ProduceBlock()
	s := newServerWithConfig(d, ServerConfig{})
	old, err := s.evmResult("eth_getBalance", []any{v.Sender, "latest"})
	if err != nil || old != "0x64" {
		t.Fatal("disabled mode changed legacy balance")
	}
	_ = d.SetEthereumNativeTransfers(true)
	server := httptest.NewServer(NewServer(d))
	defer server.Close()
	assertRPCResultValue(t, server.URL, "eth_chainId", nil, "0x1917")
	assertRPCResultValue(t, server.URL, "eth_gasPrice", nil, ethnative.Quantity(big.NewInt(ethnative.GasPriceWei)))
	assertRPCResultValue(t, server.URL, "eth_getBalance", []any{v.Sender, "latest"}, ethnative.Quantity(ethnative.Wei(100)))
	assertRPCResultValue(t, server.URL, "eth_getCode", []any{v.Sender, "latest"}, "0x")
	to := "0x3535353535353535353535353535353535353535"
	call := map[string]any{"from": v.Sender, "to": to, "value": ethnative.Quantity(ethnative.Wei(2))}
	assertRPCResultValue(t, server.URL, "eth_estimateGas", []any{call}, hexQuantity(ethnative.TransferGas))
	var before map[string]any
	doRPC(t, server.URL, "eth_getBlockByNumber", []any{"latest", false}, &before)
	if _, exists := before["result"].(map[string]any)["baseFeePerGas"]; exists {
		t.Fatal("legacy adapter advertised EIP-1559")
	}
	assertRPCResultValue(t, server.URL, "eth_sendRawTransaction", []any{v.Raw}, v.Hash)
	assertRPCResultValue(t, server.URL, "eth_getTransactionReceipt", []any{v.Hash}, nil)
	assertRPCResultValue(t, server.URL, "eth_getTransactionCount", []any{v.Sender, "pending"}, "0x1")
	assertRPCResultValue(t, server.URL, "eth_getBalance", []any{v.Sender, "pending"}, ethnative.Quantity(ethnative.Wei(97)))
	d.ProduceBlock()
	var receipt, transaction map[string]any
	doRPC(t, server.URL, "eth_getTransactionReceipt", []any{v.Hash}, &receipt)
	doRPC(t, server.URL, "eth_getTransactionByHash", []any{v.Hash}, &transaction)
	r := receipt["result"].(map[string]any)
	tx := transaction["result"].(map[string]any)
	gas, _ := ethnative.ParseQuantity(r["gasUsed"].(string))
	price, _ := ethnative.ParseQuantity(r["effectiveGasPrice"].(string))
	if new(big.Int).Mul(gas, price).Cmp(ethnative.Wei(1)) != 0 || tx["nonce"] != "0x0" || tx["value"] != ethnative.Quantity(ethnative.Wei(2)) || tx["gasPrice"] != r["effectiveGasPrice"] || len(r["logs"].([]any)) != 1 {
		t.Fatalf("fee/nonce/value mismatch: tx=%v receipt=%v", tx, r)
	}
	assertRPCResultValue(t, server.URL, "eth_sendRawTransaction", []any{v.Raw}, v.Hash)
	assertRPCResultValue(t, server.URL, "eth_getBalance", []any{v.Sender, "pending"}, ethnative.Quantity(ethnative.Wei(97)))
	assertRPCResultValue(t, server.URL, "eth_sendRawTransaction", []any{vectors[1].Raw}, vectors[1].Hash)
	assertRPCResultValue(t, server.URL, "eth_getBalance", []any{v.Sender, "pending"}, ethnative.Quantity(ethnative.Wei(94)))
	if account, _ := d.Account(v.Sender); account.Balance != 94 {
		t.Fatal("RPC scaling changed ledger units")
	}
}

func TestEthereumNativeRPCInvalidInputIsReadOnly(t *testing.T) {
	vectors := loadRPCVectors(t)
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_ = d.SetEthereumNativeTransfers(true)
	_, _ = d.Faucet(vectors[0].Sender, 100)
	d.ProduceBlock()
	s := newServerWithConfig(d, ServerConfig{})
	for _, v := range vectors {
		if !v.Valid {
			if _, err := s.evmResult("eth_sendRawTransaction", []any{v.Raw}); err == nil {
				t.Fatalf("invalid %s accepted", v.Name)
			}
		}
	}
	to := "0x3535353535353535353535353535353535353535"
	for _, params := range [][]any{nil, {"bad"}, {map[string]any{}}, {map[string]any{"to": to, "value": "0x1"}}, {map[string]any{"to": to, "value": "0x01"}}, {map[string]any{"to": to, "value": ethnative.Quantity(ethnative.Wei(1)), "gas": "0x5208"}}, {map[string]any{"to": to, "value": ethnative.Quantity(ethnative.Wei(1)), "maxFeePerGas": "0x1"}}, {map[string]any{"to": to, "value": ethnative.Quantity(ethnative.Wei(1)), "data": "0x01"}}, {map[string]any{"to": to, "value": ethnative.Quantity(ethnative.Wei(1))}, "earliest"}} {
		if _, err := s.evmResult("eth_estimateGas", params); err == nil {
			t.Fatalf("invalid estimate accepted: %v", params)
		}
	}
	for _, method := range []string{"eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_sendTransaction"} {
		if _, err := s.evmResult(method, nil); err == nil || err.(*rpcMethodError).code != -32004 {
			t.Fatalf("unsupported mode %s: %v", method, err)
		}
	}
	if _, err := s.evmResult("eth_gasPrice", []any{1}); err == nil || err.(*rpcMethodError).code != -32602 {
		t.Fatal("bad gasPrice params accepted")
	}
	if a, _ := d.Account(vectors[0].Sender); a.Balance != 100 || a.Nonce != 0 {
		t.Fatal("invalid RPC changed authoritative state")
	}
}

func TestEthereumFeesRemainReadableOnFrozenFollower(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_ = d.SetEthereumNativeTransfers(true)
	marker := t.TempDir() + "/freeze"
	if err := os.WriteFile(marker, []byte("frozen"), 0600); err != nil {
		t.Fatal(err)
	}
	handler := mutationfreeze.Wrap(NewServerWithConfig(d, ServerConfig{ReadOnlyReplica: true}), marker)
	for _, body := range []string{`{"jsonrpc":"2.0","id":1,"method":"eth_gasPrice","params":[]}`, `[{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]},{"jsonrpc":"2.0","id":2,"method":"eth_gasPrice","params":[]}]`} {
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, httptest.NewRequest(http.MethodPost, "/evm", strings.NewReader(body)))
		if out.Code != 200 || strings.Contains(out.Body.String(), `"error"`) {
			t.Fatalf("read blocked: %d %s", out.Code, out.Body.String())
		}
	}
	body := `[{"jsonrpc":"2.0","id":1,"method":"eth_gasPrice","params":[]},{"jsonrpc":"2.0","id":2,"method":"eth_sendRawTransaction","params":["0x01"]}]`
	out := httptest.NewRecorder()
	handler.ServeHTTP(out, httptest.NewRequest(http.MethodPost, "/evm", strings.NewReader(body)))
	if out.Code != 503 {
		t.Fatal("mixed write batch passed freeze")
	}
}
