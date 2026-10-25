package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestPreparedSnapshotJSONEncodingScope(t *testing.T) {
	o := preparedGroupedProcs2Options()
	o.clientProcs2 = false
	o.nativeReplayTiming = true
	for _, mode := range []string{consensus.PreparedNativeOriginalJSON, consensus.PreparedNativeFeeJSON} {
		o.nativePreparedJSONEncoding = mode
		if err := validateOptions(o); err != nil {
			t.Fatal(err)
		}
		for _, mutate := range []func(*options){func(o *options) { o.clientProcs2 = true }, func(o *options) { o.nativeReplayTiming = false }, func(o *options) { o.nativePreparedCertificate = false }, func(o *options) { o.nativeCurrentInputReuse = false }, func(o *options) { o.nativeCachedFeeJSON = true }, func(o *options) { o.nativeStream8 = false }, func(o *options) { o.pacingMode = "bounded-cadence" }, func(o *options) { o.nativePreparedJSONEncoding = "unknown" }} {
			bad := o
			mutate(&bad)
			if validateOptions(bad) == nil {
				t.Fatal("mixed prepared JSON diagnostic accepted")
			}
		}
	}
}

func TestPreparedSnapshotJSONEncodingRealSignedRecovery(t *testing.T) {
	prior := runtime.GOMAXPROCS(1)
	defer runtime.GOMAXPROCS(prior)
	for _, original := range []bool{true, false} {
		name := "fee-time-json-indent"
		if original {
			name = "original-json"
		}
		t.Run(name, func(t *testing.T) {
			testStreamingWorkloadRealExecution(t, true, true, false, false, false, false, true, false, true, false, true, true, original)
		})
	}
}

func TestPreparedSnapshotJSONEncodingActualFailureAndCancellation(t *testing.T) {
	prior := runtime.GOMAXPROCS(1)
	defer runtime.GOMAXPROCS(prior)
	o := preparedGroupedProcs2Options()
	o.nativeReplayTiming = true
	o.clientProcs2 = false
	o.nativePreparedJSONEncoding = consensus.PreparedNativeOriginalJSON
	dir := t.TempDir()
	o.output = filepath.Join(dir, "actual-error.json")
	o.manifest = filepath.Join(dir, "absent")
	o.transactions = filepath.Join(dir, "absent-input")
	if err := execute(o); err == nil {
		t.Fatal("absent manifest succeeded")
	}
	var result report
	raw, err := os.ReadFile(o.output)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if !result.NativeReplayTiming || result.GOMAXPROCS != 1 || result.NativePreparedJSONEncoding != consensus.PreparedNativeOriginalJSON || runtime.GOMAXPROCS(0) != 1 || len(result.SetupErrors) == 0 || result.Summary.FinalSubmitted != 0 {
		t.Fatal("actual diagnostic/runtime/failure binding differs")
	}
	_, migration, path, _, _ := durableJournalFixture(t, "block-journal")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	r, err := newWorkloadDurableReader(migration, []string{path}, o)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.configureNativeStreamingReplay(o); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = r.decodePrefixSnapshot(ctx, data); err == nil {
		t.Fatal("cancelled replay succeeded")
	}
	stats := r.stats()
	parts := stats.PrefixReplay.WorkPhases
	if parts.SuffixReplayDetails == nil || parts.SuffixReplayDetails.Finalize.Calls != 0 || parts.CertificatePublish.Calls != 0 || stats.TransactionVerifications != 0 {
		t.Fatal("cancelled actual reader executed work")
	}
	current, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(current, data) {
		t.Fatal("cancelled diagnostic changed durable bytes", err)
	}
}

func TestPreparedSnapshotJSONEncodingRealCLISetupFailure(t *testing.T) {
	if output := os.Getenv("YNX_PREPARED_JSON_CLI_OUTPUT"); output != "" {
		flag.CommandLine = flag.NewFlagSet("ynx-consensus-perf-client", flag.ContinueOnError)
		os.Args = []string{"ynx-consensus-perf-client", "-manifest", output + ".absent-manifest", "-transactions", output + ".absent-input", "-output", output, "-timeout", "40s", "-concurrency", "8", "-observers", "4", "-offered-rate", "1000", "-rounds", "4", "-sender-mode", "ready-pool", "-inclusion-mode", "block-scan", "-pacing-mode", "grouped-cadence4", "-native-stream8", "-native-current-input-reuse", "-observer-phase-timing", "-prefix-durable-replay", "-prefix-native-clone", "-observer-native-facts", "-streaming-workload", "-terminal-stream", "-terminal-gzip", "-reuse-result-slots", "-segmented-intents", "-evidence-byte-budget", "67108864", "-durable-store-byte-limit", "33554432", "-durable-cache-byte-budget", "67108864", "-native-prepared-certificate", "-native-prepared-json-encoding", os.Getenv("YNX_PREPARED_JSON_CLI_MODE"), "-native-replay-timing"}
		main()
		return
	}
	for _, mode := range []string{consensus.PreparedNativeOriginalJSON, consensus.PreparedNativeFeeJSON, "unknown"} {
		t.Run(mode, func(t *testing.T) {
			output := filepath.Join(t.TempDir(), "real-cli-error.json")
			child := exec.Command(os.Args[0], "-test.run=^TestPreparedSnapshotJSONEncodingRealCLISetupFailure$")
			child.Env = append(os.Environ(), "YNX_PREPARED_JSON_CLI_OUTPUT="+output, "YNX_PREPARED_JSON_CLI_MODE="+mode, "GOMAXPROCS=1")
			diagnostic, err := child.CombinedOutput()
			exit, ok := err.(*exec.ExitError)
			if !ok || exit.ExitCode() != 1 {
				t.Fatalf("actual CLI exit differs: %v %s", err, diagnostic)
			}
			raw, err := os.ReadFile(output)
			if mode == "unknown" {
				if !os.IsNotExist(err) || !bytes.Contains(diagnostic, []byte("prepared JSON encoding requires")) {
					t.Fatalf("unknown actual CLI encoder reached setup: %v %s", err, diagnostic)
				}
				return
			}
			if err != nil {
				t.Fatalf("actual CLI omitted report: %v %s", err, diagnostic)
			}
			var got report
			if err = json.Unmarshal(raw, &got); err != nil {
				t.Fatal(err)
			}
			if !got.NativeReplayTiming || got.ClientProcs2 || got.GOMAXPROCS != 1 || got.NativePreparedJSONEncoding != mode || len(got.SetupErrors) == 0 || got.Summary.FinalSubmitted != 0 {
				t.Fatal("actual CLI diagnostic/runtime/failed setup identity differs")
			}
		})
	}
}
