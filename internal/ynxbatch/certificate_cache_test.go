package ynxbatch

import (
	"bytes"
	"errors"
	"fmt"
	"sync"
	"testing"
)

func cacheVerifier(t testing.TB, r *Registration, cache *CertificateCache, scope []byte) *Verifier {
	t.Helper()
	v, err := NewVerifier(VerifierOptions{ChainID: r.ChainID, Purpose: r.Purpose, CertificateCache: cache, CacheScope: scope,
		ResolveTrustedOwner: func(TrustRequest) (Registration, error) { return *r, nil }})
	requireNoError(t, err)
	return v
}

func TestCertificateCacheReferenceAndCompleteBinding(t *testing.T) {
	f := fixture(t)
	original := b64(t, f.Member)
	m, err := DecodeMember(original)
	requireNoError(t, err)
	r := registration(m.Certificate)
	cache, err := NewCertificateCache(2)
	requireNoError(t, err)
	scope := bytes.Repeat([]byte{3}, 32)
	first := cacheVerifier(t, &r, cache, scope)
	requireNoError(t, first.VerifyOne(original, 7))
	if first.Stats().SignatureChecks != 2 || cache.Stats().Entries != 1 {
		t.Fatal("cold verification did not check both signatures")
	}
	second := cacheVerifier(t, &r, cache, scope)
	requireNoError(t, second.VerifyOne(original, 7))
	if second.Stats().SignatureChecks != 0 || cache.Stats().Hits != 1 {
		t.Fatal("fresh verifier did not reuse authenticated certificate")
	}
	// The uncached path is the frozen baseline's provider, trust and tree path.
	// Every adversarial member must have the same outcome after a real cache hit.
	for _, tc := range []struct {
		name   string
		change func(*Member)
	}{
		{"sigmaA", func(v *Member) { v.Certificate.SigmaA[10] ^= 1 }},
		{"sigmaB", func(v *Member) { v.Certificate.SigmaB[10] ^= 1 }},
		{"rootA", func(v *Member) { v.Certificate.RootA[0] ^= 1 }},
		{"rootB", func(v *Member) { v.Certificate.RootB[0] ^= 1 }},
		{"batchID", func(v *Member) { v.Certificate.BatchID[0] ^= 1 }},
		{"keyA", func(v *Member) { v.Certificate.PKA[0] ^= 1 }},
		{"keyB", func(v *Member) { v.Certificate.PKB[0] ^= 1 }},
		{"network", func(v *Member) { v.Certificate.ChainID[0] ^= 1 }},
		{"owner", func(v *Member) { v.Certificate.Owner += "x" }},
		{"purpose", func(v *Member) { v.Certificate.Purpose = "OTHER" }},
		{"message", func(v *Member) { v.Message[0] ^= 1 }},
		{"index", func(v *Member) { v.Index ^= 1 }},
		{"pathA", func(v *Member) { v.PathA[0][0] ^= 1 }},
		{"pathB", func(v *Member) { v.PathB[0][0] ^= 1 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bad, err := DecodeMember(original)
			requireNoError(t, err)
			tc.change(&bad)
			wire, err := EncodeMember(bad)
			requireNoError(t, err)
			old := cacheVerifier(t, &r, nil, nil).VerifyOne(wire, 7)
			got := cacheVerifier(t, &r, cache, scope).VerifyOne(wire, 7)
			requireError(t, old)
			if got == nil || got.Error() != old.Error() {
				t.Fatalf("cached and uncached outcomes differ: cached=%v uncached=%v", got, old)
			}
			if cache.Stats().Entries != 1 {
				t.Fatal("failed certificate inserted a cache entry")
			}
		})
	}
	// If the trusted resolver itself selects different keys/context, the old
	// certificate success must not rescue the unchanged original signatures.
	for _, mutate := range []func(*Certificate){
		func(c *Certificate) { c.PKA[0] ^= 1 },
		func(c *Certificate) { c.PKB[0] ^= 1 },
		func(c *Certificate) { c.ChainID[0] ^= 1 },
		func(c *Certificate) { c.Owner += "-other" },
		func(c *Certificate) { c.Purpose = "OTHER" },
	} {
		bad, err := DecodeCertificate(b64(t, f.Certificate))
		requireNoError(t, err)
		mutate(&bad)
		changed := registration(bad)
		wire, err := EncodeCertificate(bad)
		requireNoError(t, err)
		v := cacheVerifier(t, &changed, cache, scope)
		_, err = v.AuthenticateCertificate(wire, 7)
		if !errors.Is(err, ErrInvalidSignature) || v.Stats().SignatureChecks != 2 || cache.Stats().Entries != 1 {
			t.Fatalf("old success crossed trusted key/context: err=%v stats=%+v", err, v.Stats())
		}
	}
	for _, change := range []func(*Registration){
		func(r *Registration) { r.PolicyRevision = "revision-2" },
		func(r *Registration) { r.ActiveFrom = 4 },
		func(r *Registration) { at := uint64(8); r.RevokedAt = &at },
	} {
		changed := registration(m.Certificate)
		change(&changed)
		v := cacheVerifier(t, &changed, cache, scope)
		requireNoError(t, v.VerifyOne(original, 7))
		if v.Stats().SignatureChecks != 2 {
			t.Fatal("different complete trust stamp reused old certificate success")
		}
	}
	cache.Clear()
	requireNoError(t, cacheVerifier(t, &r, cache, scope).VerifyOne(original, 7))
	changedScope := bytes.Repeat([]byte{4}, 32)
	v := cacheVerifier(t, &r, cache, changedScope)
	changedScope[0] ^= 1 // NewVerifier must retain its own scope bytes.
	requireNoError(t, v.VerifyOne(original, 7))
	if v.Stats().SignatureChecks != 2 {
		t.Fatal("different trusted root scope reused old certificate success")
	}
	if !bytes.Equal(v.cacheScope, bytes.Repeat([]byte{4}, 32)) {
		t.Fatal("caller mutated verifier scope")
	}
}

