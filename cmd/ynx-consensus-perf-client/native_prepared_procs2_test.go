package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func preparedGroupedProcs2Options() options {
	o := nativeStreamingOptions()
	o.nativePreparedCertificate, o.nativeCurrentInputReuse, o.clientProcs2 = true, true, true
	o.pacingMode = "grouped-cadence4"
	return o
}

func TestPreparedNativeStreamingProcs2RequiresIsolatedExplicitScope(t *testing.T) {
	o := preparedGroupedProcs2Options()
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	if streamingProfileName(o) != "scoped_native_prefix_stream8_prepared_grouped_procs2_v1" {
		t.Fatal("scheduler candidate profile missing")
	}
	for _, mutate := range []func(*options){func(o *options) { o.nativePreparedCertificate = false }, func(o *options) { o.nativeCurrentInputReuse = false }, func(o *options) { o.nativeCachedFeeJSON = true }, func(o *options) { o.nativeCanonicalCertificate = true }, func(o *options) { o.nativeSuffixSetup = true }, func(o *options) { o.nativeBlockTipHint = true }, func(o *options) { o.nativeStreamSubmitters = 16; o.concurrency = 16 }, func(o *options) { o.pacingMode = "bounded-cadence" }} {
		bad := o
		mutate(&bad)
		if validateOptions(bad) == nil {
			t.Fatal("mixed scheduler candidate accepted")
		}
	}
	before := o
	before.clientProcs2 = false
	if err := validateOptions(before); err != nil || streamingProfileName(before) != "scoped_native_prefix_stream8_prepared_v1" {
		t.Fatal("original grouped path changed", err)
	}
}

func TestPreparedNativeStreamingProcs2PlanAndRealExecuteFailureRestore(t *testing.T) {
	prior := runtime.GOMAXPROCS(1)
	defer runtime.GOMAXPROCS(prior)
	o := preparedGroupedProcs2Options()
	dir := t.TempDir()
	o.manifest = filepath.Join(dir, "absent-manifest")
	o.transactions = filepath.Join(dir, "absent-input")
	o.output = filepath.Join(dir, "actual-error.json")
	if err := execute(o); err == nil {
		t.Fatal("missing manifest succeeded")
	}
	if runtime.GOMAXPROCS(0) != 1 {
		t.Fatal("client runtime leaked after real execute failure")
	}
	raw, err := os.ReadFile(o.output)
	if err != nil {
		t.Fatal(err)
	}
	var got report
	if err = json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if !got.ClientProcs2 || got.GOMAXPROCS != 2 || len(got.SetupErrors) == 0 || got.Summary.FinalSubmitted != 0 {
		t.Fatal("actual scheduler/error proof differs")
	}
}

func TestPreparedNativeStreamingProcs2RealSignedExecutionAndRecovery(t *testing.T) {
	testStreamingWorkloadRealExecution(t, true, true, false, false, false, false, true, false, true, true)
}
