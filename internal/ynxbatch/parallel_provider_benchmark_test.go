package ynxbatch

import (
	"bytes"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
)

func benchmarkProviderStats(b *testing.B, p *ParallelProvider) {
	b.Helper()
	stats := p.Stats()
	if stats.InFlight != 0 || stats.PeakInFlight > stats.Capacity {
		b.Fatalf("unjoined/bound violation: %+v", stats)
	}
	b.ReportMetric(float64(stats.ParallelOperations)/float64(b.N), "parallel_pairs/op")
	b.ReportMetric(float64(stats.SerialFallbacks)/float64(b.N), "serial_fallbacks/op")
	b.ReportMetric(float64(stats.PeakInFlight), "peak_extra_workers")
	b.ReportMetric(float64(runtime.GOMAXPROCS(0)), "gomaxprocs")
}

func benchmarkParallelVerifier(r Registration, provider *ParallelProvider) (*Verifier, error) {
	return NewVerifier(VerifierOptions{ChainID: r.ChainID, Purpose: r.Purpose, Optimized: true, ParallelProvider: provider, ResolveTrustedOwner: func(TrustRequest) (Registration, error) { return r, nil }})
}

// Every operation signs a fresh random batch ID with real standard randomized
// signatures. Signing, trees and framing are timed; keygen and result validation
// are outside timing. No success cache, wait-for-batch or deterministic test key.
func BenchmarkParallelProviderFreshN1Sign(b *testing.B) {
	key, _, err := KeyGen()
	requireNoError(b, err)
	b.Cleanup(key.Destroy)
	metadata := Metadata{ChainID: bytes.Repeat([]byte{51}, 32), Owner: "fresh-sign-benchmark", Purpose: "TX-BATCH"}
	messages := [][]byte{bytes.Repeat([]byte{52}, 256)}
	for _, mode := range []string{"sequential", "parallel"} {
		b.Run(mode, func(b *testing.B) {
			var provider *ParallelProvider
			if mode == "parallel" {
				provider, err = NewParallelProvider(1)
				requireNoError(b, err)
			}
			var last []byte
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				batch, err := BatchSign(key, metadata, messages, SignOptions{Optimized: true, ParallelProvider: provider})
				requireNoError(b, err)
				last, err = batch.CertificateWire()
				requireNoError(b, err)
				batch.Discard()
			}
			b.StopTimer()
			c, err := DecodeCertificate(last)
			requireNoError(b, err)
			pair, err := importPublic(c.Context)
			requireNoError(b, err)
			requireNoError(b, verifySignatures(c, pair))
			benchmarkProviderStats(b, provider)
		})
	}
}

// Every operation constructs the original production Verifier and calls its
// complete VerifyOne path with no success cache. Valid proofs additionally check
// both Merkle paths. Invalid A/B proofs must still execute both real signatures.
func BenchmarkParallelProviderFreshN1Verify(b *testing.B) {
	key, _, err := KeyGen()
	requireNoError(b, err)
	b.Cleanup(key.Destroy)
	batch, err := BatchSign(key, Metadata{ChainID: bytes.Repeat([]byte{53}, 32), Owner: "fresh-verify-benchmark", Purpose: "TX-BATCH"}, [][]byte{bytes.Repeat([]byte{54}, 256)}, SignOptions{Optimized: true})
	requireNoError(b, err)
	b.Cleanup(batch.Discard)
	member, err := Extract(batch, 0)
	requireNoError(b, err)
	wire, err := EncodeMember(member)
	requireNoError(b, err)
	for _, variant := range []string{"valid", "invalidA", "invalidB"} {
		m, err := DecodeMember(wire)
		requireNoError(b, err)
		r := registration(m.Certificate)
		if variant == "invalidA" {
			m.Certificate.SigmaA[0] ^= 1
		}
		if variant == "invalidB" {
			m.Certificate.SigmaB[0] ^= 1
		}
		encoded, err := EncodeMember(m)
		requireNoError(b, err)
		for _, mode := range []string{"sequential", "parallel"} {
			b.Run(variant+"/"+mode, func(b *testing.B) {
				var provider *ParallelProvider
				if mode == "parallel" {
					provider, err = NewParallelProvider(1)
					requireNoError(b, err)
				}
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					v, err := benchmarkParallelVerifier(r, provider)
					requireNoError(b, err)
					err = v.VerifyOne(encoded, 7)
					if variant == "valid" {
						requireNoError(b, err)
					} else if !errors.Is(err, ErrInvalidSignature) {
						b.Fatalf("bad branch accepted: %v", err)
					}
					if v.Stats().SignatureChecks != 2 {
						b.Fatal("benchmark did not execute both real branches")
					}
				}
				b.StopTimer()
				b.ReportMetric(2, "sigchecks/op")
				benchmarkProviderStats(b, provider)
			})
		}
	}
}

