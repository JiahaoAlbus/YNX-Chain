package bftgateway

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEVMFeeSuggestionMatchesZeroBaseFeeCompatibilityProfile(t *testing.T) {
	for _, method := range []string{"eth_gasPrice", "eth_maxPriorityFeePerGas"} {
		t.Run(method+" omitted params", func(t *testing.T) {
			got, err := evmFeeSuggestionResult(method, nil)
			if err != nil || got != "0x1" {
				t.Fatalf("unexpected fee suggestion: got=%q err=%v", got, err)
			}
		})
		t.Run(method+" empty params", func(t *testing.T) {
			got, err := evmFeeSuggestionResult(method, json.RawMessage(`[]`))
			if err != nil || got != "0x1" {
				t.Fatalf("unexpected fee suggestion: got=%q err=%v", got, err)
			}
		})
	}

	for _, test := range []struct {
		name   string
		method string
		params string
		want   string
	}{
		{name: "object params", method: "eth_gasPrice", params: `{}`, want: "array"},
		{name: "null params", method: "eth_gasPrice", params: `null`, want: "array"},
		{name: "extra params", method: "eth_maxPriorityFeePerGas", params: `["latest"]`, want: "does not accept"},
		{name: "unsupported method", method: "eth_feeHistory", params: `[]`, want: "unsupported"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := evmFeeSuggestionResult(test.method, json.RawMessage(test.params)); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q rejection, got %v", test.want, err)
			}
		})
	}
}
