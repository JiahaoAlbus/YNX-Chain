package ynxbatch

import (
	"bytes"
	"errors"
	"testing"
	"time"
)

// Retain the pre-change raw Whole call graph as the differential reference.
// It uses the original public authentication/math, not a fake signer/verifier.
func legacyWholeSnapshotBatch(v *Verifier, cert []byte, messages [][]byte, height uint64) error {
	c, err := DecodeCertificate(cert)
	if err != nil {
		return err
	}
	if err = ValidateMessages(messages, c.N); err != nil {
		return err
	}
	input := copyMessages(messages)
	h, err := v.AuthenticateCertificate(cert, height)
	if err != nil {
		return err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	s, err := v.state(h, height)
	if err != nil {
		return err
	}
	a, err := buildTree(s.hash.a, input)
	if err != nil {
		return err
	}
	b, err := buildTree(s.hash.b, input)
	if err != nil {
		return err
	}
	if !bytes.Equal(a.root(), s.c.RootA) || !bytes.Equal(b.root(), s.c.RootB) {
		return ErrMembership
	}
	_, err = v.state(h, height)
	return err
}

func legacyWholeSnapshot(v *Verifier, wire []byte, height uint64) error {
	w, err := DecodeWhole(wire)
	if err != nil {
		return err
	}
	c, err := EncodeCertificate(w.Certificate)
	if err != nil {
		return err
	}
	return legacyWholeSnapshotBatch(v, c, w.Messages, height)
}

func wholeSnapshotVerifier(t testing.TB, r Registration, cache *CertificateCache, resolve func(TrustRequest) (Registration, error)) *Verifier {
	t.Helper()
	if resolve == nil {
		resolve = func(TrustRequest) (Registration, error) { return r, nil }
	}
	opts := VerifierOptions{ChainID: r.ChainID, Purpose: r.Purpose, ResolveTrustedOwner: resolve, CacheEntries: 1, Optimized: true}
	if cache != nil {
		opts.CertificateCache, opts.CacheScope = cache, bytes.Repeat([]byte{73}, 32)
	}
	v, err := NewVerifier(opts)
	requireNoError(t, err)
	t.Cleanup(v.Clear)
	return v
}

func TestWholeSnapshotAuthenticationHandleBeforeDecode(t *testing.T) {
	for _, v := range []*Verifier{nil, {}} {
		if _, err := v.AuthenticateCertificate([]byte("invalid"), 7); !errors.Is(err, ErrHandle) {
			t.Fatal("invalid handle must precede certificate decoding", err)
		}
		// The batch API instead retains Decode -> ValidateMessages -> auth.
		if err := v.VerifyWholeBatch([]byte("invalid"), nil, 7); err == nil || errors.Is(err, ErrHandle) {
			t.Fatal("batch certificate decoding no longer precedes authentication", err)
		}
	}
	f := fixture(t)
	w, err := DecodeWhole(b64(t, f.Whole))
	requireNoError(t, err)
	v := wholeSnapshotVerifier(t, registration(w.Certificate), nil, nil)
	cert, err := EncodeCertificate(w.Certificate)
	requireNoError(t, err)
	h, err := v.AuthenticateCertificate(cert, 7)
	requireNoError(t, err)
	v.Clear()
	if err = v.VerifyMember(h, nil, Proof{}, 7); !errors.Is(err, ErrHandle) {
		t.Fatal("clear did not invalidate the original handle", err)
	}
	// Clear invalidates issued handles; it does not disable the verifier.
	_, err = v.AuthenticateCertificate(cert, 7)
	requireNoError(t, err)
}

func TestWholeSnapshotBeforeResolverAndSharedMath(t *testing.T) {
	f := fixture(t)
	original := b64(t, f.Whole)
	w, err := DecodeWhole(original)
	requireNoError(t, err)
	for _, api := range []string{"whole", "certificate-messages"} {
		for _, warm := range []bool{false, true} {
			t.Run(api+map[bool]string{false: "-cold", true: "-warm"}[warm], func(t *testing.T) {
				cache, err := NewCertificateCache(2)
				requireNoError(t, err)
				r := registration(w.Certificate)
				if warm {
					v := wholeSnapshotVerifier(t, r, cache, nil)
					requireNoError(t, v.VerifyWhole(original, 7))
					v.Clear()
				}
				wire := bytes.Clone(original)
				cert, err := EncodeCertificate(w.Certificate)
				requireNoError(t, err)
				messages := copyMessages(w.Messages)
				mutated := false
				v := wholeSnapshotVerifier(t, r, cache, func(TrustRequest) (Registration, error) {
					if !mutated {
						clear(wire)
						clear(cert)
						for _, m := range messages {
							clear(m)
						}
						mutated = true
					}
					return r, nil
				})
				if api == "whole" {
					err = v.VerifyWhole(wire, 7)
				} else {
					err = v.VerifyWholeBatch(cert, messages, 7)
				}
				requireNoError(t, err)
				if !mutated {
					t.Fatal("normal trusted registration callback did not execute")
				}
				checks := uint64(2)
				if warm {
					checks = 0
				}
				if v.Stats().SignatureChecks != checks {
					t.Fatalf("cold AND or warm math boundary changed: %+v", v.Stats())
				}
				// The caller mutation must not contaminate a retained local state.
				requireNoError(t, v.VerifyWhole(original, 7))
				if cache.Stats().Capacity != 2 || cache.Stats().Entries != 1 {
					t.Fatal("snapshot changed shared cache budget")
				}
			})
		}
	}
}

func TestWholeSnapshotOriginalErrorsAndBothSignatures(t *testing.T) {
	f := fixture(t)
	original := b64(t, f.Whole)
	w, err := DecodeWhole(original)
	requireNoError(t, err)
	for _, scenario := range []string{"valid", "short-frame", "sigma-A", "sigma-B", "message", "inactive", "revoked", "wrong-full-pair"} {
		t.Run(scenario, func(t *testing.T) {
			wire := bytes.Clone(original)
			changed, err := DecodeWhole(original)
			requireNoError(t, err)
			r := registration(w.Certificate)
			switch scenario {
			case "short-frame":
				wire = wire[:len(wire)-1]
			case "sigma-A":
				changed.Certificate.SigmaA[0] ^= 1
				wire, err = EncodeWhole(changed)
			case "sigma-B":
				changed.Certificate.SigmaB[0] ^= 1
				wire, err = EncodeWhole(changed)
			case "message":
				changed.Messages[0][0] ^= 1
				wire, err = EncodeWhole(changed)
			case "inactive":
				r.Enabled = false
			case "revoked":
				at := uint64(7)
				r.RevokedAt = &at
			case "wrong-full-pair":
				r.PKB[0] ^= 1
			}
			requireNoError(t, err)
			old := wholeSnapshotVerifier(t, r, nil, nil)
			next := wholeSnapshotVerifier(t, r, nil, nil)
			before := bytes.Clone(wire)
			a, b := legacyWholeSnapshot(old, wire, 7), next.VerifyWhole(wire, 7)
			if (a == nil) != (b == nil) || (a != nil && a.Error() != b.Error()) {
				t.Fatalf("original failure order changed: old=%v new=%v", a, b)
			}
			if scenario == "valid" {
				requireNoError(t, b)
			} else if b == nil {
				t.Fatal("invalid Whole accepted")
			}
			if (scenario == "sigma-A" || scenario == "sigma-B") && !errors.Is(b, ErrInvalidSignature) {
				t.Fatal("did not execute and reject genuine AND mathematics", b)
			}
			if !bytes.Equal(before, wire) {
				t.Fatal("verification rewrote original public wire")
			}
		})
	}
	for _, messages := range [][][]byte{nil, w.Messages[:len(w.Messages)-1]} {
		cert, err := EncodeCertificate(w.Certificate)
		requireNoError(t, err)
		r := registration(w.Certificate)
		r.Enabled = false
		old, next := wholeSnapshotVerifier(t, r, nil, nil), wholeSnapshotVerifier(t, r, nil, nil)
		a, b := legacyWholeSnapshotBatch(old, cert, messages, 7), next.VerifyWholeBatch(cert, messages, 7)
		if a == nil || b == nil || a.Error() != b.Error() || next.Stats().SignatureChecks != 0 {
			t.Fatal("message bounds no longer precede authentication", a, b)
		}
	}
}

func TestWholeSnapshotWarmAllocationMeasurement(t *testing.T) {
	f := fixture(t)
	wire := b64(t, f.Whole)
	w, err := DecodeWhole(wire)
	requireNoError(t, err)
	r := registration(w.Certificate)
	old, next := wholeSnapshotVerifier(t, r, nil, nil), wholeSnapshotVerifier(t, r, nil, nil)
	requireNoError(t, legacyWholeSnapshot(old, wire, 7))
	requireNoError(t, next.VerifyWhole(wire, 7))
	oldAllocs := testing.AllocsPerRun(4, func() {
		if err := legacyWholeSnapshot(old, wire, 7); err != nil {
			t.Fatal(err)
		}
	})
	newAllocs := testing.AllocsPerRun(4, func() {
		if err := next.VerifyWhole(wire, 7); err != nil {
			t.Fatal(err)
		}
	})
	if newAllocs >= oldAllocs {
		t.Fatalf("snapshot refactor did not reduce actual warm allocations: old=%.0f new=%.0f", oldAllocs, newAllocs)
	}
	measure := func(run func() error) time.Duration {
		start := time.Now()
		for i := 0; i < 12; i++ {
			requireNoError(t, run())
		}
		return time.Since(start) / 12
	}
	oldNS := measure(func() error { return legacyWholeSnapshot(old, wire, 7) })
	newNS := measure(func() error { return next.VerifyWhole(wire, 7) })
	t.Logf("WHOLE_SNAPSHOT_LOCAL warm_original_and_verified=true old_allocs=%.0f new_allocs=%.0f old_ns=%d new_ns=%d input_members=%d commit_measured=false", oldAllocs, newAllocs, oldNS.Nanoseconds(), newNS.Nanoseconds(), w.Certificate.N)
}
