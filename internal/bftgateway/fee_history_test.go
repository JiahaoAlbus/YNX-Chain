package bftgateway

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestEVMFeeHistoryUsesCommittedConsensusEvidence(t *testing.T) {
	gateway := newFeeHistoryGateway(t, feeHistoryFixture{maxGas: "100000", latestGasUsed: "21000"})

	result, code, err := gateway.evmFeeHistory(t.Context(), json.RawMessage(`["0x2","latest"]`))
	if err != nil || code != 0 {
		t.Fatalf("fee history failed: code=%d err=%v", code, err)
	}
	object := result.(map[string]any)
	if object["oldestBlock"] != "0x10" {
		t.Fatalf("unexpected oldest block: %+v", object)
	}
	baseFees := object["baseFeePerGas"].([]string)
	if len(baseFees) != 3 || baseFees[0] != "0x0" || baseFees[1] != "0x0" || baseFees[2] != "0x0" {
		t.Fatalf("unexpected base fee history: %+v", baseFees)
	}
	gasRatios := object["gasUsedRatio"].([]float64)
	if len(gasRatios) != 2 || gasRatios[0] != 0 || math.Abs(gasRatios[1]-0.21) > 1e-12 {
		t.Fatalf("unexpected gas ratios: %+v", gasRatios)
	}
	if _, ok := object["reward"]; ok {
		t.Fatalf("reward must be omitted when reward percentiles are omitted: %+v", object)
	}

	result, code, err = gateway.evmFeeHistory(t.Context(), json.RawMessage(`["0x5","latest",[]]`))
	if err != nil || code != 0 {
		t.Fatalf("clamped fee history failed: code=%d err=%v", code, err)
	}
	object = result.(map[string]any)
	if object["oldestBlock"] != "0x10" || len(object["gasUsedRatio"].([]float64)) != 2 || len(object["baseFeePerGas"].([]string)) != 3 {
		t.Fatalf("retained-range clamp is invalid: %+v", object)
	}
	rewards := object["reward"].([][]string)
	if len(rewards) != 2 || len(rewards[0]) != 0 || len(rewards[1]) != 0 {
		t.Fatalf("empty reward request must remain empty per block: %+v", rewards)
	}
}

func TestEVMFeeHistoryRejectsInvalidParametersAndUnavailableEvidence(t *testing.T) {
	gateway := newFeeHistoryGateway(t, feeHistoryFixture{maxGas: "100000", latestGasUsed: "21000"})
	for _, test := range []struct {
		name        string
		params      string
		wantCode    int
		wantMessage string
	}{
		{name: "null params", params: `null`, wantCode: -32602, wantMessage: "requires block count"},
		{name: "zero count", params: `["0x0","latest"]`, wantCode: -32602, wantMessage: "between 1 and"},
		{name: "excessive count", params: `["0x401","latest"]`, wantCode: -32602, wantMessage: "between 1 and"},
		{name: "non-canonical count", params: `["0x01","latest"]`, wantCode: -32602, wantMessage: "canonical"},
		{name: "pending newest", params: `["0x1","pending"]`, wantCode: evmFeeHistoryUnavailable, wantMessage: "retained committed block"},
		{name: "non-empty reward", params: `["0x1","latest",[50]]`, wantCode: -32602, wantMessage: "reward percentile history is unavailable"},
		{name: "null reward", params: `["0x1","latest",null]`, wantCode: -32602, wantMessage: "must be an array"},
		{name: "malformed reward", params: `["0x1","latest",{}]`, wantCode: -32602, wantMessage: "must be an array"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, code, err := gateway.evmFeeHistory(t.Context(), json.RawMessage(test.params))
			if err == nil || code != test.wantCode || !strings.Contains(err.Error(), test.wantMessage) {
				t.Fatalf("unexpected rejection: code=%d err=%v", code, err)
			}
		})
	}

	unbounded := newFeeHistoryGateway(t, feeHistoryFixture{maxGas: "-1", latestGasUsed: "21000"})
	if _, code, err := unbounded.evmFeeHistory(t.Context(), json.RawMessage(`["0x1","latest"]`)); err == nil || code != evmFeeHistoryUnavailable || !strings.Contains(err.Error(), "max_gas is not positive") {
		t.Fatalf("unbounded consensus gas must fail closed: code=%d err=%v", code, err)
	}

	overflow := newFeeHistoryGateway(t, feeHistoryFixture{maxGas: "20000", latestGasUsed: "21000"})
	if _, code, err := overflow.evmFeeHistory(t.Context(), json.RawMessage(`["0x1","latest"]`)); err == nil || code != -32603 || !strings.Contains(err.Error(), "exceeds consensus max_gas") {
		t.Fatalf("gas evidence mismatch must fail closed: code=%d err=%v", code, err)
	}
}

