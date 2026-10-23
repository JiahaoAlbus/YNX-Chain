package main

import "errors"

// Counters describe signature mathematics reuse only. Every successful lookup
// still runs the original current-state fee/nonce/height/context checks.
type observerNativeFactStats struct {
	Enabled                   bool   `json:"enabled"`
	Lookups                   uint64 `json:"lookups"`
	Hits                      uint64 `json:"hits"`
	Misses                    uint64 `json:"misses"`
	FallbackMathVerifications uint64 `json:"fallbackMathVerifications"`
	FallbackFailures          uint64 `json:"fallbackFailures"`
}

func (s *observerNativeFactStats) add(v observerNativeFactStats) {
	s.Lookups += v.Lookups
	s.Hits += v.Hits
	s.Misses += v.Misses
	s.FallbackMathVerifications += v.FallbackMathVerifications
	s.FallbackFailures += v.FallbackFailures
}

// Construction-time configuration only, before any observer worker starts.
func (r *durableReader) configureObserverNativeFacts() error {
	if r == nil || r.prefixDecoder == nil || !r.prefixNativeClone || r.prefixStats.NativeSuffixSetup || r.signatureFacts != nil || r.profileMu != nil {
		return errors.New("observer native facts require original native prefix setup without alternate signature or reader-budget modes")
	}
	r.observerNativeFacts = true
	return nil
}
