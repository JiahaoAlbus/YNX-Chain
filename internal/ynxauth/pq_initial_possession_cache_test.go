package ynxauth

import (
	"bytes"
	"errors"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func initialPossessionCacheFixture(t *testing.T) (*ynxbatch.PrivateKey, RegistrationIntent, ynxbatch.Registration) {
	t.Helper()
	key, public, err := ynxbatch.KeyGen()
	authOK(t, err)
	t.Cleanup(key.Destroy)
	intent := RegistrationIntent{ChainID: authNetwork(t), Owner: qaFrom, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 20}
	trusted := ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: intent.Owner, Purpose: TransactionPurpose, PolicyRevision: "GENESIS:synthetic-independent-bootstrap", ChainID: bytes.Clone(intent.ChainID), PKA: bytes.Clone(public.PKA), PKB: bytes.Clone(public.PKB), Enabled: true, ActiveFrom: 10}
	return key, intent, trusted
}

func initialPossessionCacheWire(t *testing.T, key *ynxbatch.PrivateKey, intent RegistrationIntent) []byte {
	t.Helper()
	message, err := intent.SigningBytes()
	authOK(t, err)
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: intent.ChainID, Owner: intent.Owner, Purpose: TransactionPurpose}, [][]byte{[]byte("unrelated first member"), message}, ynxbatch.SignOptions{Optimized: true})
	authOK(t, err)
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, 1)
	authOK(t, err)
	wire, err := ynxbatch.EncodeMember(member)
	authOK(t, err)
	return wire
}

func TestPQInitialPossessionCacheRetainsBothProofsAndLiveBinding(t *testing.T) {
	key, intent, trusted := initialPossessionCacheFixture(t)
	wire := initialPossessionCacheWire(t, key, intent)
	cache, err := ynxbatch.NewCertificateCache(2)
	authOK(t, err)
	scope := bytes.Repeat([]byte{0x31}, 32)
	for i := 0; i < 2; i++ {
		got, err := VerifyPQInitialRegistrationPossessionWithCache(wire, trusted, 10, cache, scope)
		authOK(t, err)
		if !reflect.DeepEqual(got, intent) {
			t.Fatal("cached possession changed the complete initial intent")
		}
	}
	if stats := cache.Stats(); stats.Entries != 1 || stats.Misses != 1 || stats.Hits != 1 {
		t.Fatal("actual independent verifiers did not reuse the same dual certificate", stats)
	}
	for name, mutate := range map[string]func(*ynxbatch.Member){
		"ML-DSA-87":              func(m *ynxbatch.Member) { m.Certificate.SigmaA[0] ^= 1 },
		"SLH-DSA-SHA2-256f":      func(m *ynxbatch.Member) { m.Certificate.SigmaB[0] ^= 1 },
		"membership tree A":      func(m *ynxbatch.Member) { m.PathA[0][0] ^= 1 },
		"membership tree B":      func(m *ynxbatch.Member) { m.PathB[0][0] ^= 1 },
		"membership index":       func(m *ynxbatch.Member) { m.Index = 0 },
		"full signed message":    func(m *ynxbatch.Member) { m.Message[len(m.Message)-1] ^= 1 },
		"certificate owner":      func(m *ynxbatch.Member) { m.Certificate.Owner = qaTo },
		"certificate purpose":    func(m *ynxbatch.Member) { m.Certificate.Purpose = MigrationPurpose },
		"certificate full key A": func(m *ynxbatch.Member) { m.Certificate.PKA[0] ^= 1 },
		"certificate full key B": func(m *ynxbatch.Member) { m.Certificate.PKB[0] ^= 1 },
	} {
		t.Run(name, func(t *testing.T) {
			member, err := ynxbatch.DecodeMember(wire)
			authOK(t, err)
			mutate(&member)
			bad, err := ynxbatch.EncodeMember(member)
			authOK(t, err)
			_, want := VerifyPQInitialRegistrationPossession(bad, trusted, 10)
			_, got := VerifyPQInitialRegistrationPossessionWithCache(bad, trusted, 10, cache, scope)
			if want == nil || got == nil || want.Error() != got.Error() || cache.Stats().Entries != 1 {
				t.Fatalf("warm cache bypassed the original proof error or retained an invalid certificate: %v %v", want, got)
			}
			if (name == "ML-DSA-87" || name == "SLH-DSA-SHA2-256f") && !errors.Is(got, ynxbatch.ErrInvalidSignature) {
				t.Fatal("damaged branch did not reach actual dual-signature mathematics", got)
			}
		})
	}
	for name, mutate := range map[string]func(*ynxbatch.Registration){
		"disabled":      func(r *ynxbatch.Registration) { r.Enabled = false },
		"owner":         func(r *ynxbatch.Registration) { r.Owner = qaTo },
		"purpose":       func(r *ynxbatch.Registration) { r.Purpose = MigrationPurpose },
		"algorithm":     func(r *ynxbatch.Registration) { r.AlgorithmVersion = "other" },
		"revision":      func(r *ynxbatch.Registration) { r.PolicyRevision = "" },
		"future height": func(r *ynxbatch.Registration) { r.ActiveFrom = 11 },
		"revocation":    func(r *ynxbatch.Registration) { at := uint64(10); r.RevokedAt = &at },
		"full key A":    func(r *ynxbatch.Registration) { r.PKA[0] ^= 1 },
		"full key B":    func(r *ynxbatch.Registration) { r.PKB[0] ^= 1 },
		"network":       func(r *ynxbatch.Registration) { r.ChainID[0] ^= 1 },
	} {
		t.Run(name, func(t *testing.T) {
			changed := trusted
			changed.ChainID, changed.PKA, changed.PKB = bytes.Clone(trusted.ChainID), bytes.Clone(trusted.PKA), bytes.Clone(trusted.PKB)
			mutate(&changed)
			_, want := VerifyPQInitialRegistrationPossession(wire, changed, 10)
			_, got := VerifyPQInitialRegistrationPossessionWithCache(wire, changed, 10, cache, scope)
			if want == nil || got == nil || want.Error() != got.Error() || cache.Stats().Entries != 1 {
				t.Fatalf("warm certificate replaced live bootstrap/height/revocation checks: %v %v", want, got)
			}
		})
	}
	// Reusing a caller's byte buffers cannot rewrite a retained success key.
	wire[len(wire)-1] ^= 1
	_, err = VerifyPQInitialRegistrationPossessionWithCache(wire, trusted, 10, cache, scope)
	authReject(t, err)
	wire[len(wire)-1] ^= 1
	_, err = VerifyPQInitialRegistrationPossessionWithCache(wire, trusted, 10, cache, scope)
	authOK(t, err)
}

