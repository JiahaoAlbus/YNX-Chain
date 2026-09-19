package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
	"strings"
	"testing"
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
				probe := func(context.Context, brokerage.Config) (brokerage.AssetResult, error) {
					calls++
					return brokerage.AssetResult{Provider: brokerage.Provider, Environment: "sandbox", Assets: []brokerage.Asset{}, RequestID: "fixture-request"}, nil
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
				if expected == 1 && (rc != 0 || got["result"] != "BROKER_ASSET_READ_VERIFIED_ONLY") {
					t.Fatal(output.String())
				}
			}
		}
	}
}
