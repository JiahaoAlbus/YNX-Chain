package main

import "testing"

func TestPreparedNativeStreamingGroupedScope(t *testing.T) {
	o := nativeStreamingOptions()
	o.nativePreparedCertificate, o.nativeCurrentInputReuse = true, true
	o.pacingMode = "grouped-cadence4"
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	if readyPacingBurstLimit != 4 {
		t.Fatal("original burst bound changed")
	}
	for _, mutate := range []func(*options){func(o *options) { o.nativePreparedCertificate = false }, func(o *options) { o.nativeCurrentInputReuse = false }, func(o *options) { o.concurrency = 16; o.nativeStreamSubmitters = 16 }, func(o *options) { o.nativeCachedFeeJSON = true }, func(o *options) { o.nativeSuffixSetup = true }, func(o *options) { o.nativeCanonicalCertificate = true }, func(o *options) { o.nativeBlockTipHint = true }} {
		bad := o
		mutate(&bad)
		if validateOptions(bad) == nil {
			t.Fatal("mixed grouped scope accepted")
		}
	}
}

func TestPreparedNativeStreamingGroupedRealExecutionAndRecovery(t *testing.T) {
	testStreamingWorkloadRealExecution(t, true, true, false, false, false, false, true, false, true)
}
