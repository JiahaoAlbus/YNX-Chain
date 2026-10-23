package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Optional public cross-language fixture for the existing source CI. Copy only
// original public envelopes/observations/manifests; never sender private keys.
// Quorum remains a unit gate and is explicitly labelled, never network proof.
func exportNativeStreamPublicFixture(t *testing.T, network, output string, stats readySenderStats, terminal *terminalStreamReport, latest []transactionResult) {
	t.Helper()
	destination := os.Getenv("YNX_NATIVE_STREAM_PUBLIC_FIXTURE_DIR")
	if destination == "" {
		return
	}
	if !filepath.IsAbs(destination) {
		t.Fatal("public fixture destination must be absolute")
	}
	if err := os.Mkdir(destination, 0700); err != nil {
		t.Fatal(err)
	}
	copyFile := func(from, to string) {
		data, err := os.ReadFile(from)
		if err != nil {
			t.Fatal(err)
		}
		if len(data) > 5<<20 {
			t.Fatal("public unit segment bound")
		}
		if err := persistTerminalSegment(to, data); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"network-manifest.json", "transactions.json", "transactions-result.json.streaming-plan.json"} {
		copyFile(filepath.Join(network, name), filepath.Join(destination, name))
	}
	intents := stats.IntentSegments
	for _, from := range []string{intents.Directory, terminal.Directory} {
		relative, err := filepath.Rel(network, from)
		if err != nil || filepath.IsAbs(relative) || (relative != readyIntentSegmentsName && relative != "transactions-result.json.terminal-stream") {
			t.Fatal("public stream escaped network", err)
		}
		to := filepath.Join(destination, relative)
		if err = os.Mkdir(to, 0700); err != nil {
			t.Fatal(err)
		}
		entries, err := os.ReadDir(from)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if !entry.Type().IsRegular() {
				t.Fatal("public fixture has nonregular member")
			}
			copyFile(filepath.Join(from, entry.Name()), filepath.Join(to, entry.Name()))
		}
	}
	metadata := map[string]any{"kind": "native_stream_public_unit_fixture_not_network", "independentBFTProof": false, "runtimeNetworkRoot": network, "runtimeOutput": output, "senders": len(latest), "rounds": 34, "intents": intents, "boundedSummary": stats.BoundedSummary, "readySenders": stats, "terminalStream": terminal, "latest": latest}
	data, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	if err = persistTerminalSegment(filepath.Join(destination, "PUBLIC_FIXTURE_SCOPE.json"), append(data, '\n')); err != nil {
		t.Fatal(err)
	}
	t.Log("public signed/terminal fixture retained; private sender keys excluded; no network TPS")
}
