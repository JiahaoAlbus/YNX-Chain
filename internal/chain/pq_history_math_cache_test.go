package chain

import (
	"bytes"
	"errors"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func TestPQHistoryMathCacheN1ScopeAndBinding(t *testing.T) {
	// Reuse one real signed N=1 transfer for every history and adversarial case.
	// The ordinary consumer must still execute it without shared certificate work.
	f := newPQLedger(t)
	f.activate(t)
	wire := f.member(t, 2, 1)
	admitted, replayed, err := f.d.SubmitPQTransfer(wire)
	pqMust(t, err)
	if replayed || f.d.pqCertificateCache.Stats() != (PQCertificateCacheStats{}) {
		t.Fatal("live N=1 admission changed its uncached path")
	}
	f.d.ProduceBlock()
	tx, ok := f.d.Transaction(admitted.Hash)
	if !ok || tx.BlockNum == 0 || tx.Hash != pqBatchHash(wire) {
		t.Fatal("missing original included N=1 transfer")
	}
	policy, _ := f.d.AccountAuthorization(f.owner)
	member, err := ynxbatch.DecodeMember(wire)
	pqMust(t, err)
	if member.Certificate.N != 1 || policy == nil || len(policy.Records) != 1 {
		t.Fatal("fixture is not an active ordinary member")
	}

	t.Run("history-repeats", func(t *testing.T) {
		cache := NewPQHistoryCertificateCache()
		for i := 0; i < 3; i++ {
			pqMust(t, ValidateConsensusHistoricalPQTransactionWithCache(tx, policy, tx.BlockNum, f.d.cfg.ChainID, cache))
			stats := cache.Stats()
			if stats.Certificates.Capacity != 16 || stats.Certificates.Entries != 1 || stats.Certificates.Misses != 1 || stats.Certificates.Hits != uint64(i) || stats.ScopeComputations != uint64(i+1) || stats.RetainedPolicyScopes != 1 {
				t.Fatalf("history did not reuse only successful mathematics: %+v", stats)
			}
		}
		before := cache.Stats()
		bad := tx
		bad.Amount++
		if ValidateConsensusHistoricalPQTransactionWithCache(bad, policy, tx.BlockNum, f.d.cfg.ChainID, cache) == nil || cache.Stats() != before {
			t.Fatal("warm history mathematics bypassed original execution fields")
		}
	})

	t.Run("uncached-and-live", func(t *testing.T) {
		var absent *PQCertificateCache
		pqMust(t, ValidateConsensusHistoricalPQTransactionWithCache(tx, policy, tx.BlockNum, f.d.cfg.ChainID, absent))
		for _, cache := range []*PQCertificateCache{NewPQCertificateCache(), {}} {
			pqMust(t, cache.VerifyMember(policy, f.owner, ynxauth.TransactionPurpose, member.Message, wire, tx.BlockNum))
			pqMust(t, cache.VerifyDecodedMember(policy, f.owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum))
			if cache.Stats() != (PQCertificateCacheStats{}) {
				t.Fatal("ordinary or zero-value N=1 cache computed shared work")
			}
		}
		if absent.Stats() != (PQCertificateCacheStats{}) {
			t.Fatal("nil cache retained verification work")
		}
		if err := NewPQHistoryCertificateCache().VerifyDecodedMember(nil, f.owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum); !errors.Is(err, ynxauth.ErrPolicy) {
			t.Fatalf("history cache accepted a missing policy: %v", err)
		}
	})

	t.Run("same-pointer-same-shape-policy", func(t *testing.T) {
		working := policy.Clone()
		cache := NewPQHistoryCertificateCache()
		_, originalScope, err := cache.VerifierCache(&working)
		pqMust(t, err)
		pqMust(t, cache.VerifyDecodedMember(&working, f.owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum))

		// LedgerNonce is valid policy content absent from the trusted verifier's
		// registration tuple. A pointer/length stamp or tuple-only scope would
		// incorrectly reuse the old mathematical success after this replacement.
		before := cache.Stats()
		working.Records[0].LedgerNonce++
		_, replacedScope, err := cache.VerifierCache(&working)
		pqMust(t, err)
		if bytes.Equal(originalScope, replacedScope) || cache.Stats().ScopeComputations != before.ScopeComputations+1 {
			t.Fatal("same-pointer same-shape policy replacement retained its old scope")
		}
		pqMust(t, cache.VerifyDecodedMember(&working, f.owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum))
		if stats := cache.Stats(); stats.Certificates.Misses != 2 || stats.Certificates.Hits != 0 || stats.Certificates.Entries != 2 || stats.RetainedPolicyScopes != 1 {
			t.Fatalf("changed complete policy borrowed old mathematics: %+v", stats)
		}

		for _, branch := range []string{"A", "B"} {
			t.Run("replaced-key-"+branch, func(t *testing.T) {
				working = policy.Clone() // Keep the supplied State pointer unchanged.
				if branch == "A" {
					working.Records[0].PKA[0] ^= 1
				} else {
					working.Records[0].PKB[0] ^= 1
				}
				before := cache.Stats()
				_, changedScope, err := cache.VerifierCache(&working)
				pqMust(t, err)
				if bytes.Equal(originalScope, changedScope) {
					t.Fatal("replaced full key retained the original policy scope")
				}
				old := working.VerifyDecodedMemberWithCache(f.owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum, nil, nil)
				got := cache.VerifyDecodedMember(&working, f.owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum)
				if old == nil || got == nil || old.Error() != got.Error() {
					t.Fatalf("replaced key: uncached=%v historical=%v", old, got)
				}
				after := cache.Stats()
				if after.Certificates != before.Certificates || after.ScopeComputations != before.ScopeComputations+2 {
					t.Fatal("replaced key reached cached mathematics or skipped full policy hashing")
				}
			})
		}
		working = policy.Clone()
		pqMust(t, cache.VerifyDecodedMember(&working, f.owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum))
		if stats := cache.Stats(); stats.Certificates.Misses != 2 || stats.Certificates.Hits != 1 {
			t.Fatalf("restored exact policy did not recover only its own success: %+v", stats)
		}
	})

	t.Run("warm-signatures-metadata-and-membership", func(t *testing.T) {
		cache := NewPQHistoryCertificateCache()
		pqMust(t, cache.VerifyDecodedMember(policy, f.owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum))
		for _, tc := range []struct {
			name          string
			mutate        func(*ynxbatch.Member)
			mathMiss, hit uint64
		}{
			{"signature-A", func(m *ynxbatch.Member) { m.Certificate.SigmaA[0] ^= 1 }, 1, 0},
			{"signature-B", func(m *ynxbatch.Member) { m.Certificate.SigmaB[0] ^= 1 }, 1, 0},
			{"network", func(m *ynxbatch.Member) { m.Certificate.ChainID[0] ^= 1 }, 0, 0},
			{"owner", func(m *ynxbatch.Member) { m.Certificate.Owner = f.to }, 0, 0},
			{"purpose", func(m *ynxbatch.Member) { m.Certificate.Purpose = ynxauth.MigrationPurpose }, 0, 0},
			{"message", func(m *ynxbatch.Member) { m.Message[0] ^= 1 }, 0, 0},
			{"index", func(m *ynxbatch.Member) { m.Index = 1 }, 0, 1},
			{"path-A", func(m *ynxbatch.Member) { m.PathA = [][]byte{make([]byte, 32)} }, 0, 1},
			{"path-B", func(m *ynxbatch.Member) { m.PathB = [][]byte{make([]byte, 64)} }, 0, 1},
		} {
			t.Run(tc.name, func(t *testing.T) {
				bad, err := ynxbatch.DecodeMember(wire)
				pqMust(t, err)
				tc.mutate(&bad)
				old := policy.VerifyDecodedMemberWithCache(f.owner, ynxauth.TransactionPurpose, member.Message, bad, tx.BlockNum, nil, nil)
				before := cache.Stats()
				got := cache.VerifyDecodedMember(policy, f.owner, ynxauth.TransactionPurpose, member.Message, bad, tx.BlockNum)
				if old == nil || got == nil || old.Error() != got.Error() {
					t.Fatalf("uncached=%v historical=%v", old, got)
				}
				after := cache.Stats()
				if after.Certificates.Entries != 1 || after.Certificates.Misses != before.Certificates.Misses+tc.mathMiss || after.Certificates.Hits != before.Certificates.Hits+tc.hit || after.ScopeComputations != before.ScopeComputations+1 {
					t.Fatalf("failed proof borrowed authority or cached failure: before=%+v after=%+v", before, after)
				}
			})
		}
		before := cache.Stats()
		if cache.VerifyDecodedMember(policy, f.owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum-1) == nil {
			t.Fatal("warm N=1 mathematics bypassed activation height")
		}
		if after := cache.Stats(); after.Certificates != before.Certificates || after.ScopeComputations != before.ScopeComputations+1 {
			t.Fatal("inactive registration reached cached mathematics")
		}
	})
}
