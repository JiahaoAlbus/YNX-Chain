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
