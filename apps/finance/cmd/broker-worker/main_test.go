package main

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
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
		"link-account":    {"link-account", "--state", state, "--account", account, "--broker-account", "01234567-89ab-4cde-8fab-0123456789ab", "--wallet-public-key", "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "--confirm", "LINK_SANDBOX_ACCOUNT"},
		"query":           {"query", "--state", state, "--account", account, "--confirm", "READ_SANDBOX_ONCE"},
		"reconcile":       {"reconcile", "--state", state, "--account", account, "--confirm", "RECONCILE_SANDBOX_ONCE"},
		"apply-events":    {"apply-events", "--state", state, "--account", account, "--confirm", "APPLY_SANDBOX_EVENTS_ONCE"},
		"cancel-one":      {"cancel-one", "--state", state, "--account", account, "--order", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "--activation-receipt", receipt, "--confirm", "SANDBOX_CANCEL_ONCE"},
		"verify-approved": {"verify-approved", "--state", state, "--account", account, "--order", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "--activation-receipt", receipt, "--confirm", "SANDBOX_VERIFY_APPROVED_ORDER_ONCE"},
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

func TestControlledVerificationWithoutWriteActivationPerformsZeroProviderWrites(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := finance.OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	if err := store.Update(account, "fixture", "", func(*finance.AccountState) error { return nil }); err != nil {
		t.Fatal(err)
	}
	receipt := strings.Repeat("a", 64)
	get := func(key string) string {
		switch key {
		case "FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256":
			return receipt
		case "FINANCE_TRADING_ENABLED":
			return "true"
		case "ALPACA_BROKER_CLIENT_ID":
			return "fixture-id"
		case "ALPACA_BROKER_CLIENT_SECRET":
			return "fixture-secret"
		}
		return ""
	}
	var stdout bytes.Buffer
	code := run([]string{"verify-approved", "--state", statePath, "--account", account, "--order", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "--activation-receipt", receipt, "--confirm", "SANDBOX_VERIFY_APPROVED_ORDER_ONCE"}, get, strings.NewReader(""), &stdout)
	if code != 2 || !strings.Contains(stdout.String(), `"providerWriteAttempted":false`) || !strings.Contains(stdout.String(), "ORDER_SUBMISSION_DISABLED") {
		t.Fatalf("unauthorized controlled verification was not a zero-write rejection: code=%d output=%s", code, stdout.String())
	}
}

func TestControlledVerificationPreflightFailureReportsZeroProviderWrites(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := finance.OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	if err := store.Update(account, "fixture", "", func(*finance.AccountState) error { return nil }); err != nil {
		t.Fatal(err)
	}
	receipt := strings.Repeat("a", 64)
	get := func(key string) string {
		switch key {
		case "FINANCE_TRADING_ENABLED", "FINANCE_SANDBOX_WRITES_ENABLED":
			return "true"
		case "FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256":
			return receipt
		case "ALPACA_BROKER_CLIENT_ID":
			return "fixture-id"
		case "ALPACA_BROKER_CLIENT_SECRET":
			return "fixture-secret"
		}
		return ""
	}
	var stdout bytes.Buffer
	code := run([]string{"verify-approved", "--state", statePath, "--account", account, "--order", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "--activation-receipt", receipt, "--confirm", "SANDBOX_VERIFY_APPROVED_ORDER_ONCE"}, get, strings.NewReader(""), &stdout)
	if code != 1 || !strings.Contains(stdout.String(), `"error":"WALLET_APPROVAL_REQUIRED"`) || !strings.Contains(stdout.String(), `"providerWriteAttempted":false`) {
		t.Fatalf("preflight truth was not preserved: code=%d output=%s", code, stdout.String())
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
	secondAccount := "ynx172kmjz4z0g7xr22u2qrrkgy3nkq3u9rk768d6x"
	secondArgs := []string{"link-account", "--state", statePath, "--account", secondAccount, "--broker-account", "01234567-89ab-4cde-8fab-0123456789ab", "--wallet-public-key", key, "--confirm", "LINK_SANDBOX_ACCOUNT"}
	stdout.Reset()
	if code := run(secondArgs, func(string) string { return "" }, strings.NewReader(""), &stdout); code != 1 || !strings.Contains(stdout.String(), "ACCOUNT_LINK_REJECTED") {
		t.Fatalf("shared Broker account was not rejected: code=%d stdout=%s", code, stdout.String())
	}
}

func TestControlledVerificationReceiptSeparatesProviderCorrelations(t *testing.T) {
	now := time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC)
	dispatched := finance.BrokerOrderRecord{ProviderOrderID: "11111111-2222-4333-8444-555555555555", ProviderClientOrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", ProviderRawStatus: "accepted", ProviderHTTPRequestID: "http-submit-0001", ApprovalState: "consumed", State: "submitted"}
	canceled := dispatched
	canceled.ProviderRawStatus, canceled.ProviderHTTPRequestID, canceled.ProviderEventCursor, canceled.State = "pending_cancel", "http-cancel-0001", "sse-event-0001", "cancel_requested"
	audit := controlledVerificationAudit("ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", dispatched.ProviderClientOrderID, dispatched, canceled, brokerage.AccountSnapshot{RequestIDs: []string{"http-query-0001"}}, brokerage.AccountSnapshot{RequestIDs: []string{"http-final-0001"}}, now)
	if audit["dispatchHttpRequestId"] != "http-submit-0001" || audit["cancelHttpRequestId"] != "http-cancel-0001" || audit["providerEventCursor"] != "sse-event-0001" || audit["providerRawStatus"] != "pending_cancel" {
		t.Fatalf("audit=%+v", audit)
	}
}

func TestUnconfiguredRecoveryCommandsFailExplicitlyWithoutInventedDataOrProviderWrite(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := finance.OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	key := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", key, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	get := func(string) string { return "" }
	for name, test := range map[string]struct {
		args      []string
		stdin     string
		code      int
		errorCode string
		readOnly  bool
	}{
		"query":        {args: []string{"query", "--state", statePath, "--account", account, "--confirm", "READ_SANDBOX_ONCE"}, code: 1, errorCode: "BROKER_NOT_CONFIGURED", readOnly: true},
		"reconcile":    {args: []string{"reconcile", "--state", statePath, "--account", account, "--confirm", "RECONCILE_SANDBOX_ONCE"}, code: 1, errorCode: "BROKER_NOT_CONFIGURED", readOnly: true},
		"apply events": {args: []string{"apply-events", "--state", statePath, "--account", account, "--confirm", "APPLY_SANDBOX_EVENTS_ONCE"}, stdin: "not-sse", code: 1, errorCode: "TRADE_EVENT_APPLY_REJECTED", readOnly: true},
	} {
		t.Run(name, func(t *testing.T) {
			var stdout bytes.Buffer
			if code := run(test.args, get, strings.NewReader(test.stdin), &stdout); code != test.code {
				t.Fatalf("code=%d stdout=%s", code, stdout.String())
			}
			var result map[string]any
			if err := json.Unmarshal(stdout.Bytes(), &result); err != nil || result["error"] != test.errorCode {
				t.Fatalf("result=%v err=%v", result, err)
			}
			if test.readOnly && result["providerWriteAttempted"] != false {
				t.Fatalf("provider write truth=%v", result["providerWriteAttempted"])
			}
		})
	}
}

func TestConfiguredDatabaseNeverFallsBackToFileStore(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := finance.OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	if err := store.Update(account, "fixture", "", func(*finance.AccountState) error { return nil }); err != nil {
		t.Fatal(err)
	}
	get := func(key string) string {
		if key == "YNX_FINANCE_DATABASE_URL" {
			return "://invalid-postgres-dsn"
		}
		return ""
	}
	var stdout bytes.Buffer
	code := run([]string{"query", "--state", statePath, "--account", account, "--confirm", "READ_SANDBOX_ONCE"}, get, strings.NewReader(""), &stdout)
	if code != 1 || !strings.Contains(stdout.String(), `"configuredBackend":"postgres"`) {
		t.Fatalf("configured database fell back or was not explicit: code=%d output=%s", code, stdout.String())
	}
}