func TestCertificateCacheRefreshFailuresAndHeight(t *testing.T) {
	f := fixture(t)
	wire := b64(t, f.Certificate)
	c, err := DecodeCertificate(wire)
	requireNoError(t, err)
	scope := bytes.Repeat([]byte{7}, 32)
	for _, warm := range []bool{false, true} {
		t.Run(fmt.Sprint(warm), func(t *testing.T) {
			cache, err := NewCertificateCache(2)
			requireNoError(t, err)
			r := registration(c)
			if warm {
				_, err = cacheVerifier(t, &r, cache, scope).AuthenticateCertificate(wire, 7)
				requireNoError(t, err)
			}
			calls := 0
			v, err := NewVerifier(VerifierOptions{ChainID: r.ChainID, Purpose: r.Purpose, CertificateCache: cache, CacheScope: scope,
				ResolveTrustedOwner: func(TrustRequest) (Registration, error) {
					calls++
					if calls > 1 {
						r.PolicyRevision = "changed-during-authentication"
					}
					return r, nil
				}})
			requireNoError(t, err)
			_, err = v.AuthenticateCertificate(wire, 7)
			if !errors.Is(err, ErrUntrusted) {
				t.Fatalf("trust refresh accepted: %v", err)
			}
			want := 0
			if warm {
				want = 1
			}
			if cache.Stats().Entries != want {
				t.Fatal("failed refresh populated cache")
			}
		})
	}
	cache, err := NewCertificateCache(2)
	requireNoError(t, err)
	r := registration(c)
	at := uint64(8)
	r.RevokedAt = &at
	_, err = cacheVerifier(t, &r, cache, scope).AuthenticateCertificate(wire, 7)
	requireNoError(t, err)
	for _, height := range []uint64{2, 8, 9} {
		_, err = cacheVerifier(t, &r, cache, scope).AuthenticateCertificate(wire, height)
		if !errors.Is(err, ErrUntrusted) {
			t.Fatalf("height %d reused inactive registration: %v", height, err)
		}
	}
	if cache.Stats().Hits != 0 {
		t.Fatal("inactive registration reached cache lookup")
	}
	for _, mutate := range []func(*Registration){
		func(r *Registration) { r.Enabled = false },
		func(r *Registration) { r.AlgorithmVersion = "unrecognized-profile" },
	} {
		changed := r
		mutate(&changed)
		_, err := cacheVerifier(t, &changed, cache, scope).AuthenticateCertificate(wire, 7)
		if !errors.Is(err, ErrUntrusted) || cache.Stats().Hits != 0 {
			t.Fatal("cached signature overrode disabled registration or profile")
		}
	}
}

