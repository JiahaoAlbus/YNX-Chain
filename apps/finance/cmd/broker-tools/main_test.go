package main

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

func TestCommandsRequireExplicitReadonlyNetworkAndNeverClaimWorkflowVerified(t *testing.T) {
	for _, mode := range []string{"doctor", "sandbox-verify"} {
		for _, network := range []bool{false, true} {
			for _, configured := range []bool{false, true} {
				args := []string{mode}
				if network {
					args = append(args, "--network-read-only")
				}
				calls := 0
				var output bytes.Buffer
				get := func(k string) string {
					if !configured {
						return ""
					}
					switch k {
					case "FINANCE_TRADING_ENABLED":
						return "true"
					case "ALPACA_BROKER_CLIENT_ID":
						return "fixture-id"
					case "ALPACA_BROKER_CLIENT_SECRET":
						return "fixture-secret"
					}
					return ""
				}
				probe := func(context.Context, brokerage.Config) (verificationResult, error) {
					calls++
					return verificationResult{Assets: brokerage.AssetResult{Provider: brokerage.Provider, Environment: "sandbox", Assets: []brokerage.Asset{}, RequestID: "fixture-request"}, Snapshot: brokerage.AccountSnapshot{Account: brokerage.Account{ID: "fixture-account"}}, Quote: brokerage.Quote{Symbol: "ACME"}, StoreMode: "file-cas-single-host"}, nil
				}
				rc := runWith(args, get, probe, &output)
				var got map[string]any
				if json.Unmarshal(output.Bytes(), &got) != nil {
					t.Fatal(output.String())
				}
				expected := 0
				if network && configured {
					expected = 1
				}
				if calls != expected || got["officialSandboxVerified"] != false || got["writeAttempted"] != false || strings.Contains(output.String(), "fixture-secret") {
					t.Fatal(args, calls, rc, output.String())
				}
				if expected == 1 && (rc != 0 || got["result"] != "BROKER_OWNER_READS_VERIFIED_ONLY" || got["accountLinkVerified"] != true || got["dataEntitlementVerified"] != true) {
					t.Fatal(output.String())
				}
			}
		}
	}
}

func TestActivationPlanRequiresReceiptButNeverTouchesNetworkOrWrites(t *testing.T) {
	for _, receipt := range []string{"", strings.Repeat("a", 64)} {
		calls := 0
		var output bytes.Buffer
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
		rc := runWith([]string{"activation-plan"}, get, func(context.Context, brokerage.Config) (verificationResult, error) {
			calls++
			return verificationResult{}, nil
		}, &output)
		var report map[string]any
		if err := json.Unmarshal(output.Bytes(), &report); err != nil {
			t.Fatal(err)
		}
		if calls != 0 || report["networkAttempted"] != false || report["writeAttempted"] != false || strings.Contains(output.String(), "fixture-secret") {
			t.Fatalf("rc=%d report=%s", rc, output.String())
		}
		if receipt == "" && rc != 2 {
			t.Fatalf("missing receipt rc=%d report=%s", rc, output.String())
		}
		if receipt != "" && (rc != 0 || report["result"] != "SANDBOX_WRITE_CONFIGURATION_READY_NOT_EXECUTED") {
			t.Fatalf("configured rc=%d report=%s", rc, output.String())
		}
	}
}
