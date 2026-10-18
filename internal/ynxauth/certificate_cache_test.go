package ynxauth

import (
	"crypto/sha256"
	"encoding/json"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func authCacheScope(t testing.TB, s State) []byte {
	t.Helper()
	wire, err := json.Marshal(s)
	authOK(t, err)
	digest := sha256.Sum256(wire)
	return digest[:]
}

func TestMemberCertificateCachePreservesLivePolicyAndRevocation(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	message := authTransaction(t, f)
	_, member := authProof(t, f.first, state.NetworkID, f.owner, TransactionPurpose, [][]byte{message})
	cache, err := ynxbatch.NewCertificateCache(2)
	authOK(t, err)
	scope := authCacheScope(t, state)
	// The original API remains the uncached reference with the same full proof.
	authOK(t, state.VerifyMember(f.owner, TransactionPurpose, message, member, 20))
	for i := 0; i < 2; i++ {
		authOK(t, state.VerifyMemberWithCache(f.owner, TransactionPurpose, message, member, 20, cache, scope))
	}
	if stats := cache.Stats(); stats.Entries != 1 || stats.Misses != 1 || stats.Hits != 1 {
		t.Fatalf("short-lived member verifiers did not share exact success: %+v", stats)
	}
	for _, tc := range []struct {
		name, owner, purpose string
		message, wire        []byte
		height               uint64
	}{
		{"before-active", f.owner, TransactionPurpose, message, member, 19},
		{"wrong-purpose", f.owner, MigrationPurpose, message, member, 20},
		{"wrong-owner", "0x0000000000000000000000000000000000000001", TransactionPurpose, message, member, 20},
		{"different-message", f.owner, TransactionPurpose, append([]byte("changed"), message...), member, 20},
		{"trailing-wire", f.owner, TransactionPurpose, message, append(append([]byte(nil), member...), 0), 20},
	} {
		t.Run(tc.name, func(t *testing.T) {
			old := state.VerifyMember(tc.owner, tc.purpose, tc.message, tc.wire, tc.height)
			got := state.VerifyMemberWithCache(tc.owner, tc.purpose, tc.message, tc.wire, tc.height, cache, scope)
			if old == nil || got == nil || old.Error() != got.Error() {
				t.Fatalf("old=%v cached=%v", old, got)
			}
		})
	}
	revoke := signRevocation(t, revokeIntent(f, 1, 1, 42, 20), f.first)
	revoked, err := state.AdmitRevocation(revoke, 20, 41)
	authOK(t, err)
	// Even an accidentally reused old scope cannot freeze active authorization.
	authReject(t, revoked.VerifyMemberWithCache(f.owner, TransactionPurpose, message, member, 21, cache, scope))
	revokedScope := authCacheScope(t, revoked)
	authOK(t, revoked.VerifyMemberWithCache(f.owner, TransactionPurpose, message, member, 20, cache, revokedScope))
	authOK(t, revoked.VerifyMemberWithCache(f.owner, TransactionPurpose, message, member, 20, cache, revokedScope))
	authReject(t, revoked.VerifyMemberWithCache(f.owner, TransactionPurpose, message, member, 21, cache, revokedScope))
	if stats := cache.Stats(); stats.Entries != 2 || stats.Misses != 2 || stats.Hits != 2 {
		t.Fatalf("changed root/history did not get independent success: %+v", stats)
	}
}

func TestDecodedMemberCertificateCacheMatchesWireAndRejectsTampering(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	message := authTransaction(t, f)
	_, wire := authProof(t, f.first, state.NetworkID, f.owner, TransactionPurpose, [][]byte{message, []byte("second complete message")})
	cache, err := ynxbatch.NewCertificateCache(2)
	authOK(t, err)
	scope := authCacheScope(t, state)
	member, err := ynxbatch.DecodeMember(wire)
	authOK(t, err)
	authOK(t, state.VerifyMember(f.owner, TransactionPurpose, message, wire, 20))
	authOK(t, state.VerifyDecodedMemberWithCache(f.owner, TransactionPurpose, message, member, 20, cache, scope))
	authOK(t, state.VerifyDecodedMemberWithCache(f.owner, TransactionPurpose, message, member, 20, cache, scope))
	if stats := cache.Stats(); stats.Misses != 1 || stats.Hits != 1 {
		t.Fatalf("parsed member lost certificate reuse: %+v", stats)
	}
	for _, tc := range []struct {
		name   string
		mutate func(*ynxbatch.Member)
	}{
		{"signature-a", func(m *ynxbatch.Member) { m.Certificate.SigmaA[0] ^= 1 }},
		{"signature-b", func(m *ynxbatch.Member) { m.Certificate.SigmaB[0] ^= 1 }},
		{"key-a", func(m *ynxbatch.Member) { m.Certificate.PKA[0] ^= 1 }},
		{"key-b", func(m *ynxbatch.Member) { m.Certificate.PKB[0] ^= 1 }},
		{"root-a", func(m *ynxbatch.Member) { m.Certificate.RootA[0] ^= 1 }},
		{"root-b", func(m *ynxbatch.Member) { m.Certificate.RootB[0] ^= 1 }},
		{"message", func(m *ynxbatch.Member) { m.Message[0] ^= 1 }},
		{"path-a", func(m *ynxbatch.Member) { m.PathA[0][0] ^= 1 }},
		{"path-b", func(m *ynxbatch.Member) { m.PathB[0][0] ^= 1 }},
		{"index", func(m *ynxbatch.Member) { m.Index = m.Certificate.N }},
		{"oversize-message", func(m *ynxbatch.Member) { m.Message = make([]byte, ynxbatch.MaxMessageBytes+1) }},
		{"extra-path", func(m *ynxbatch.Member) { m.PathB = append(m.PathB, make([]byte, 64)) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bad, err := ynxbatch.DecodeMember(wire)
			authOK(t, err)
			tc.mutate(&bad)
			authReject(t, state.VerifyDecodedMemberWithCache(f.owner, TransactionPurpose, message, bad, 20, cache, scope))
			encoded, err := ynxbatch.EncodeMember(bad)
			if err == nil {
				authReject(t, state.VerifyMember(f.owner, TransactionPurpose, message, encoded, 20))
			}
		})
	}
	authReject(t, state.VerifyDecodedMemberWithCache(f.owner, TransactionPurpose, message, member, 19, cache, scope))
	authReject(t, state.VerifyDecodedMemberWithCache(f.owner, MigrationPurpose, message, member, 20, cache, scope))
	revoked, err := state.AdmitRevocation(signRevocation(t, revokeIntent(f, 1, 1, 42, 20), f.first), 20, 41)
	authOK(t, err)
	authReject(t, revoked.VerifyDecodedMemberWithCache(f.owner, TransactionPurpose, message, member, 21, cache, scope))
}