func TestCertificateCacheBoundedLRUClearAndConfiguration(t *testing.T) {
	for _, n := range []int{-1, 0, 65} {
		_, err := NewCertificateCache(n)
		requireError(t, err)
	}
	f := fixture(t)
	wire := b64(t, f.Certificate)
	c, err := DecodeCertificate(wire)
	requireNoError(t, err)
	r := registration(c)
	cache, err := NewCertificateCache(2)
	requireNoError(t, err)
	scope := bytes.Repeat([]byte{5}, 32)
	for _, opts := range []VerifierOptions{
		{CertificateCache: cache}, {CertificateCache: cache, CacheScope: make([]byte, 31)},
		{CertificateCache: &CertificateCache{}, CacheScope: scope}, {CacheScope: scope},
	} {
		opts.ChainID, opts.Purpose = r.ChainID, r.Purpose
		opts.ResolveTrustedOwner = func(TrustRequest) (Registration, error) { return r, nil }
		_, err := NewVerifier(opts)
		requireError(t, err)
	}
	for _, revision := range []string{"one", "two", "one", "three", "two"} {
		r.PolicyRevision = revision
		_, err := cacheVerifier(t, &r, cache, scope).AuthenticateCertificate(wire, 7)
		requireNoError(t, err)
	}
	stats := cache.Stats()
	if stats.Entries != 2 || stats.Hits != 1 || stats.Misses != 4 || stats.RetainedKeyBytes > 2*maxCertificateCacheKeyBytes {
		t.Fatalf("unbounded cache or wrong LRU: %+v", stats)
	}
	before, _ := cache.lookup("in-flight-test-only-key")
	cache.Clear()
	cache.remember("in-flight-test-only-key", before)
	if cache.Stats().Entries != 0 || cache.Stats().RetainedKeyBytes != 0 {
		t.Fatal("clear was undone by in-flight completion")
	}
	_, err = cacheVerifier(t, &r, cache, scope).AuthenticateCertificate(wire, 7)
	requireNoError(t, err)
	if cache.Stats().Entries != 1 {
		t.Fatal("cache did not work after clear")
	}
}

func TestCertificateCacheConcurrentVerifiers(t *testing.T) {
	f := fixture(t)
	wire := b64(t, f.Member)
	m, err := DecodeMember(wire)
	requireNoError(t, err)
	r := registration(m.Certificate)
	cache, err := NewCertificateCache(2)
	requireNoError(t, err)
	scope := bytes.Repeat([]byte{8}, 32)
	const workers = 4
	verifiers := make([]*Verifier, workers)
	for i := range verifiers {
		verifiers[i] = cacheVerifier(t, &r, cache, scope)
	}
	results := make(chan error, workers)
	var wg sync.WaitGroup
	for _, v := range verifiers {
		wg.Add(1)
		go func(v *Verifier) { defer wg.Done(); results <- v.VerifyOne(wire, 7) }(v)
	}
	wg.Wait()
	close(results)
	for err := range results {
		requireNoError(t, err)
	}
	if stats := cache.Stats(); stats.Entries != 1 || stats.Hits+stats.Misses != workers {
		t.Fatalf("concurrent cache changed verification: %+v", stats)
	}
}

// Measures real dual verification and tree membership, never a stubbed provider.
// The cold cache is cleared outside timing; misses include key lookup/insertion.
// Every iteration constructs a fresh verifier, matching historical replay callers.
func BenchmarkCertificateCache(b *testing.B) {
	key, pub, err := KeyGen()
	requireNoError(b, err)
	b.Cleanup(key.Destroy)
	network := bytes.Repeat([]byte{9}, 32)
	scope := bytes.Repeat([]byte{10}, 32)
	for _, n := range []int{1, 16, 64, 1024} {
		b.Run(fmt.Sprintf("N%d", n), func(b *testing.B) {
			messages := make([][]byte, n)
			for i := range messages {
				messages[i] = bytes.Repeat([]byte{byte(i)}, 256)
			}
			batch, err := BatchSign(key, Metadata{ChainID: network, Owner: "cache-benchmark", Purpose: "TX-BATCH"}, messages, SignOptions{Optimized: true})
			requireNoError(b, err)
			b.Cleanup(batch.Discard)
			member, err := Extract(batch, uint32(n-1))
			requireNoError(b, err)
			wire, err := EncodeMember(member)
			requireNoError(b, err)
			r := registration(member.Certificate)
			if !bytes.Equal(r.PKA, pub.PKA) || !bytes.Equal(r.PKB, pub.PKB) {
				b.Fatal("benchmark pair changed")
			}
			for _, mode := range []string{"uncached", "miss", "hit"} {
				b.Run(mode, func(b *testing.B) {
					cache, err := NewCertificateCache(2)
					requireNoError(b, err)
					var selected *CertificateCache
					var selectedScope []byte
					if mode != "uncached" {
						selected, selectedScope = cache, scope
					}
					if mode == "hit" {
						requireNoError(b, cacheVerifier(b, &r, cache, scope).VerifyOne(wire, 7))
					}
					var checks uint64
					b.ReportAllocs()
					b.SetBytes(int64(len(member.Message)))
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						if mode == "miss" {
							b.StopTimer()
							cache.Clear()
							b.StartTimer()
						}
						v := cacheVerifier(b, &r, selected, selectedScope)
						requireNoError(b, v.VerifyOne(wire, 7))
						checks += v.Stats().SignatureChecks
					}
					b.StopTimer()
					want := uint64(2 * b.N)
					if mode == "hit" {
						want = 0
					}
					if checks != want {
						b.Fatalf("provider checks=%d want=%d", checks, want)
					}
					b.ReportMetric(float64(checks)/float64(b.N), "sigchecks/op")
				})
			}
		})
	}
}