func TestPQInitialPossessionCacheSeventeenCertificatesRemainBoundedAndSeparated(t *testing.T) {
	key, intent, trusted := initialPossessionCacheFixture(t)
	cache, err := ynxbatch.NewCertificateCache(32)
	authOK(t, err)
	scope := bytes.Repeat([]byte{0x41}, 32)
	wires := make([][]byte, 17)
	for i := range wires {
		// Independent random BatchIDs create distinct real certificates. The
		// mathematical fixture assigns no account or execution authority.
		wires[i] = initialPossessionCacheWire(t, key, intent)
		_, err := VerifyPQInitialRegistrationPossessionWithCache(wires[i], trusted, 10, cache, scope)
		authOK(t, err)
	}
	first := cache.Stats()
	if first.Entries != 17 || first.Misses != 17 || first.Hits != 0 {
		t.Fatal("fixture did not authenticate seventeen distinct certificates", first)
	}
	for _, wire := range wires {
		_, err := VerifyPQInitialRegistrationPossessionWithCache(wire, trusted, 10, cache, scope)
		authOK(t, err)
	}
	if stats := cache.Stats(); stats.Entries != 17 || stats.Misses != first.Misses || stats.Hits != 17 || stats.Capacity != 32 || stats.RetainedKeyBytes > 32*(ynxbatch.MaxCertificateBytes+4096) {
		t.Fatal("seventeen-certificate scan thrashed or exceeded the fixed key budget", stats)
	}
	// Reproduce the actual 16-entry LRU counterexample using the same seventeen
	// real certificates. This is cache work accounting, not measured throughput.
	tooSmall, err := ynxbatch.NewCertificateCache(16)
	authOK(t, err)
	for pass := 0; pass < 2; pass++ {
		for _, wire := range wires {
			_, err := VerifyPQInitialRegistrationPossessionWithCache(wire, trusted, 10, tooSmall, scope)
			authOK(t, err)
		}
	}
	if stats := tooSmall.Stats(); stats.Entries != 16 || stats.Hits != 0 || stats.Misses != 34 {
		t.Fatal("seventeen-certificate fixture did not reproduce the sixteen-entry LRU thrash", stats)
	}
	// A distinct independent Genesis scope or complete trusted revision must
	// perform fresh mathematics, even when that separate binding has the same
	// valid pair. Neither is a reason to reject an otherwise lawful proof.
	otherScope := bytes.Repeat([]byte{0x42}, 32)
	before := cache.Stats()
	_, err = VerifyPQInitialRegistrationPossessionWithCache(wires[0], trusted, 10, cache, otherScope)
	authOK(t, err)
	changed := trusted
	changed.PolicyRevision += "-other"
	_, err = VerifyPQInitialRegistrationPossessionWithCache(wires[0], changed, 10, cache, scope)
	authOK(t, err)
	if stats := cache.Stats(); stats.Hits != before.Hits || stats.Misses != before.Misses+2 || stats.Entries != before.Entries+2 {
		t.Fatal("cache conflated independent scope or full trusted registration", stats)
	}
	cache.Clear()
	if cache.Stats().Entries != 0 || cache.Stats().RetainedKeyBytes != 0 {
		t.Fatal("clear retained initial proof bytes")
	}
}