// Fixed four caller goroutines model existing concurrent demand. One shared
// capacity-2 instance bounds added workers. Independent signing keys avoid
// mistaking the required per-key mutex for provider throughput. Each run reports
// fallback/peak; no assertion assumes scheduler timing or a particular CPU count.
func BenchmarkParallelProviderConcurrent(b *testing.B) {
	const callers = 4
	keys := make([]*PrivateKey, callers)
	for i := range keys {
		key, _, err := KeyGen()
		requireNoError(b, err)
		keys[i] = key
		b.Cleanup(key.Destroy)
	}
	metadata := Metadata{ChainID: bytes.Repeat([]byte{55}, 32), Owner: "concurrent-benchmark", Purpose: "TX-BATCH"}
	messages := [][]byte{bytes.Repeat([]byte{56}, 256)}
	batch, err := BatchSign(keys[0], metadata, messages, SignOptions{Optimized: true})
	requireNoError(b, err)
	b.Cleanup(batch.Discard)
	member, err := Extract(batch, 0)
	requireNoError(b, err)
	wire, err := EncodeMember(member)
	requireNoError(b, err)
	for _, operation := range []string{"sign", "verify_valid", "verify_invalidA", "verify_invalidB"} {
		for _, mode := range []string{"sequential", "parallel"} {
			b.Run(fmt.Sprintf("%s/%s", operation, mode), func(b *testing.B) {
				var provider *ParallelProvider
				if mode == "parallel" {
					provider, err = NewParallelProvider(2)
					requireNoError(b, err)
				}
				member, err := DecodeMember(wire)
				requireNoError(b, err)
				r := registration(member.Certificate)
				if operation == "verify_invalidA" {
					member.Certificate.SigmaA[0] ^= 1
				}
				if operation == "verify_invalidB" {
					member.Certificate.SigmaB[0] ^= 1
				}
				encoded, err := EncodeMember(member)
				requireNoError(b, err)
				var next atomic.Uint64
				var wg sync.WaitGroup
				failures := make(chan error, callers)
				last := make([][]byte, callers)
				b.ReportAllocs()
				b.ResetTimer()
				for caller := 0; caller < callers; caller++ {
					wg.Add(1)
					go func(caller int) {
						defer wg.Done()
						for next.Add(1) <= uint64(b.N) {
							if operation == "sign" {
								signed, err := BatchSign(keys[caller], metadata, messages, SignOptions{Optimized: true, ParallelProvider: provider})
								if err != nil {
									failures <- err
									return
								}
								last[caller], err = signed.CertificateWire()
								signed.Discard()
								if err != nil {
									failures <- err
									return
								}
							} else {
								v, err := benchmarkParallelVerifier(r, provider)
								if err != nil {
									failures <- err
									return
								}
								err = v.VerifyOne(encoded, 7)
								if v.Stats().SignatureChecks != 2 {
									failures <- errors.New("provider skipped branch")
									return
								}
								if operation == "verify_valid" && err != nil {
									failures <- err
									return
								}
								if operation != "verify_valid" && !errors.Is(err, ErrInvalidSignature) {
									failures <- fmt.Errorf("bad signature result: %v", err)
									return
								}
							}
						}
					}(caller)
				}
				wg.Wait()
				b.StopTimer()
				close(failures)
				for err := range failures {
					b.Fatal(err)
				}
				for _, result := range last {
					if result != nil {
						c, err := DecodeCertificate(result)
						requireNoError(b, err)
						pair, err := importPublic(c.Context)
						requireNoError(b, err)
						requireNoError(b, verifySignatures(c, pair))
					}
				}
				benchmarkProviderStats(b, provider)
				if operation != "sign" {
					b.ReportMetric(2, "sigchecks/op")
				}
			})
		}
	}
}
