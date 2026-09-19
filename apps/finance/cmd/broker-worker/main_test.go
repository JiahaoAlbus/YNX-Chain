package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestParseInvocationRequiresExactSingleWriteContract(t *testing.T) {
	state := filepath.Join(t.TempDir(), "finance.json")
	receipt := strings.Repeat("a", 64)
	get := func(key string) string {
		if key == "FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256" {
			return receipt
		}
		return ""
	}
	valid := []string{"dispatch-one", "--state", state, "--account", "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", "--order", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "--activation-receipt", receipt, "--confirm", "SANDBOX_WRITE_ONCE"}
	if _, err := parseInvocation(valid, get); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func([]string){
		"missing confirmation": func(args []string) { args[10] = "NO" },
		"receipt mismatch":     func(args []string) { args[8] = strings.Repeat("b", 64) },
		"relative state":       func(args []string) { args[2] = "finance.json" },
		"invalid account":      func(args []string) { args[4] = "ynx1invalid" },
		"invalid order":        func(args []string) { args[6] = "not-a-uuid" },
	} {
		t.Run(name, func(t *testing.T) {
			args := append([]string(nil), valid...)
			mutate(args)
			if _, err := parseInvocation(args, get); err == nil {
				t.Fatal("expected fail closed")
			}
		})
	}
}
