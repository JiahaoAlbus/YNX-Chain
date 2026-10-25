package chain

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func pqCacheMembers(t *testing.T, f *pqLedgerFixture, messages [][]byte) [][]byte {
	t.Helper()
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	pqMust(t, err)
	defer batch.Discard()
	out := make([][]byte, len(messages))
	for i := range out {
		m, err := ynxbatch.Extract(batch, uint32(i))
		pqMust(t, err)
		out[i], err = ynxbatch.EncodeMember(m)
		pqMust(t, err)
	}
	return out
}

func TestPQCertificateCacheLiveMemberActionWholeHistoryAndRestart(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	if f.d.pqCertificateCache == nil {
		t.Fatal("production constructor omitted cache")
	}
	messages := make([][]byte, 4)
	for i := range messages {
		var err error
		if i < 2 {
			messages[i], err = f.batchTransfer(uint64(i+2), 1).SigningBytes()
		} else {
			body, bodyErr := ynxauth.EncodeActionPayload(ynxauth.ActionStake, ynxauth.StakePayload{Amount: 1})
			pqMust(t, bodyErr)
			messages[i], err = (ynxauth.Action{ChainID: f.network, NativeChainID: uint64(f.d.cfg.ChainID), Owner: f.owner, Nonce: uint64(i + 2), Kind: ynxauth.ActionStake, Payload: body}).SigningBytes()
		}
		pqMust(t, err)
	}
	members := pqCacheMembers(t, f, messages)
	for i, wire := range members {
		// The frozen uncached authentication path accepts the identical complete
		// message before the production consumer verifies and executes it.
		pqMust(t, pqVerifyMemberBeforeConsumer(f.d.accountPolicy, f.owner, messages[i], wire, f.d.accountExecutionHeightLocked()))
		var tx Transaction
		var replayed bool
		var err error
		if i < 2 {
			tx, replayed, err = f.d.SubmitPQTransfer(wire)
		} else {
			tx, replayed, err = f.d.SubmitPQAction(wire)
		}
		pqMust(t, err)
		if replayed || tx.Nonce != uint64(i+2) || tx.Hash != pqBatchHash(wire) {
			t.Fatal("cache altered business identity")
		}
	}
	stats := f.d.pqCertificateCache.Stats()
	if stats.Certificates.Misses != 1 || stats.Certificates.Hits != 3 || stats.ScopeComputations != 1 {
		t.Fatalf("live members did not share one real certificate: %+v", stats)
	}
	whole := f.whole(t, f.batchTransfer(6, 1), f.batchTransfer(7, 1))
	out, err := f.d.SubmitPQBatch(whole)
	pqMust(t, err)
	if out.Status != "durable" || len(out.Results) != 2 || out.Results[0].Outcome != "admitted" || out.Results[1].Outcome != "admitted" {
		t.Fatal("cached Whole lost independent execution")
	}
	stats = f.d.pqCertificateCache.Stats()
	if stats.Certificates.Misses != 2 || stats.ScopeComputations != 1 {
		t.Fatalf("Whole did not use owned cache: %+v", stats)
	}
	account, _ := f.d.Account(f.owner)
	if account.Nonce != 7 || account.Balance != 989 || account.Staked != 2 {
		t.Fatalf("wrong final business state: %+v", account)
	}
	f.d.ProduceBlock()
	snapshot := pqBatchSnapshotCopy(t, f.d)
	historyCache := NewPQCertificateCache()
	pqMust(t, validateAccountPolicySnapshotWithCache(snapshot, historyCache))
	stats = historyCache.Stats()
	if stats.Certificates.Misses != 2 || stats.Certificates.Hits != 3 || stats.ScopeComputations != 1 {
		t.Fatalf("history reverified each member certificate: %+v", stats)
	}
	// A warm certificate cannot authenticate edited business fields or deletion.
	bad := pqBatchSnapshotCopy(t, f.d)
	changed := false
	for bi := range bad.Blocks {
		for ti := range bad.Blocks[bi].Transactions {
			tx := &bad.Blocks[bi].Transactions[ti]
			if tx.Hash == pqBatchHash(members[0]) {
				tx.Amount++
				changed = true
			}
		}
	}
	if !changed || validateAccountPolicySnapshotWithCache(bad, historyCache) == nil {
		t.Fatal("warm cache accepted changed execution")
	}
	before := moduleBusinessState(t, f.d)
	restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	pqMust(t, err)
	assertModuleState(t, restored, before)
	if restored.pqCertificateCache == nil || restored.pqCertificateCache.Stats().Certificates.Entries != 0 {
		t.Fatal("cache success was persisted as state")
	}
	old, replayed, err := restored.SubmitPQAction(members[2])
	pqMust(t, err)
	if !replayed || old.Hash != pqBatchHash(members[2]) {
		t.Fatal("restart lost original action identity")
	}
	assertModuleState(t, restored, before)
}

