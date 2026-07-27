package dex

import (
	"strings"
	"testing"
)

func TestStableVaultMethodsRegistered(t *testing.T) {
	cases := map[string]string{
		"stableSwapExactInput(uint256,address,address,uint256,uint256,uint256)":  "stableSwapExactInput",
		"stableSwapExactOutput(uint256,address,address,uint256,uint256,uint256)": "stableSwapExactOutput",
		"stableAddLiquidity(uint256,address,uint256,uint256,uint256,uint256)":    "stableAddLiquidity",
		"stableRemoveLiquidity(uint256,address,uint256,uint256,uint256,uint256)": "stableRemoveLiquidity",
	}
	for signature, expected := range cases {
		selector := strings.ToLower(functionSelector(signature))
		if actual := vaultMethods[selector]; actual != expected {
			t.Fatalf("selector %s resolved to %q, want %q", selector, actual, expected)
		}
	}
}
