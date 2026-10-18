package ynxbatch

import (
	"bytes"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func awaitProviderSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(5 * time.Second):
		t.Fatal("provider branch did not reach bounded test barrier")
	}
}

func providerTestGate() (<-chan struct{}, func()) {
	signal := make(chan struct{})
	var once sync.Once
	return signal, func() { once.Do(func() { close(signal) }) }
}

func parallelVerifier(t testing.TB, r *Registration, p *ParallelProvider, cache *CertificateCache) *Verifier {
	t.Helper()
	var scope []byte
	if cache != nil {
		scope = bytes.Repeat([]byte{61}, 32)
	}
	v, err := NewVerifier(VerifierOptions{ChainID: r.ChainID, Purpose: r.Purpose, Optimized: true, ParallelProvider: p, CertificateCache: cache, CacheScope: scope, ResolveTrustedOwner: func(TrustRequest) (Registration, error) { return *r, nil }})
	requireNoError(t, err)
	return v
}

func TestParallelProviderBoundedFallbackAndJoin(t *testing.T) {
	for _, capacity := range []int{-1, 0, MaxParallelProviderOperations + 1} {
		_, err := NewParallelProvider(capacity)
		requireError(t, err)
	}
	p, err := NewParallelProvider(1)
	requireNoError(t, err)
	entered, second, returned := make(chan struct{}), make(chan struct{}), make(chan struct{})
	release, unblock := providerTestGate()
	defer unblock()
	go func() {
		p.runPair(func() { close(entered); <-release }, func() { close(second) })
		close(returned)
	}()
	awaitProviderSignal(t, entered)
	awaitProviderSignal(t, second)
	select {
	case <-returned:
		t.Fatal("returned before both branches completed")
	default:
	}
	var calls int
	p.runPair(func() { calls++ }, func() { calls++ })
	if calls != 2 {
		t.Fatal("saturated provider skipped a branch")
	}
	stats := p.Stats()
	if stats.InFlight != 1 || stats.PeakInFlight != 1 || stats.ParallelOperations != 1 || stats.SerialFallbacks != 1 {
		t.Fatalf("unbounded worker/queue: %+v", stats)
	}
	unblock()
	awaitProviderSignal(t, returned)
	if p.Stats().InFlight != 0 {
		t.Fatal("provider leaked branch slot")
	}
}

