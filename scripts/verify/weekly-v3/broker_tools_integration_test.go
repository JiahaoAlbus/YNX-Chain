//go:build weekly_v3_integration

package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"
)

func TestWeeklyV3DoctorRealReadOnlyProbeAndActivationTruth(t *testing.T) {
	for _, scenario := range []string{"doctor", "sandbox-verify", "no_network", "unentitled", "activation-plan"} {
		t.Run(scenario, func(t *testing.T) {
			cfg, _, provider := weeklyOperatorSetup(t)
			// Prevent ambient operator configuration from entering a local fixture.
			for _, pair := range os.Environ() {
				key, _, _ := strings.Cut(pair, "=")
				if strings.HasPrefix(key, "FINANCE_") || strings.HasPrefix(key, "ALPACA_") || strings.HasPrefix(key, "YNX_FINANCE_") || key == "YNX_CHAIN_ENV" || key == "YNX_EVM_CHAIN_ID" {
					t.Setenv(key, "")
				}
			}
			for key, value := range cfg {
				t.Setenv(key, value)
			}
			args := []string{"doctor", "--network-read-only"}
			if scenario == "sandbox-verify" {
				args[0] = scenario
			}
			if scenario == "unentitled" {
				provider.quoteStatus = 403
			}
			if scenario == "no_network" {
				args = []string{"doctor"}
			}
			if scenario == "activation-plan" {
				args = []string{scenario}
			}
			before, _ := os.ReadFile(cfg["YNX_FINANCE_STATE_PATH"])
			reader, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			original := os.Stdout
			os.Stdout = writer
			code := run(args)
			os.Stdout = original
			_ = writer.Close()
			output, err := io.ReadAll(reader)
			_ = reader.Close()
			if err != nil {
				t.Fatal(err)
			}
			var result map[string]any
			if err := json.Unmarshal(output, &result); err != nil {
				t.Fatal(err)
			}
			provider.mu.Lock()
			posts, deletes, reads := provider.posts, provider.deletes, provider.reads
			provider.mu.Unlock()
			if posts != 0 || deletes != 0 || result["writeAttempted"] != false || result["officialSandboxVerified"] != false {
				t.Fatalf("doctor escalated: %s writes=%d/%d", output, posts, deletes)
			}
			if scenario == "doctor" || scenario == "sandbox-verify" {
				if code != 0 || reads != 5 || result["accountLinkVerified"] != true || result["dataEntitlementVerified"] != true || result["stateBackend"] != "file-cas-single-host" {
					t.Fatalf("actual read probe: code=%d reads=%d %s", code, reads, output)
				}
			}
			if scenario == "unentitled" && (code == 0 || result["dataEntitlementVerified"] != false) {
				t.Fatal("missing data entitlement reported verified")
			}
			if (scenario == "no_network" || scenario == "activation-plan") && reads != 0 {
				t.Fatal("offline operator command contacted provider")
			}
			if scenario == "activation-plan" && (code != 2 || result["result"] != "SANDBOX_WRITE_ACTIVATION_BLOCKED") {
				t.Fatalf("unactivated plan: %s", output)
			}
			after, _ := os.ReadFile(cfg["YNX_FINANCE_STATE_PATH"])
			if !bytes.Equal(before, after) {
				t.Fatal("read-only doctor modified authoritative state")
			}
			if bytes.Contains(output, []byte(cfg["ALPACA_BROKER_API_SECRET"])) {
				t.Fatal("operator output leaked fixture credential")
			}
		})
	}
}
