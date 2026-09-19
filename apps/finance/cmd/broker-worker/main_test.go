package main

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
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

func TestParseInvocationSupportsBoundedRecoveryCommands(t *testing.T) {
	state := filepath.Join(t.TempDir(), "finance.json")
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	receipt := strings.Repeat("a", 64)
	get := func(key string) string {
		if key == "FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256" {
			return receipt
		}
		return ""
	}
	valid := map[string][]string{
		"link-account": {"link-account", "--state", state, "--account", account, "--broker-account", "01234567-89ab-4cde-8fab-0123456789ab", "--wallet-public-key", "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "--confirm", "LINK_SANDBOX_ACCOUNT"},
		"query":        {"query", "--state", state, "--account", account, "--confirm", "READ_SANDBOX_ONCE"},
		"reconcile":    {"reconcile", "--state", state, "--account", account, "--confirm", "RECONCILE_SANDBOX_ONCE"},
		"apply-events": {"apply-events", "--state", state, "--account", account, "--confirm", "APPLY_SANDBOX_EVENTS_ONCE"},
		"cancel-one":   {"cancel-one", "--state", state, "--account", account, "--order", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "--activation-receipt", receipt, "--confirm", "SANDBOX_CANCEL_ONCE"},
	}
	for name, args := range valid {
		t.Run(name, func(t *testing.T) {
			if _, err := parseInvocation(args, get); err != nil {
				t.Fatal(err)
			}
			withExtra := append(append([]string(nil), args...), "--unexpected", "value")
			if _, err := parseInvocation(withExtra, get); err == nil {
				t.Fatal("unexpected argument accepted")
			}
		})
	}
}

func TestLinkAccountPersistsBrokerAndWalletIdentityWithoutNetwork(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := finance.OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	if err := store.Update(account, "fixture", "", func(*finance.AccountState) error { return nil }); err != nil {
		t.Fatal(err)
	}
	key := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	args := []string{"link-account", "--state", statePath, "--account", account, "--broker-account", "01234567-89ab-4cde-8fab-0123456789ab", "--wallet-public-key", key, "--confirm", "LINK_SANDBOX_ACCOUNT"}
	var stdout bytes.Buffer
	if code := run(args, func(string) string { return "" }, strings.NewReader(""), &stdout); code != 0 {
		t.Fatalf("code=%d stdout=%s", code, stdout.String())
	}
	var result map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil || result["walletKeyLinked"] != true {
		t.Fatalf("result=%v err=%v", result, err)
	}
	reopened, err := finance.OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := reopened.BrokerWalletPublicKey(account); err != nil || got != key {
		t.Fatalf("key=%q err=%v at=%s", got, err, time.Now().UTC())
	}
}
