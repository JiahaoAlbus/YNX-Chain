package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

type countingAuthorityGate struct{ calls *int }

func (g countingAuthorityGate) Authorize(context.Context) error {
	*g.calls++
	return nil
}

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
				authority, ok := got["sharedEndpointAuthority"].(map[string]any)
				if !ok || authority["bundledManifestPresent"] != true || authority["bundledFinancePinBuildVerified"] != true || authority["centralSignedManifestActive"] != false || authority["installedWalletCallbackVerified"] != false || authority["result"] != "BLOCKED_SHARED_AUTHORITY_EVIDENCE" {
					t.Fatalf("shared authority truth is missing: %s", output.String())
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
		if receipt != "" && (rc != 2 || report["result"] != "SANDBOX_WRITE_ACTIVATION_BLOCKED") {
			t.Fatalf("configured rc=%d report=%s", rc, output.String())
		}
		required, ok := report["requiredPreconditions"].([]any)
		if !ok || len(required) < 3 || required[0] != "Central-issued and signed shared endpoint authority manifest" || required[1] != "Finance pin bound to the current authority manifest" || required[2] != "installed Wallet callback verified read-only" {
			t.Fatalf("shared authority activation inputs are missing: %s", output.String())
		}
	}
}

func TestActivationPlanRequiresCredentialIndependentLocalReadiness(t *testing.T) {
	values := map[string]string{
		"FINANCE_TRADING_ENABLED":                         "true",
		"FINANCE_SANDBOX_WRITES_ENABLED":                  "true",
		"FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256": strings.Repeat("a", 64),
		"ALPACA_BROKER_CLIENT_ID":                         "fixture-id",
		"ALPACA_BROKER_CLIENT_SECRET":                     "fixture-secret",
		"YNX_FINANCE_STATE_PATH":                          "/protected/finance-state.json",
		"YNX_FINANCE_BROKER_VERIFY_ACCOUNT":               "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80",
		"YNX_FINANCE_BROKER_MAX_FEE_USD":                  "1",
		"YNX_FINANCE_BROKER_FEE_BOUND_SOURCE":             "operator_policy",
		"YNX_FINANCE_BROKER_FEE_EVIDENCE_REF":             "operator-policy:weekly-v3",
	}
	get := func(key string) string { return values[key] }
	networkCalls, readinessCalls := 0, 0
	var output bytes.Buffer
	rc := runWithReadiness([]string{"activation-plan", "--local-read-only"}, get, func(context.Context, brokerage.Config) (verificationResult, error) {
		networkCalls++
		return verificationResult{}, nil
	}, func(_ context.Context, path, databaseURL, account string, _ time.Time) (finance.BrokerActivationReadiness, error) {
		readinessCalls++
		if path != values["YNX_FINANCE_STATE_PATH"] || databaseURL != "" || account != values["YNX_FINANCE_BROKER_VERIFY_ACCOUNT"] {
			t.Fatalf("unexpected readiness inputs: %q %q %q", path, databaseURL, account)
		}
		return finance.BrokerActivationReadiness{StateBackend: "file-cas-single-host", MappingActive: true, WalletKeyLinked: true, ExecutionRequested: 1, TotalOrders: 1, StateConsistent: true, ReadyForWorkerDispatch: true}, nil
	}, &output)
	var report map[string]any
	if err := json.Unmarshal(output.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if rc != 2 || networkCalls != 0 || readinessCalls != 1 || report["networkAttempted"] != false || report["localReadOnlyAttempted"] != true || report["writeAttempted"] != false || report["localWorkerCandidateReady"] != true || report["externalActivationGatesReady"] != false || report["configurationReadyNotExecuted"] != true || report["result"] != "SANDBOX_LOCAL_WORKER_CANDIDATE_READY_EXTERNAL_GATES_UNVERIFIED" || strings.Contains(output.String(), "fixture-secret") {
		t.Fatalf("rc=%d network=%d readiness=%d report=%s", rc, networkCalls, readinessCalls, output.String())
	}
	readiness, ok := report["localReadiness"].(map[string]any)
	if !ok || readiness["stateConsistent"] != true || readiness["readyForWorkerDispatch"] != true || readiness["executionRequested"] != float64(1) {
		t.Fatalf("missing exact local readiness: %s", output.String())
	}
}

func TestActivationPlanLocalReadOnlyNeverInvokesCheckpointAuthority(t *testing.T) {
	values := map[string]string{
		"YNX_FINANCE_ENDPOINT_AUTHORITY_V2_NODE_BINARY":   "/usr/bin/node",
		"YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE": "/protected/manifest.json",
	}
	get := func(key string) string { return values[key] }
	authorityFactoryCalls, authorityCalls := 0, 0
	var output bytes.Buffer
	rc := runWithDependencies([]string{"activation-plan", "--local-read-only"}, get, func(context.Context, brokerage.Config) (verificationResult, error) {
		t.Fatal("provider network probe must not run")
		return verificationResult{}, nil
	}, func(context.Context, string, string, string, time.Time) (finance.BrokerActivationReadiness, error) {
		return finance.BrokerActivationReadiness{}, errors.New("state unavailable")
	}, func(finance.NodeEndpointAuthorityConfig) (finance.EndpointAuthorityGate, error) {
		authorityFactoryCalls++
		return countingAuthorityGate{calls: &authorityCalls}, nil
	}, &output)
	var report map[string]any
	if err := json.Unmarshal(output.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	authority, ok := report["sharedEndpointAuthority"].(map[string]any)
	if rc != 2 || authorityFactoryCalls != 0 || authorityCalls != 0 || !ok || authority["configured"] != true || authority["verificationAttempted"] != false || authority["checkpointMayAdvance"] != false || authority["centralSignedManifestActive"] != false {
		t.Fatalf("rc=%d factory=%d authority=%d report=%s", rc, authorityFactoryCalls, authorityCalls, output.String())
	}
}

func TestExplicitNetworkDiagnosticInvokesCheckpointAuthorityOnce(t *testing.T) {
	values := map[string]string{
		"FINANCE_TRADING_ENABLED":                         "true",
		"ALPACA_BROKER_CLIENT_ID":                         "fixture-id",
		"ALPACA_BROKER_CLIENT_SECRET":                     "fixture-secret",
		"YNX_FINANCE_ENDPOINT_AUTHORITY_V2_NODE_BINARY":   "/usr/bin/node",
		"YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE": "/protected/manifest.json",
	}
	get := func(key string) string { return values[key] }
	authorityFactoryCalls, authorityCalls, networkCalls := 0, 0, 0
	var output bytes.Buffer
	rc := runWithDependencies([]string{"doctor", "--network-read-only"}, get, func(context.Context, brokerage.Config) (verificationResult, error) {
		networkCalls++
		return verificationResult{Assets: brokerage.AssetResult{Assets: []brokerage.Asset{}, RequestID: "fixture-request"}, Snapshot: brokerage.AccountSnapshot{Account: brokerage.Account{ID: "fixture-account"}}, Quote: brokerage.Quote{Symbol: "ACME"}}, nil
	}, func(context.Context, string, string, string, time.Time) (finance.BrokerActivationReadiness, error) {
		t.Fatal("local readiness probe must not run")
		return finance.BrokerActivationReadiness{}, nil
	}, func(finance.NodeEndpointAuthorityConfig) (finance.EndpointAuthorityGate, error) {
		authorityFactoryCalls++
		return countingAuthorityGate{calls: &authorityCalls}, nil
	}, &output)
	var report map[string]any
	if err := json.Unmarshal(output.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	authority, ok := report["sharedEndpointAuthority"].(map[string]any)
	if rc != 0 || authorityFactoryCalls != 1 || authorityCalls != 1 || networkCalls != 1 || !ok || authority["verificationAttempted"] != true || authority["checkpointMayAdvance"] != true || authority["centralSignedManifestActive"] != true || authority["result"] != "FINANCE_PRIVATE_AUTHORITY_VERIFIED_PROVIDER_GATES_FALSE" || strings.Contains(output.String(), "fixture-secret") {
		t.Fatalf("rc=%d factory=%d authority=%d network=%d report=%s", rc, authorityFactoryCalls, authorityCalls, networkCalls, output.String())
	}
}

func TestActivationPlanLocalReadinessFailureNeverFallsBackToNetwork(t *testing.T) {
	values := map[string]string{
		"FINANCE_TRADING_ENABLED":             "true",
		"ALPACA_BROKER_CLIENT_ID":             "fixture-id",
		"ALPACA_BROKER_CLIENT_SECRET":         "fixture-secret",
		"YNX_FINANCE_BROKER_MAX_FEE_USD":      "1",
		"YNX_FINANCE_BROKER_FEE_BOUND_SOURCE": "operator_policy",
		"YNX_FINANCE_BROKER_FEE_EVIDENCE_REF": "operator-policy:weekly-v3",
	}
	var output bytes.Buffer
	networkCalls := 0
	rc := runWithReadiness([]string{"activation-plan", "--local-read-only"}, func(key string) string { return values[key] }, func(context.Context, brokerage.Config) (verificationResult, error) {
		networkCalls++
		return verificationResult{}, nil
	}, func(context.Context, string, string, string, time.Time) (finance.BrokerActivationReadiness, error) {
		return finance.BrokerActivationReadiness{}, errors.New("state unavailable")
	}, &output)
	if rc != 2 || networkCalls != 0 || !strings.Contains(output.String(), `"localReadinessResult":"LOCAL_READINESS_UNAVAILABLE"`) || strings.Contains(output.String(), "fixture-secret") {
		t.Fatalf("rc=%d network=%d report=%s", rc, networkCalls, output.String())
	}
}
