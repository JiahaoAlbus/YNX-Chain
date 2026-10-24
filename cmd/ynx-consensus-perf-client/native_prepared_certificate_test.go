package main

import "testing"

func TestNativeStreamingPreparedCertificateExplicitScope(t *testing.T) {
	o := nativeStreamingOptions()
	o.nativePreparedCertificate = true
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	if streamingProfileName(o) != "scoped_native_prefix_stream8_prepared_v1" {
		t.Fatal("prepared profile identity missing")
	}
	for _, mutate := range []func(*options){func(o *options) { o.nativeStream8 = false }, func(o *options) { o.nativeCanonicalCertificate = true }, func(o *options) { o.nativeSuffixSetup = true }, func(o *options) { o.nativeBlockTipHint = true }, func(o *options) { o.prefixNativeClone = false }, func(o *options) { o.observerNativeFacts = false }} {
		bad := o
		mutate(&bad)
		if validateOptions(bad) == nil {
			t.Fatal("unsupported prepared scope accepted")
		}
	}
	old := nativeStreamingOptions()
	if old.nativePreparedCertificate || streamingProfileName(old) != "scoped_native_prefix_stream8_v1" {
		t.Fatal("default changed")
	}
}
func TestNativeStreamingPreparedCertificateRealExecutionNonceEvidenceAndRecovery(t *testing.T) {
	testStreamingWorkloadRealExecution(t, true, true, false, false, false, false, true)
}