func TestPQCertificateCacheScopeCloneAppendReplacementAndInvalidation(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	source, _ := f.d.AccountAuthorization(f.owner)
	cache := NewPQCertificateCache()
	_, original, err := cache.VerifierCache(source)
	pqMust(t, err)
	for i := 0; i < 64; i++ {
		cloned := cache.ClonePolicy(source)
		_, scope, err := cache.VerifierCache(cloned)
		pqMust(t, err)
		if !bytes.Equal(scope, original) {
			t.Fatal("trusted clone changed complete policy commitment")
		}
	}
	if stats := cache.Stats(); stats.ScopeComputations != 1 || stats.RetainedPolicyScopes != 2 {
		t.Fatalf("execution clones rehashed or accumulated: %+v", stats)
	}
	// Model a valid append-only version/terminal tombstone transition in place.
	revocation, err := ynxauth.DecodeRevocation(pqRevocationWire(t, f, 2, 2, 1))
	pqMust(t, err)
	next, err := source.AdmitRevocation(revocation, 2, 1)
	pqMust(t, err)
	*source = next
	_, changed, err := cache.VerifierCache(source)
	pqMust(t, err)
	if bytes.Equal(original, changed) || cache.Stats().ScopeComputations != 2 {
		t.Fatal("in-place legal revocation reused old scope")
	}
	// Loading/replacing existing content of identical shape requires invalidation.
	cache.Invalidate()
	_, changedAgain, err := cache.VerifierCache(source)
	pqMust(t, err)
	if !bytes.Equal(changed, changedAgain) || cache.Stats().ScopeComputations != 3 || cache.Stats().RetainedPolicyScopes != 1 {
		t.Fatal("explicit state replacement did not reset memo")
	}
}

func TestPQCertificateCacheLazyScopeAndEmptyCloneCanonicalization(t *testing.T) {
	// Empty records normalize to nil in State.Clone. Local scope normalization
	// must match; the ledger's persisted JSON representation is untouched.
	policy := &ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: bytes.Repeat([]byte{1}, 32), EnableAt: 1, Records: []ynxauth.Record{}}
	cache := NewPQCertificateCache()
	clone := cache.ClonePolicy(policy)
	if stats := cache.Stats(); stats.ScopeComputations != 0 || stats.Certificates.Entries != 0 || stats.RetainedPolicyScopes != 2 {
		t.Fatalf("trusted clone eagerly computed verification work: %+v", stats)
	}
	_, original, err := cache.VerifierCache(clone)
	pqMust(t, err)
	_, fromSource, err := cache.VerifierCache(policy)
	pqMust(t, err)
	_, independent, err := NewPQCertificateCache().VerifierCache(clone)
	pqMust(t, err)
	if !bytes.Equal(original, fromSource) || !bytes.Equal(original, independent) || cache.Stats().ScopeComputations != 1 {
		t.Fatal("trusted clone root differs from independently computed normalized root")
	}
	clone.EnableAt++
	_, changed, err := cache.VerifierCache(clone)
	pqMust(t, err)
	if bytes.Equal(original, changed) {
		t.Fatal("mutable clone retained old source root")
	}
	_, stillOriginal, err := cache.VerifierCache(policy)
	pqMust(t, err)
	if !bytes.Equal(original, stillOriginal) {
		t.Fatal("candidate mutation changed committed source root")
	}
}

func TestPQCertificateCacheOrdinaryMemberUsesNoScope(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	wire := f.member(t, 2, 1)
	_, _, err := f.d.SubmitPQTransfer(wire)
	pqMust(t, err)
	if stats := f.d.pqCertificateCache.Stats(); stats.ScopeComputations != 0 || stats.Certificates.Entries != 0 || stats.Certificates.Misses != 0 {
		t.Fatalf("ordinary member paid shared-cache cost: %+v", stats)
	}
	before := moduleBusinessState(t, f.d)
	_, replayed, err := f.d.SubmitPQTransfer(wire)
	pqMust(t, err)
	if !replayed {
		t.Fatal("ordinary replay no longer reconciles original transaction")
	}
	assertModuleState(t, f.d, before)
	// The source's N=1 Whole has no repeated proposal validation stages either.
	out, err := f.d.SubmitPQBatch(f.whole(t, f.batchTransfer(3, 1)))
	pqMust(t, err)
	if out.Results[0].Outcome != "admitted" || f.d.pqCertificateCache.Stats().ScopeComputations != 0 || f.d.pqCertificateCache.Stats().Certificates.Entries != 0 {
		t.Fatal("source N=1 Whole unexpectedly used shared cache")
	}
}