func TestParallelProviderJoinsBeforePropagatingPanic(t *testing.T) {
	for _, branch := range []string{"a", "b"} {
		t.Run(branch, func(t *testing.T) {
			p, err := NewParallelProvider(1)
			requireNoError(t, err)
			entered, panicked := make(chan struct{}), make(chan struct{})
			release, unblock := providerTestGate()
			defer unblock()
			returned := make(chan any, 1)
			block := func() { close(entered); <-release }
			fail := func() { close(panicked); panic("upstream-test-panic") }
			go func() {
				defer func() { returned <- recover() }()
				if branch == "a" {
					p.runPair(fail, block)
				} else {
					p.runPair(block, fail)
				}
			}()
			awaitProviderSignal(t, entered)
			awaitProviderSignal(t, panicked)
			select {
			case <-returned:
				t.Fatal("panic escaped while other branch retained private material")
			default:
			}
			unblock()
			select {
			case value := <-returned:
				if value != "upstream-test-panic" {
					t.Fatalf("lost original panic: %v", value)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("panic join did not finish")
			}
			if p.Stats().InFlight != 0 {
				t.Fatal("panic leaked bounded slot")
			}
		})
	}
}

func TestParallelProviderJoinRetainsOriginalDestroyLock(t *testing.T) {
	key, _, err := KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	p, err := NewParallelProvider(1)
	requireNoError(t, err)
	entered, joined, destroyed := make(chan struct{}), make(chan struct{}), make(chan struct{})
	release, unblock := providerTestGate()
	defer unblock()
	// Deterministic scheduling test of the exact lock/join order used by
	// BatchSign. Real signing and actual Destroy races are tested separately.
	go func() {
		key.state.mu.Lock()
		p.runPair(func() { close(entered); <-release }, func() {})
		key.state.mu.Unlock()
		close(joined)
	}()
	awaitProviderSignal(t, entered)
	go func() { key.Destroy(); close(destroyed) }()
	select {
	case <-destroyed:
		t.Fatal("Destroy passed key lock while one branch was active")
	default:
	}
	unblock()
	awaitProviderSignal(t, joined)
	awaitProviderSignal(t, destroyed)
	if key.state.a != nil || key.state.b != nil || p.Stats().InFlight != 0 {
		t.Fatal("Destroy/join left active key work")
	}
}

type failingProviderEntropy struct{ err error }

func (r failingProviderEntropy) Read([]byte) (int, error) { return 0, r.err }

func TestParallelProviderRealEntropyFailureReturnsNoPartialSignature(t *testing.T) {
	key, _, err := KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	p, err := NewParallelProvider(1)
	requireNoError(t, err)
	sentinel := errors.New("research entropy failure")
	for _, selected := range []*ParallelProvider{nil, p} {
		key.state.mu.Lock()
		a, b, err := signSignaturesWithEntropy(key.state, []byte("full A message"), []byte("full B message"), selected, failingProviderEntropy{sentinel})
		key.state.mu.Unlock()
		if !errors.Is(err, sentinel) || a != nil || b != nil {
			t.Fatalf("real provider error exposed partial output: a=%d b=%d err=%v", len(a), len(b), err)
		}
		if p.Stats().InFlight != 0 {
			t.Fatal("provider returned failure before join")
		}
	}
	// Failed randomized signing is not key destruction or an authorization
	// result. A new explicit signing call still uses fresh system entropy.
	batch, err := BatchSign(key, Metadata{ChainID: bytes.Repeat([]byte{34}, 32), Owner: "entropy-failure-qa", Purpose: "TX-BATCH"}, [][]byte{[]byte("after failure")}, SignOptions{ParallelProvider: p})
	requireNoError(t, err)
	defer batch.Discard()
	wire, err := batch.CertificateWire()
	requireNoError(t, err)
	c, err := DecodeCertificate(wire)
	requireNoError(t, err)
	r := registration(c)
	_, err = parallelVerifier(t, &r, p, nil).AuthenticateCertificate(wire, 7)
	requireNoError(t, err)
}

func TestParallelProviderRealSignAndBothVerificationBranches(t *testing.T) {
	key, public, err := KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	p, err := NewParallelProvider(2)
	requireNoError(t, err)
	metadata := Metadata{ChainID: bytes.Repeat([]byte{31}, 32), Owner: "parallel-provider-qa", Purpose: "TX-BATCH"}
	for _, n := range []int{1, 16} {
		messages := make([][]byte, n)
		for i := range messages {
			messages[i] = []byte(fmt.Sprintf("complete real message %d", i))
		}
		for _, signer := range []*ParallelProvider{nil, p} {
			batch, err := BatchSign(key, metadata, messages, SignOptions{Optimized: true, ParallelProvider: signer})
			requireNoError(t, err)
			whole, err := batch.WholeWire()
			requireNoError(t, err)
			certificate, err := batch.CertificateWire()
			requireNoError(t, err)
			c, err := DecodeCertificate(certificate)
			requireNoError(t, err)
			same(t, c.PKA, public.PKA)
			same(t, c.PKB, public.PKB)
			r := registration(c)
			for _, verifierProvider := range []*ParallelProvider{nil, p} {
				v := parallelVerifier(t, &r, verifierProvider, nil)
				requireNoError(t, v.VerifyWhole(whole, 7))
				m, err := Extract(batch, uint32(n-1))
				requireNoError(t, err)
				wire, err := EncodeMember(m)
				requireNoError(t, err)
				requireNoError(t, v.VerifyOne(wire, 7))
				if v.Stats().SignatureChecks != 4 {
					t.Fatal("cold Whole/member path skipped real branch")
				}
				for _, branch := range []string{"a", "b", "both"} {
					bad, err := DecodeCertificate(certificate)
					requireNoError(t, err)
					if branch != "b" {
						bad.SigmaA[0] ^= 1
					}
					if branch != "a" {
						bad.SigmaB[0] ^= 1
					}
					badWire, err := EncodeCertificate(bad)
					requireNoError(t, err)
					_, err = parallelVerifier(t, &r, verifierProvider, nil).AuthenticateCertificate(badWire, 7)
					if !errors.Is(err, ErrInvalidSignature) {
						t.Fatalf("branch %s: %v", branch, err)
					}
				}
			}
			batch.Discard()
		}
	}
	if stats := p.Stats(); stats.InFlight != 0 || stats.ParallelOperations == 0 || stats.PeakInFlight > 2 {
		t.Fatalf("provider accounting: %+v", stats)
	}
	_, err = BatchSign(key, metadata, [][]byte{[]byte("invalid option")}, SignOptions{ParallelProvider: &ParallelProvider{}})
	requireError(t, err)
	_, err = NewVerifier(VerifierOptions{ChainID: metadata.ChainID, Purpose: metadata.Purpose, ResolveTrustedOwner: func(TrustRequest) (Registration, error) { return Registration{}, nil }, ParallelProvider: &ParallelProvider{}})
	requireError(t, err)
	alias := *key
	key.Destroy()
	for _, k := range []*PrivateKey{key, &alias} {
		batch, err := BatchSign(k, metadata, [][]byte{[]byte("destroyed")}, SignOptions{ParallelProvider: p})
		if err == nil || batch != nil {
			t.Fatal("parallel mode revived a destroyed key or exposed partial batch")
		}
	}
}

func TestParallelProviderConcurrentRealSigningAndDestroy(t *testing.T) {
	p, err := NewParallelProvider(1)
	requireNoError(t, err)
	key, _, err := KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	alias := *key
	metadata := Metadata{ChainID: bytes.Repeat([]byte{32}, 32), Owner: "parallel-destroy-qa", Purpose: "TX-BATCH"}
	start := make(chan struct{})
	failures := make(chan error, 8)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			batch, err := BatchSign(&alias, metadata, [][]byte{[]byte(fmt.Sprintf("destroy race %d", i))}, SignOptions{ParallelProvider: p})
			if err != nil {
				if batch != nil {
					failures <- errors.New("failed sign exposed batch")
				}
				return
			}
			defer batch.Discard()
			wire, err := batch.CertificateWire()
			if err != nil {
				failures <- err
				return
			}
			c, err := DecodeCertificate(wire)
			if err != nil {
				failures <- err
				return
			}
			r := registration(c)
			_, err = parallelVerifier(t, &r, p, nil).AuthenticateCertificate(wire, 7)
			if err != nil {
				failures <- err
			}
		}(i)
	}
	close(start)
	key.Destroy()
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	if stats := p.Stats(); stats.InFlight != 0 || stats.PeakInFlight > 1 {
		t.Fatalf("destroy released while branch active: %+v", stats)
	}
	batch, err := BatchSign(&alias, metadata, [][]byte{[]byte("after destroy")}, SignOptions{ParallelProvider: p})
	if err == nil || batch != nil {
		t.Fatal("destroyed alias remained active")
	}
}

