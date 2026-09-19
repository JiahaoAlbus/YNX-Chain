// Read-only operator tools. No secrets/arguments are printed; no account creation,
// transfer, funding, order creation or cancellation routes are compiled here.
package main

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

func main() { os.Exit(run(os.Args[1:])) }
func run(args []string) int {
	return runWith(args, os.Getenv, func(ctx context.Context, cfg brokerage.Config) (brokerage.AssetResult, error) {
		return brokerage.NewAlpaca(cfg).Assets(ctx)
	}, os.Stdout)
}
func runWith(args []string, get func(string) string, probe func(context.Context, brokerage.Config) (brokerage.AssetResult, error), output io.Writer) int {
	mode := "doctor"
	network := false
	if len(args) > 0 {
		mode = args[0]
	}
	if (mode != "doctor" && mode != "sandbox-verify") || len(args) > 2 || (len(args) == 2 && args[1] != "--network-read-only") {
		_ = json.NewEncoder(output).Encode(map[string]any{"error": "USAGE: doctor|sandbox-verify [--network-read-only]"})
		return 2
	}
	network = len(args) == 2
	cfg := brokerage.LoadConfig(get)
	status := cfg.Status()
	report := map[string]any{"mode": mode, "configuration": status, "networkAttempted": false, "accountLinkVerified": false, "dataEntitlementVerified": false, "officialSandboxVerified": false, "productionApproved": false, "writeAttempted": false, "walletOrderApproval": "frozen_contract_internal_only", "durableOrderJournal": "implemented_state_v2", "providerPost": "disabled_unwired"}
	code := 0
	if mode == "sandbox-verify" && !network {
		report["result"] = "BLOCKED_OFFICIAL_SANDBOX_WRITE_CONFIRMATION"
		code = 2
	} else if network {
		if status.State != "CONFIGURED_NOT_VERIFIED" {
			report["result"] = "BLOCKED_CONFIGURATION"
			code = 2
		} else {
			report["networkAttempted"] = true
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			assets, err := probe(ctx, cfg)
			if err != nil {
				report["result"] = brokerage.ErrorCode(err)
				code = 1
			} else {
				report["result"] = "BROKER_ASSET_READ_VERIFIED_ONLY"
				report["assetCount"] = len(assets.Assets)
				report["providerRequestId"] = assets.RequestID
			}
		}
	} else {
		report["result"] = "CONFIGURATION_ONLY_NO_NETWORK"
		if status.State == "NOT_CONFIGURED" || status.State == "CONFIGURATION_REJECTED" {
			code = 2
		}
	}
	_ = json.NewEncoder(output).Encode(report)
	return code
}