func TestPQCertificateCacheRotationAndHeightRefresh(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	first, err := f.batchTransfer(2, 1).SigningBytes()
	pqMust(t, err)
	later, err := f.batchTransfer(4, 1).SigningBytes()
	pqMust(t, err)
	members := pqCacheMembers(t, f, [][]byte{first, later})
	_, _, err = f.d.SubmitPQTransfer(members[0])
	pqMust(t, err)
	next, public, err := ynxbatch.KeyGen()
	pqMust(t, err)
	defer next.Destroy()
	_, _, err = f.d.SubmitAccountMigration(pqRevocationRotation(t, f, next, public, 3, 3))
	pqMust(t, err)
	if f.d.pqCertificateCache.Stats().Certificates.Entries != 0 {
		t.Fatal("migration failed to invalidate prior policy scope")
	}
	// The old key is still legitimately active at H=2. Warm its certificate
	// under the new immutable policy root without executing the later member.
	m, err := ynxbatch.DecodeMember(members[1])
	pqMust(t, err)
	pqMust(t, f.d.pqCertificateCache.VerifyDecodedMember(f.d.accountPolicy, f.owner, ynxauth.TransactionPurpose, later, m, 2))
	if f.d.pqCertificateCache.Stats().ScopeComputations != 2 {
		t.Fatal("migration did not compute its distinct root once")
	}
	f.d.ProduceBlock()
	before := moduleBusinessState(t, f.d)
	if _, _, err = f.d.SubmitPQTransfer(members[1]); err == nil {
		t.Fatal("warm old key bypassed scheduled activation at next height")
	}
	assertModuleState(t, f.d, before)
	newOwner := *f
	newOwner.key, newOwner.public = next, public
	_, _, err = f.d.SubmitPQTransfer(newOwner.batchMember(t, 4, 1, 2))
	pqMust(t, err)
	if f.d.pqCertificateCache.Stats().ScopeComputations != 2 {
		t.Fatal("height refresh incorrectly required a new policy root")
	}
	_, err = NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	pqMust(t, err)
}

func TestPQCertificateCachePreRenameRollbackAndUnknownRemainBusinessState(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		t.Run(fmt.Sprint(afterRename), func(t *testing.T) {
			f := newPQLedger(t)
			f.activate(t)
			wire := f.batchMember(t, 2, 1, 2)
			before := moduleBusinessState(t, f.d)
			target := f.d.snapshotPath() + ".tmp"
			if afterRename {
				target = f.d.snapshotIntegrityMarkerPath() + ".tmp"
			}
			unblock := blockSnapshotWrite(t, target)
			tx, replayed, err := f.d.SubmitPQTransfer(wire)
			if err == nil || replayed || f.d.pqCertificateCache.Stats().Certificates.Entries != 1 {
				t.Fatal("durability failure lost distinction from cryptographic success")
			}
			if afterRename {
				if !errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash != pqBatchHash(wire) {
					t.Fatal("cache lost UNKNOWN original identity")
				}
			} else {
				if errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash != "" {
					t.Fatal("pre-rename failure exposed a transaction")
				}
				assertModuleState(t, f.d, before)
			}
			unblock()
			accepted, replayed, err := f.d.SubmitPQTransfer(wire)
			pqMust(t, err)
			if accepted.Hash != pqBatchHash(wire) || replayed != afterRename {
				t.Fatal("cache changed original retry semantics")
			}
			account, _ := f.d.Account(f.owner)
			if account.Nonce != 2 || account.Balance != 997 {
				t.Fatal("cache reused business authorization instead of signature success")
			}
			if !afterRename && f.d.pqCertificateCache.Stats().Certificates.Hits != 1 {
				t.Fatal("rollback retry did not reuse valid signature")
			}
			// Apply a real tombstone after warming the same transaction-purpose key.
			_, _, err = f.d.SubmitAccountRevocation(pqRevocationWire(t, f, 3, 2, 1))
			pqMust(t, err)
			f.d.ProduceBlock()
			stateBefore := moduleBusinessState(t, f.d)
			if _, _, err = f.d.SubmitPQTransfer(f.member(t, 4, 1)); err == nil {
				t.Fatal("cache bypassed terminal revocation")
			}
			assertModuleState(t, f.d, stateBefore)
		})
	}
}

