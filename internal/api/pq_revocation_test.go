package api

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func apiPQRevocation(t *testing.T, f *apiPQFixture, height, nonce uint64) []byte {
	t.Helper()
	intent := ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: f.public.PKA, PKB: f.public.PKB,
		AuthorizingRevision: 1, ThroughRevision: 1, LedgerNonce: nonce, ExecuteAt: height, RevokeAt: height + 1}
	message, err := intent.SigningBytes()
	apiPQMust(t, err)
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.RevocationPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	apiPQMust(t, err)
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, 0)
	apiPQMust(t, err)
	proof, err := ynxbatch.EncodeMember(member)
	apiPQMust(t, err)
	wire, err := (ynxauth.Revocation{Intent: intent, CurrentPQProof: proof}).Encode()
	apiPQMust(t, err)
	return wire
}

func TestPQHTTPRevocationKeepsNextAndCommittedAuthoritySeparate(t *testing.T) {
	f := newAPIPQFixture(t)
	base := "/accounts/" + f.owner + "/authorization"
	migrationWire := f.migration(t)
	apiPQRequest(t, f.h, http.MethodPost, base+"/migrate", "application/octet-stream", migrationWire, http.StatusOK)
	f.d.ProduceBlock()
	wire := apiPQRevocation(t, f, 2, 2)
	before := apiPQSnapshot(t, f.d)
	apiPQRequest(t, f.h, http.MethodPost, base+"/revoke", "application/json", wire, http.StatusUnsupportedMediaType)
	apiPQRequest(t, f.h, http.MethodPost, "/accounts/"+f.to+"/authorization/revoke", "application/octet-stream", wire, http.StatusBadRequest)
	apiPQRequest(t, f.h, http.MethodPost, base+"/revoke", "application/octet-stream", make([]byte, ynxauth.MaxRevocationBytes+1), http.StatusRequestEntityTooLarge)
	apiPQUnchanged(t, f.d, before)
	var receipt struct {
		Status, WireHash string
		DecimalFields    map[string]string
		Replayed         bool
	}
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, base+"/revoke", "application/octet-stream", wire, http.StatusOK), &receipt)
	digest := sha256.Sum256(wire)
	if receipt.Status != "revocation_pending" || receipt.Replayed || receipt.WireHash != "0x"+hex.EncodeToString(digest[:]) || receipt.DecimalFields["executionHeight"] != "2" || receipt.DecimalFields["revokedFrom"] != "3" || receipt.DecimalFields["nonce"] != "2" || receipt.DecimalFields["fee"] != "1" {
		t.Fatal("revocation lost exact intent or pending boundary")
	}
	read := func(handler http.Handler, next, committed string, nextEnabled, committedEnabled bool) {
		t.Helper()
		var policy struct {
			AuthorizationStatus, CommittedAuthorizationStatus, AlgorithmVersion, PolicyVersion, GlobalPolicyVersion string
			PQSigningEnabled, CommittedPQSigningEnabled                                                             bool
			Revocations                                                                                             []map[string]string
		}
		apiPQDecode(t, apiPQRequest(t, handler, http.MethodGet, base, "", nil, http.StatusOK), &policy)
		if policy.AuthorizationStatus != next || policy.CommittedAuthorizationStatus != committed || policy.PQSigningEnabled != nextEnabled || policy.CommittedPQSigningEnabled != committedEnabled || policy.AlgorithmVersion != ynxbatch.Version || policy.PolicyVersion != ynxauth.PolicyRevocationVersion || policy.GlobalPolicyVersion != ynxauth.PolicyRevocationVersion || len(policy.Revocations) != 1 || policy.Revocations[0]["registeredAt"] != "2" || policy.Revocations[0]["revokedFrom"] != "3" {
			t.Fatalf("revocation projection confused historical or next authority: %+v", policy)
		}
	}
	read(f.h, "revocation_pending", "pending_activation", true, false)
	f.d.ProduceBlock()
	read(f.h, "revoked", "revocation_pending", false, true)
	before = apiPQSnapshot(t, f.d)
	apiPQRequest(t, f.h, http.MethodPost, "/transactions/pq/broadcast", "application/octet-stream", f.member(t, 3), http.StatusUnprocessableEntity)
	apiPQUnchanged(t, f.d, before)
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, base+"/migrate", "application/octet-stream", migrationWire, http.StatusOK), &receipt)
	if receipt.Status != "revoked" || !receipt.Replayed {
		t.Fatal("original migration replay mislabeled revoked account as active")
	}
	apiPQUnchanged(t, f.d, before)
	// The other owner's projection remains valid v1 and exposes no foreign keys
	// or tombstones, while the global ledger version remains explicit.
	var other struct {
		PolicyVersion, GlobalPolicyVersion, AuthorizationStatus string
		Records, Revocations                                    []any
	}
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodGet, "/accounts/"+f.to+"/authorization", "", nil, http.StatusOK), &other)
	if other.PolicyVersion != ynxauth.PolicyVersion || other.GlobalPolicyVersion != ynxauth.PolicyRevocationVersion || other.AuthorizationStatus != "legacy" || len(other.Records) != 0 || len(other.Revocations) != 0 {
		t.Fatal("one owner's revocation contaminated another owner's policy projection")
	}
	f.d.ProduceBlock()
	read(f.h, "revoked", "revoked", false, false)
	restarted, err := chain.NewPersistentDevnet(f.d.Config(), f.dir)
	apiPQMust(t, err)
	read(NewServer(restarted), "revoked", "revoked", false, false)
}