func TestGatewayRoutesCommittedFeeHistory(t *testing.T) {
	gateway := newFeeHistoryGateway(t, feeHistoryFixture{maxGas: "100000", latestGasUsed: "21000"})
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()

	result := assertRPCObject(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"eth_feeHistory","params":["0x2","latest"]}`)
	if result["oldestBlock"] != "0x10" {
		t.Fatalf("unexpected routed fee history: %+v", result)
	}
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":2,"method":"eth_feeHistory","params":["0x1","latest",[50]]}`, -32602)
}

type feeHistoryFixture struct {
	maxGas        string
	latestGasUsed string
}

func newFeeHistoryGateway(t *testing.T, fixture feeHistoryFixture) *Gateway {
	t.Helper()
	if fixture.maxGas == "" {
		fixture.maxGas = "100000"
	}
	if fixture.latestGasUsed == "" {
		fixture.latestGasUsed = "21000"
	}
	privateKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 21))
	recipientKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 22))
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	txPayload, _, err := consensus.NewEthereumDynamicFeeTransfer(privateKey, 6423, 0, 1, 2, recipient, 5)
	if err != nil {
		t.Fatal(err)
	}
	blockTime := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"node_info": map[string]any{"network": "ynx_6423-1"},
				"sync_info": map[string]any{
					"earliest_block_hash": strings.Repeat("A", 64), "earliest_block_height": "16", "earliest_block_time": blockTime.Add(-time.Second),
					"latest_block_hash": strings.Repeat("B", 64), "latest_block_height": "17", "latest_block_time": blockTime, "catching_up": false,
				},
			}})
		case "/validators":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"block_height": "17", "validators": []map[string]any{{}, {}, {}, {}}}})
		case "/block":
			height := r.URL.Query().Get("height")
			switch height {
			case "16":
				_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
					"block_id": map[string]any{"hash": strings.Repeat("A", 64)},
					"block": map[string]any{
						"header": map[string]any{"height": "16", "time": blockTime.Add(-time.Second), "proposer_address": strings.Repeat("1", 40), "app_hash": strings.Repeat("D", 64), "data_hash": "", "last_block_id": map[string]any{"hash": ""}},
						"data":   map[string]any{"txs": []string{}},
					},
				}})
			case "17":
				_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
					"block_id": map[string]any{"hash": strings.Repeat("B", 64)},
					"block": map[string]any{
						"header": map[string]any{"height": "17", "time": blockTime, "proposer_address": strings.Repeat("2", 40), "app_hash": strings.Repeat("E", 64), "data_hash": strings.Repeat("C", 64), "last_block_id": map[string]any{"hash": strings.Repeat("A", 64)}},
						"data":   map[string]any{"txs": []string{base64.StdEncoding.EncodeToString(txPayload)}},
					},
				}})
			default:
				t.Errorf("unexpected block height %q", height)
				http.Error(w, "unexpected block height", http.StatusBadRequest)
			}
		case "/block_results":
			height := r.URL.Query().Get("height")
			if height == "16" {
				_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"height": "16", "txs_results": []any{}}})
				return
			}
			if height != "17" {
				t.Errorf("unexpected block result height %q", height)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"height": "17", "txs_results": []map[string]any{{"code": 0, "log": "transfer", "gas_used": fixture.latestGasUsed}}}})
		case "/consensus_params":
			height := r.URL.Query().Get("height")
			if height != "16" && height != "17" {
				t.Errorf("unexpected consensus params height %q", height)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
				"block_height":     height,
				"consensus_params": map[string]any{"block": map[string]any{"max_gas": fixture.maxGas}},
			}})
		default:
			t.Errorf("unexpected upstream request: %s?%s", r.URL.Path, r.URL.RawQuery)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	return gateway
}

func TestFeeHistoryFixtureUsesCanonicalHeights(t *testing.T) {
	gateway := newFeeHistoryGateway(t, feeHistoryFixture{})
	result, code, err := gateway.evmFeeHistory(t.Context(), json.RawMessage(fmt.Sprintf(`["0x1",%q]`, "0x"+strconv.FormatUint(17, 16))))
	if err != nil || code != 0 || result.(map[string]any)["oldestBlock"] != "0x11" {
		t.Fatalf("canonical height lookup failed: code=%d result=%+v err=%v", code, result, err)
	}
}