// Separate caller goroutines are existing application load. The provider may
// add only its fixed number of branch goroutines, never one unbounded worker
// per incoming transaction. Actual branches use the real published fixture.
func TestParallelProviderConcurrentVerificationBudget(t *testing.T) {
	f := fixture(t)
	wire := b64(t, f.Certificate)
	c, err := DecodeCertificate(wire)
	requireNoError(t, err)
	r := registration(c)
	p, err := NewParallelProvider(2)
	requireNoError(t, err)
	var wg sync.WaitGroup
	var failures atomic.Uint64
	start := make(chan struct{})
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := parallelVerifier(t, &r, p, nil).AuthenticateCertificate(wire, 7)
			if err != nil {
				failures.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()
	stats := p.Stats()
	if failures.Load() != 0 || stats.InFlight != 0 || stats.PeakInFlight > 2 || stats.ParallelOperations+stats.SerialFallbacks != 12 {
		t.Fatalf("concurrent provider lost AND/bound: errors=%d stats=%+v", failures.Load(), stats)
	}
}

func TestParallelProviderCacheFailureTrustAndMembership(t *testing.T) {
	f := fixture(t)
	original := b64(t, f.Member)
	member, err := DecodeMember(original)
	requireNoError(t, err)
	r := registration(member.Certificate)
	p, err := NewParallelProvider(1)
	requireNoError(t, err)
	cache, err := NewCertificateCache(2)
	requireNoError(t, err)
	for _, branch := range []string{"A", "B"} {
		bad, err := DecodeMember(original)
		requireNoError(t, err)
		if branch == "A" {
			bad.Certificate.SigmaA[0] ^= 1
		} else {
			bad.Certificate.SigmaB[0] ^= 1
		}
		wire, err := EncodeMember(bad)
		requireNoError(t, err)
		v := parallelVerifier(t, &r, p, cache)
		if err = v.VerifyOne(wire, 7); !errors.Is(err, ErrInvalidSignature) || v.Stats().SignatureChecks != 2 || cache.Stats().Entries != 0 {
			t.Fatalf("bad %s skipped AND or cached failure: %v", branch, err)
		}
	}
	first := parallelVerifier(t, &r, p, cache)
	requireNoError(t, first.VerifyOne(original, 7))
	if first.Stats().SignatureChecks != 2 || cache.Stats().Entries != 1 {
		t.Fatal("cold parallel provider did not authenticate both")
	}
	before := p.Stats()
	second := parallelVerifier(t, &r, p, cache)
	requireNoError(t, second.VerifyOne(original, 7))
	if second.Stats().SignatureChecks != 0 || p.Stats().ParallelOperations != before.ParallelOperations {
		t.Fatal("successful cache unexpectedly repeated provider")
	}
	bad, err := DecodeMember(original)
	requireNoError(t, err)
	bad.PathB[0][0] ^= 1
	wire, err := EncodeMember(bad)
	requireNoError(t, err)
	if !errors.Is(parallelVerifier(t, &r, p, cache).VerifyOne(wire, 7), ErrMembership) {
		t.Fatal("cached parallel signature bypassed second tree")
	}
	at := uint64(7)
	r.RevokedAt = &at
	if err = parallelVerifier(t, &r, p, cache).VerifyOne(original, 7); !errors.Is(err, ErrUntrusted) {
		t.Fatal("parallel/cache path froze current authorization")
	}
	if p.Stats().InFlight != 0 {
		t.Fatal("verification returned before branch joined")
	}
}
