package main

import "testing"

func TestNativeStreaming16ExplicitScope(t *testing.T) {
	o := nativeStreamingOptions()
	o.nativeStreamSubmitters, o.concurrency = 16, 16
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	if streamingProfileName(o) != "scoped_native_prefix_stream16_v1" {
		t.Fatal("candidate identity missing")
	}
	for _, mutate := range []func(*options){
		func(o *options) { o.nativeStreamSubmitters = 0 },
		func(o *options) { o.nativeStreamSubmitters = 8 },
		func(o *options) { o.nativeStreamSubmitters = 32 },
		func(o *options) { o.concurrency = 8 },
		func(o *options) { o.nativeStream8 = false },
		func(o *options) { o.observers = 8 },
		func(o *options) { o.prefixNativeClone = false },
		func(o *options) { o.observerNativeFacts = false },
		func(o *options) { o.segmentedIntents = false },
	} {
		bad := o
		mutate(&bad)
		if validateOptions(bad) == nil {
			t.Fatal("unsupported stream16 scope accepted", bad)
		}
	}
	old := nativeStreamingOptions()
	if err := validateOptions(old); err != nil {
		t.Fatal(err)
	}
	if old.concurrency != 8 || streamingProfileName(old) != "scoped_native_prefix_stream8_v1" {
		t.Fatal("original default changed")
	}
}

func TestNativeStreaming16RealExecutionNonceEvidenceAndRecovery(t *testing.T) {
	// Original three senders exercise 34 sequential nonces each. This checks
	// worker construction and business correctness, not sixteen-way saturation.
	testStreamingWorkloadRealExecution(t, true, true, false, false, true)
}

func TestNativeStreaming16ConcurrentBusinessAndRecovery(t *testing.T) {
	testStreamingWorkloadRealExecution(t, true, true, false, false, true, true)
}
