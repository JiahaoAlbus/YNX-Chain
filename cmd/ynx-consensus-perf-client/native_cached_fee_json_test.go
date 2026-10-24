package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCachedFeeClientExplicitScopeAndOriginalReportShape(t *testing.T) {
	o := nativeStreamingOptions()
	o.nativePreparedCertificate, o.nativeCurrentInputReuse, o.nativeCachedFeeJSON = true, true, true
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	if streamingProfileName(o) != "scoped_native_prefix_stream8_prepared_cached_fee_v1" {
		t.Fatal("profile identity absent")
	}
	for _, mutate := range []func(*options){func(o *options) { o.nativeStream8 = false }, func(o *options) { o.nativePreparedCertificate = false }, func(o *options) { o.nativeCurrentInputReuse = false }, func(o *options) { o.nativeStreamSubmitters = 16; o.concurrency = 16 }, func(o *options) { o.nativeCanonicalCertificate = true }, func(o *options) { o.nativeSuffixSetup = true }, func(o *options) { o.nativeBlockTipHint = true }, func(o *options) { o.clientProcs2 = true }} {
		bad := o
		mutate(&bad)
		if validateOptions(bad) == nil {
			t.Fatal("unsupported mixed cached scope accepted")
		}
	}
	raw, err := json.Marshal(report{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "nativeCachedFeeJSON") || strings.Contains(string(raw), "clientStateHashEncoding") {
		t.Fatal("original report inventory changed")
	}
	raw, err = json.Marshal(nativeStreamingPlan{})
	if err != nil || strings.Contains(string(raw), "clientCachedFeeJSON") {
		t.Fatal("original plan inventory changed", err)
	}
}

func TestCachedFeeClientStreamingRealExecution(t *testing.T) {
	if os.Getenv("YNX_TEST_CACHED_FEE_CLIENT_CHILD") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestCachedFeeClientStreamingRealExecution$", "-test.v")
		cmd.Env = append(os.Environ(), "YNX_TEST_CACHED_FEE_CLIENT_CHILD=1")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("actual selected client child: %v\n%s", err, out)
		}
		t.Log(string(out))
		return
	}
	o := nativeStreamingOptions()
	o.nativePreparedCertificate, o.nativeCurrentInputReuse, o.nativeCachedFeeJSON = true, true, true
	if err := configureClientHashEncoding(o); err != nil {
		t.Fatal(err)
	}
	testStreamingWorkloadRealExecution(t, true, true, false, false, false, false, true, true)
	// A failed fresh execute cannot inherit earlier unit-process candidate work.
	dir := t.TempDir()
	o.manifest = filepath.Join(dir, "missing-manifest")
	o.transactions = filepath.Join(dir, "missing-transactions")
	o.output = filepath.Join(dir, "failed-report.json")
	if err := execute(o); err == nil {
		t.Fatal("missing manifest unexpectedly succeeded")
	}
	raw, err := os.ReadFile(o.output)
	if err != nil {
		t.Fatal(err)
	}
	var failed report
	if err = json.Unmarshal(raw, &failed); err != nil {
		t.Fatal(err)
	}
	if !failed.NativeCachedFeeJSON || failed.ClientStateHashEncoding == nil || failed.ClientStateHashEncoding.CandidateAttempts != 0 || failed.ClientStateHashEncoding.EncodingErrors != 0 || failed.Summary.FinalSubmitted != 0 || len(failed.SetupErrors) == 0 {
		t.Fatal("failed execute inherited old work or invented success", failed.ClientStateHashEncoding)
	}
	// A caller cannot conceal a previously selected process backend by dropping
	// the flag. Refuse it before any new output/manifest/issuance is touched.
	o.nativeCachedFeeJSON = false
	if configureClientHashEncoding(o) == nil {
		t.Fatal("selected process silently fell back to original")
	}
	o.output = filepath.Join(dir, "wrong-mode-must-not-exist.json")
	if err := execute(o); err == nil {
		t.Fatal("execute silently fell back")
	}
	if _, err = os.Stat(o.output); !os.IsNotExist(err) {
		t.Fatal("wrong mode touched output", err)
	}
}
