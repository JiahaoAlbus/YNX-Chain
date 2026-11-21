package chain

import (
	"bytes"
	"errors"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func TestHistoryPolicyCallScopeMutationAndLifetime(t *testing.T) {
	if !historyPolicyCloneSchema() {
		t.Fatal("schema guard unexpectedly declined current policy")
	}
	policy := &ynxauth.State{Version: "v", NetworkID: bytes.Repeat([]byte{1}, 32), EnableAt: 1, Records: []ynxauth.Record{{AlgorithmVersion: "a", Owner: "owner", PKA: bytes.Repeat([]byte{1}, ynxbatch.PublicKeyASize), PKB: bytes.Repeat([]byte{3}, ynxbatch.PublicKeyBSize), Revision: 1}}}
	parent := NewPQHistoryCertificateCache()
	oracle := NewPQHistoryCertificateCache()
	var escaped *PQCertificateCache
	check := func(c *PQCertificateCache) []byte {
		t.Helper()
		_, got, err := c.VerifierCache(policy)
		if err != nil {
			t.Fatal(err)
		}
		_, want, err := oracle.VerifierCache(policy)
		if err != nil || !bytes.Equal(got, want) {
			t.Fatalf("scope differs from full original: %v", err)
		}
		return got
	}
	if err := parent.WithHistoryPolicyCall(policy, func(local *PQCertificateCache) error {
		if local.callTried || local.callSnapshot != nil {
			t.Fatal("policy cloned before first verification")
		}
		escaped = local
		first := check(local)
		if !bytes.Equal(first, check(local)) || local.Stats().ScopeComputations != 1 {
			t.Fatal("identical state failed to reuse within call")
		}
		policy.Records[0].PKA[0] ^= 1
		changed := check(local)
		if bytes.Equal(first, changed) {
			t.Fatal("same-length key mutation retained scope")
		}
		policy.Records[0].PKA[0] ^= 1
		if !bytes.Equal(first, check(local)) {
			t.Fatal("restored policy adopted mutated scope")
		}
		policy.Revocations = []ynxauth.RevocationRecord{{Owner: "owner", RevokedFrom: 3}}
		revoked := check(local)
		if bytes.Equal(first, revoked) {
			t.Fatal("revocation retained original scope")
		}
		policy.Revocations[0].RevokedFrom++
		if bytes.Equal(revoked, check(local)) {
			t.Fatal("same-length revocation rewrite retained scope")
		}
		policy.Revocations = nil
		policy.Records[0].ActiveFrom++
		if bytes.Equal(first, check(local)) {
			t.Fatal("same-length rotation rewrite retained scope")
		}
		policy.Records[0].ActiveFrom--
		if !bytes.Equal(first, check(local)) {
			t.Fatal("restored schedule changed scope")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	before := escaped.Stats().ScopeComputations
	check(escaped)
	check(escaped)
	if escaped.Stats().ScopeComputations != before+2 {
		t.Fatal("escaped call reused historical scope")
	}
	if _, _, err := escaped.VerifierCache(nil); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatal("nil policy did not fail closed", err)
	}
}

func TestHistoryPolicyCallOversizeFallsBackWithoutClone(t *testing.T) {
	policy := &ynxauth.State{Records: []ynxauth.Record{{PKA: make([]byte, 1<<20)}}}
	c := NewPQHistoryCertificateCache()
	if err := c.WithHistoryPolicyCall(policy, func(local *PQCertificateCache) error {
		if local.callTried || local.callSnapshot != nil {
			t.Fatal("eager clone")
		}
		_, first, err := local.VerifierCache(policy)
		if err != nil {
			return err
		}
		if local.callSnapshot != nil {
			t.Fatal("oversized invalid policy cloned")
		}
		_, second, err := local.VerifierCache(policy)
		if err != nil {
			return err
		}
		if !bytes.Equal(first, second) || local.Stats().ScopeComputations != 2 {
			t.Fatal("full hash fallback changed")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestHistoryPolicyEqualMatchesDeepEqual(t *testing.T) {
	base := &ynxauth.State{Version: "v", NetworkID: []byte{1}, EnableAt: 3, Records: []ynxauth.Record{{AlgorithmVersion: "a", Owner: "o", PKA: []byte{2}, PKB: []byte{3}, Revision: 1, RegisteredAt: 2, ActiveFrom: 4, LedgerNonce: 5}}, Revocations: []ynxauth.RevocationRecord{{Owner: "o", AuthorizingRevision: 1, ThroughRevision: 1, RegisteredAt: 4, RevokedFrom: 5, LedgerNonce: 6}}}
	for name, mutate := range map[string]func(*ynxauth.State){
		"same": func(*ynxauth.State) {}, "version": func(s *ynxauth.State) { s.Version += "x" }, "network": func(s *ynxauth.State) { s.NetworkID[0]++ }, "enable": func(s *ynxauth.State) { s.EnableAt++ },
		"record-algorithm": func(s *ynxauth.State) { s.Records[0].AlgorithmVersion += "x" }, "record-owner": func(s *ynxauth.State) { s.Records[0].Owner += "x" }, "record-key-a": func(s *ynxauth.State) { s.Records[0].PKA[0]++ }, "record-key-b": func(s *ynxauth.State) { s.Records[0].PKB[0]++ }, "revision": func(s *ynxauth.State) { s.Records[0].Revision++ }, "registered": func(s *ynxauth.State) { s.Records[0].RegisteredAt++ }, "active": func(s *ynxauth.State) { s.Records[0].ActiveFrom++ }, "nonce": func(s *ynxauth.State) { s.Records[0].LedgerNonce++ },
		"revoke-owner": func(s *ynxauth.State) { s.Revocations[0].Owner += "x" }, "revoke-revision": func(s *ynxauth.State) { s.Revocations[0].AuthorizingRevision++ }, "revoke-through": func(s *ynxauth.State) { s.Revocations[0].ThroughRevision++ }, "revoke-registered": func(s *ynxauth.State) { s.Revocations[0].RegisteredAt++ }, "revoke-height": func(s *ynxauth.State) { s.Revocations[0].RevokedFrom++ }, "revoke-nonce": func(s *ynxauth.State) { s.Revocations[0].LedgerNonce++ },
	} {
		t.Run(name, func(t *testing.T) {
			copy := base.Clone()
			mutate(&copy)
			if got, want := equalHistoryPolicyForCall(base, &copy), reflect.DeepEqual(base, &copy); got != want {
				t.Fatalf("got %v want %v", got, want)
			}
		})
	}
	for _, pair := range [][2]*ynxauth.State{{nil, nil}, {base, nil}, {{}, {NetworkID: []byte{}}}, {{}, {Records: []ynxauth.Record{}}}, {{}, {Revocations: []ynxauth.RevocationRecord{}}}, {{Records: []ynxauth.Record{{}}}, {Records: []ynxauth.Record{{PKA: []byte{}}}}}} {
		if got, want := equalHistoryPolicyForCall(pair[0], pair[1]), reflect.DeepEqual(pair[0], pair[1]); got != want {
			t.Fatalf("nil/empty got %v want %v", got, want)
		}
	}
}
