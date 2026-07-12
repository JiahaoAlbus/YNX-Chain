package bftgateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestCommittedCumulativeGasUsesBlockResultEvidence(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/block_results" || r.URL.Query().Get("height") != "27" {
			t.Fatalf("unexpected request: %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{
			"height": "27",
			"txs_results": []map[string]any{
				{"code": 0, "gas_used": "2"},
				{"code": 0, "gas_used": "3"},
			},
		}})
	}))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	cumulative, err := gateway.committedCumulativeGas(t.Context(), 27, 1, 3)
	if err != nil || cumulative != 5 {
		t.Fatalf("unexpected cumulative gas result %d: %v", cumulative, err)
	}
	if _, err := gateway.committedCumulativeGas(t.Context(), 27, 1, 4); err == nil {
		t.Fatal("mismatched transaction/block gas evidence did not fail closed")
	}
	if _, err := gateway.committedCumulativeGas(t.Context(), 27, 2, 0); err == nil {
		t.Fatal("out-of-range transaction index did not fail closed")
	}
}

func TestCommittedEVMFilterValidationHelpers(t *testing.T) {
	if height, err := parseCommittedBlockTag(json.RawMessage(`"0x11"`), 11, 17); err != nil || height != 17 {
		t.Fatalf("valid committed block tag rejected: %d %v", height, err)
	}
	for _, raw := range []string{`"0x01"`, `"pending"`, `"0xa"`, `17`} {
		if _, err := parseCommittedBlockTag(json.RawMessage(raw), 11, 17); err == nil {
			t.Fatalf("invalid committed block tag accepted: %s", raw)
		}
	}
	if err := validateEVMAddresses(json.RawMessage(`"0x0000000000000000000000000000000000000001"`)); err != nil {
		t.Fatal(err)
	}
	if err := validateEVMAddresses(json.RawMessage(`"0x000000000000000000000000000000000000000A"`)); err == nil {
		t.Fatal("mixed-case log address did not fail closed")
	}
	if err := validateEVMTopics(json.RawMessage(`[null,"0x0000000000000000000000000000000000000000000000000000000000000001"]`)); err != nil {
		t.Fatal(err)
	}
	if err := validateEVMTopics(json.RawMessage(`["0x01"]`)); err == nil {
		t.Fatal("short log topic did not fail closed")
	}
	if err := validateCommittedLogRange(1, 1000); err != nil {
		t.Fatalf("1000-block range rejected: %v", err)
	}
	if err := validateCommittedLogRange(1, 1001); err == nil {
		t.Fatal("overbroad 1001-block range did not fail closed")
	}
}

func TestCommittedApplicationActionUsesNullRecipient(t *testing.T) {
	tx := evmCommittedTransaction(chain.Transaction{Hash: "0x" + strings.Repeat("1", 64), From: "0x" + strings.Repeat("2", 40), Nonce: 2, BlockHash: strings.Repeat("3", 64), BlockNum: 9}, 0)
	if tx["to"] != nil || tx["value"] != "0x0" || tx["input"] != "0x" {
		t.Fatalf("application action transaction fields are not Ethereum-compatible: %+v", tx)
	}
}