// Frozen uncached consumer baseline from policy.go Git blob
// 11df5a27179a3020d293d3686e4b15af23b26e5b, before the parsed-member path.
// Keep the duplicate decode here so the measured old path is not silently
// replaced by the new implementation. This helper is test-only.
func pqVerifyMemberBeforeConsumer(policy *ynxauth.State, owner string, message, wire []byte, height uint64) error {
	if err := policy.Validate(policy.NetworkID); err != nil {
		return err
	}
	if (policy.Version != ynxauth.PolicyVersion && policy.Version != ynxauth.PolicyRevocationVersion) || height < policy.EnableAt {
		return ynxauth.ErrPolicy
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return err
	}
	if member.Certificate.Owner != owner || !bytes.Equal(member.Message, message) {
		return errors.New("authorization message or sender mismatch")
	}
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: policy.NetworkID, Purpose: ynxauth.TransactionPurpose, ResolveTrustedOwner: func(req ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		return policy.TrustedRegistration(req.Owner, ynxauth.TransactionPurpose, req.Height)
	}})
	if err != nil {
		return err
	}
	return v.VerifyOne(wire, height)
}

// Each measured call includes the real consumer's strict initial decode and
// trusted policy clone. Fresh N=1 never caches; N=16 compares first-member miss
// and all distinct members of one certificate. Cache invalidation is outside
// timing to make every iteration cold, including its first policy-root hash.
// This excludes business execution/persistence and is not chain TPS/finality.
func BenchmarkPQCertificateConsumer(b *testing.B) {
	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(key.Destroy)
	network := bytes.Repeat([]byte{17}, 32)
	owner := "0x" + strings.Repeat("2", 40)
	policy := &ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: network, EnableAt: 1, Records: []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: owner, PKA: public.PKA, PKB: public.PKB, Revision: 1, RegisteredAt: 1, ActiveFrom: 2, LedgerNonce: 1}}}
	for _, n := range []int{1, 16} {
		// Two independently signed bounded fixtures prevent the fresh benchmark
		// from relying on a single warmed certificate. No signing is timed.
		wires := make([][][]byte, 2)
		for set := range wires {
			messages := make([][]byte, n)
			for i := range messages {
				messages[i], err = (ynxauth.Transfer{ChainID: network, NativeChainID: 1, From: owner, To: "0x" + strings.Repeat("3", 40), Amount: uint64(set + 1), Fee: 1, Nonce: uint64(i + 2)}).SigningBytes()
				if err != nil {
					b.Fatal(err)
				}
			}
			batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{})
			if err != nil {
				b.Fatal(err)
			}
			b.Cleanup(batch.Discard)
			wires[set] = make([][]byte, n)
			for i := range messages {
				m, err := ynxbatch.Extract(batch, uint32(i))
				if err != nil {
					b.Fatal(err)
				}
				wires[set][i], err = ynxbatch.EncodeMember(m)
				if err != nil {
					b.Fatal(err)
				}
			}
		}
		counts := []int{1}
		if n > 1 {
			counts = append(counts, n)
		}
		for _, count := range counts {
			for _, modern := range []bool{false, true} {
				label := "old"
				if modern {
					label = "new"
				}
				b.Run(fmt.Sprintf("N%d/members%d/%s", n, count, label), func(b *testing.B) {
					cache := NewPQCertificateCache()
					b.ReportAllocs()
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						b.StopTimer()
						cache.Invalidate()
						b.StartTimer()
						for j := 0; j < count; j++ {
							wire := wires[i%len(wires)][j]
							member, err := ynxbatch.DecodeMember(wire)
							if err != nil {
								b.Fatal(err)
							}
							if modern {
								clone := cache.ClonePolicy(policy)
								err = cache.VerifyDecodedMember(clone, owner, ynxauth.TransactionPurpose, member.Message, member, 2)
							} else {
								clone := policy.Clone()
								err = pqVerifyMemberBeforeConsumer(&clone, owner, member.Message, wire, 2)
							}
							if err != nil {
								b.Fatal(err)
							}
						}
					}
					b.StopTimer()
					stats := cache.Stats()
					wantMiss, wantHit, wantRoot := uint64(0), uint64(0), uint64(0)
					if modern && n > 1 {
						wantMiss = uint64(b.N)
						wantHit = uint64(b.N) * uint64(count-1)
						wantRoot = uint64(b.N)
					}
					if stats.Certificates.Misses != wantMiss || stats.Certificates.Hits != wantHit || stats.ScopeComputations != wantRoot {
						b.Fatalf("unexpected consumer work: %+v", stats)
					}
					b.ReportMetric(float64(count), "members/op")
					b.ReportMetric(float64(stats.Certificates.Misses)/float64(b.N), "cache_misses/op")
					b.ReportMetric(float64(stats.Certificates.Hits)/float64(b.N), "cache_hits/op")
					b.ReportMetric(float64(stats.ScopeComputations)/float64(b.N), "policy_roots/op")
				})
			}
		}
	}
}
