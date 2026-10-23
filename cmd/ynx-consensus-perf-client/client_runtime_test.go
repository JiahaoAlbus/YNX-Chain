package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func clientProcs2Options(t *testing.T) options {
	t.Helper()
	dir := t.TempDir()
	return options{manifest: filepath.Join(dir, "absent-manifest"), transactions: filepath.Join(dir, "absent-transactions"), output: filepath.Join(dir, "actual-error-report.json"), concurrency: 8, observers: 4, timeout: 10 * time.Second, poll: 100 * time.Millisecond, rounds: 1, senderMode: "rounds", inclusionMode: "block-scan", offeredRate: 1000, observerPhaseTiming: true, durableStoreByteLimit: durableSnapshotLimit, prefixDurableReplay: true, prefixNativeClone: true, nativeSubmit8: true, observerNativeFacts: true, clientProcs2: true}
}
func TestClientProcs2IsExplicitAndRestoresAfterRealSetupFailure(t *testing.T) {
	prior := runtime.GOMAXPROCS(1)
	defer runtime.GOMAXPROCS(prior)
	o := clientProcs2Options(t)
	if e := validateOptions(o); e != nil {
		t.Fatal(e)
	}
	if e := execute(o); e == nil {
		t.Fatal("missing manifest setup unexpectedly succeeded")
	}
	if runtime.GOMAXPROCS(0) != 1 {
		t.Fatal("client-local scheduler leaked after failed execute")
	}
	raw, e := os.ReadFile(o.output)
	if e != nil {
		t.Fatal(e)
	}
	var actual report
	if e = json.Unmarshal(raw, &actual); e != nil {
		t.Fatal(e)
	}
	if !actual.ClientProcs2 || actual.GOMAXPROCS != 2 || len(actual.SetupErrors) == 0 || actual.Summary.FinalSubmitted != 0 {
		t.Fatal("actual runtime/error report misrepresented setup", actual.GOMAXPROCS)
	}
	o = clientProcs2Options(t)
	o.clientProcs2 = false
	runtime.GOMAXPROCS(3)
	if e := execute(o); e == nil {
		t.Fatal("default missing manifest succeeded")
	}
	if runtime.GOMAXPROCS(0) != 3 {
		t.Fatal("default clobbered caller runtime policy")
	}
	for _, kind := range []string{"facts", "submit8", "suffix", "workers", "observers", "rounds", "timing"} {
		bad := clientProcs2Options(t)
		switch kind {
		case "facts":
			bad.observerNativeFacts = false
		case "submit8":
			bad.nativeSubmit8 = false
		case "suffix":
			bad.nativeSuffixSetup = true
		case "workers":
			bad.concurrency = 4
		case "observers":
			bad.observers = 2
		case "rounds":
			bad.rounds = 2
		case "timing":
			bad.observerPhaseTiming = false
		}
		if e := validateOptions(bad); e == nil {
			t.Fatal("unsupported runtime candidate combination accepted", kind)
		}
	}
}