func TestPQHTTPRevocationUnknownRetainsOriginalForReadOnlyReconciliation(t *testing.T) {
	f := newAPIPQFixture(t)
	base := "/accounts/" + f.owner + "/authorization"
	apiPQRequest(t, f.h, http.MethodPost, base+"/migrate", "application/octet-stream", f.migration(t), http.StatusOK)
	f.d.ProduceBlock()
	wire := apiPQRevocation(t, f, 2, 2)
	marker := filepath.Join(f.dir, "devnet-state.integrity-version.tmp")
	apiPQMust(t, os.Mkdir(marker, 0700))
	apiPQMust(t, os.WriteFile(filepath.Join(marker, "blocked"), []byte("fixture"), 0600))
	var unknown struct {
		Status, TransactionHash, WireHash string
		DecimalFields                     map[string]string
	}
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, base+"/revoke", "application/octet-stream", wire, http.StatusServiceUnavailable), &unknown)
	if unknown.Status != "transaction_durability_uncertain" || unknown.TransactionHash == "" || unknown.TransactionHash != unknown.WireHash || unknown.DecimalFields["throughRevision"] != "1" {
		t.Fatal("revocation UNKNOWN lost original identity")
	}
	apiPQMust(t, os.RemoveAll(marker))
	before := apiPQSnapshot(t, f.d)
	var observed transactionReadDTO
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodGet, "/txs/"+unknown.WireHash, "", nil, http.StatusOK), &observed)
	if observed.YNXDurability["status"] != "uncertain" || observed.WireHash != unknown.WireHash || observed.DecimalFields["executionHeight"] != "2" || observed.DecimalFields["revokedFrom"] != "3" || observed.DecimalFields["authorizingRevision"] != "1" {
		t.Fatal("read acquired durability or lost signed revocation fields")
	}
	apiPQUnchanged(t, f.d, before)
	var recovered struct{ Replayed bool }
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, base+"/revoke", "application/octet-stream", wire, http.StatusOK), &recovered)
	if !recovered.Replayed {
		t.Fatal("identical revocation did not reconcile original mutation")
	}
	apiPQUnchanged(t, f.d, before)
	account, _ := f.d.Account(f.owner)
	if account.Nonce != 2 || account.Balance != 998 {
		t.Fatal("revocation recovery repeated fee or nonce")
	}
}
