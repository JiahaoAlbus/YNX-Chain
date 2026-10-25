package main

import (
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// Optional public cross-language fixture for the existing source CI. Copy only
// original public envelopes/observations/manifests; never sender private keys.
// Quorum remains a unit gate and is explicitly labelled, never network proof.
func exportNativeStreamPublicFixture(t *testing.T, network, output string, stats readySenderStats, terminal *terminalStreamReport, latest []transactionResult, reader durableReaderStats, pacing string, replayTiming ...bool) {
	t.Helper()
	destination := os.Getenv("YNX_NATIVE_STREAM_PUBLIC_FIXTURE_DIR")
	if reader.PrefixReplay != nil && reader.PrefixReplay.NativeSuffixSetup {
		destination = os.Getenv("YNX_NATIVE_SUFFIX_PUBLIC_FIXTURE_DIR")
	}
	if reader.PrefixReplay != nil && reader.PrefixReplay.CanonicalCertificate {
		destination = os.Getenv("YNX_NATIVE_CANONICAL_PUBLIC_FIXTURE_DIR")
	}
	if reader.PrefixReplay != nil && reader.PrefixReplay.PreparedCertificate {
		destination = os.Getenv("YNX_NATIVE_PREPARED_PUBLIC_FIXTURE_DIR")
	}
	if pacing == "grouped-cadence4" {
		if reader.PrefixReplay == nil || !reader.PrefixReplay.PreparedCertificate {
			t.Fatal("grouped public fixture requires prepared scope")
		}
		destination = os.Getenv("YNX_NATIVE_GROUPED_PUBLIC_FIXTURE_DIR")
	}
	mode, _, _ := consensus.StateHashEncodingMeasurements()
	if mode == consensus.StateHashCachedFeeJSON {
		if reader.PrefixReplay == nil || !reader.PrefixReplay.PreparedCertificate {
			t.Fatal("cached fee fixture scope differs")
		}
		destination = os.Getenv("YNX_NATIVE_CACHED_FEE_PUBLIC_FIXTURE_DIR")
	}
	if len(replayTiming) > 0 && replayTiming[0] {
		destination = os.Getenv("YNX_NATIVE_REPLAY_TIMING_PUBLIC_FIXTURE_DIR")
	}
	if reader.PrefixReplay != nil && reader.PrefixReplay.PreparedJSONEncoding != "" {
		base := os.Getenv("YNX_NATIVE_PREPARED_JSON_PUBLIC_FIXTURE_DIR")
		destination = ""
		if base != "" {
			if !filepath.IsAbs(base) {
				t.Fatal("prepared JSON public fixture base must be absolute")
			}
			if err := os.MkdirAll(base, 0700); err != nil {
				t.Fatal(err)
			}
			destination = filepath.Join(base, reader.PrefixReplay.PreparedJSONEncoding)
		}
	}
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
	metadata := map[string]any{"durableReadback": reader, "kind": "native_stream_public_unit_fixture_not_network", "independentBFTProof": false, "runtimeNetworkRoot": network, "runtimeOutput": output, "senders": len(latest), "rounds": 34, "intents": intents, "boundedSummary": stats.BoundedSummary, "readySenders": stats, "terminalStream": terminal, "latest": latest}
	if pacing == "grouped-cadence4" {
		metadata["pacingMode"] = pacing
	}
	if mode == consensus.StateHashCachedFeeJSON {
		metadata["clientCachedFeeJSON"] = true
		metadata["clientStateHashEncoding"] = currentClientHashEncoding()
		metadata["unitProducerSharesProcess"] = true
	}
	if reader.PrefixReplay != nil && reader.PrefixReplay.PreparedJSONEncoding != "" {
		metadata["preparedJSONEncoding"] = reader.PrefixReplay.PreparedJSONEncoding
		metadata["gomaxprocs"] = runtime.GOMAXPROCS(0)
		metadata["nativePreparedJSONEncoding"] = reader.PrefixReplay.PreparedJSONEncoding
		metadata["nativePreparedCertificate"] = reader.PrefixReplay.PreparedCertificate
		metadata["nativeReplayTiming"] = len(replayTiming) > 0 && replayTiming[0]
	}
	data, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	if err = persistTerminalSegment(filepath.Join(destination, "PUBLIC_FIXTURE_SCOPE.json"), append(data, '\n')); err != nil {
		t.Fatal(err)
	}
	t.Log("public signed/terminal fixture retained; private sender keys excluded; no network TPS")
}
