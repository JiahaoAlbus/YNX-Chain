package consensus

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type sponsorSourceFixture struct {
	d                   *chain.Devnet
	m                   chain.ConsensusMigrationState
	ownerKey, userKey   *secp256k1.PrivateKey
	create              ResourcePoolCreatePayload
	sponsor             ResourceSponsorshipPayload
	pool                chain.ResourcePool
	value               chain.ResourceSponsorship
	createTx, sponsorTx chain.Transaction
}

func newSponsorSourceFixture(t *testing.T) sponsorSourceFixture {
	t.Helper()
	f := sponsorSourceFixture{ownerKey: deterministicPrivateKey(151), userKey: deterministicPrivateKey(152)}
	owner, user := mustNativeAddress(t, f.ownerKey), mustNativeAddress(t, f.userKey)
	var err error
	f.d, err = chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, address := range []string{owner, user} {
		if _, err := f.d.Faucet(address, 100); err != nil {
			t.Fatal(err)
		}
	}
	f.d.ProduceBlock()
	f.create = ResourcePoolCreatePayload{PoolType: "merchant", Name: "Migrated checkout", Public: false, AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: chain.ResourceUnits{Bandwidth: 5}, CumulativeAllowance: chain.ResourceUnits{Bandwidth: 12}, ExpiresAt: time.Now().UTC().Add(24 * time.Hour), IdempotencyKey: "source-create"}
	var create chain.ResourcePoolCreateInput
	if err = json.Unmarshal(mustJSON(t, f.create), &create); err != nil {
		t.Fatal(err)
	}
	create.Authorization, err = chain.SignResourceAuthorization(f.ownerKey, 6423, chain.ResourcePoolCreateAction, create, 1)
	if err != nil {
		t.Fatal(err)
	}
	f.pool, f.createTx, err = f.d.CreateResourcePool(create)
	if err != nil {
		t.Fatal(err)
	}
	f.sponsor = ResourceSponsorshipPayload{PoolID: f.pool.ID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 2, ActionReference: "source:invoice-1", IdempotencyKey: "source-sponsor"}
	var sponsor chain.ResourceSponsorshipInput
	if err = json.Unmarshal(mustJSON(t, f.sponsor), &sponsor); err != nil {
		t.Fatal(err)
	}
	sponsor.Authorization, err = chain.SignResourceAuthorization(f.userKey, 6423, chain.ResourceSponsorAction, sponsor, 1)
	if err != nil {
		t.Fatal(err)
	}
	f.value, f.sponsorTx, err = f.d.SponsorResource(sponsor)
	if err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	f.m, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f.pool = f.m.Runtime.Pools[f.pool.ID]
	return f
}

func TestMigratedSponsorExecutesReplaysAndRestarts(t *testing.T) {
	f := newSponsorSourceFixture(t)
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "state.json")
	a, err := NewPersistentApplication(f.m, path)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.committed.Validate(f.m); err != nil {
		t.Fatal(err)
	}
	if len(a.committed.ResourcePools) != 1 || a.committed.ResourcePools[0].SourceAnchor != f.m.StateHash || a.committed.ResourcePools[0].LastSigner != "" || !reflect.DeepEqual(a.committed.ResourcePools[0].ResourcePool, f.pool) {
		t.Fatal("source pool was erased, relabeled or given fabricated authority")
	}
	owner, user := mustNativeAddress(t, f.ownerKey), mustNativeAddress(t, f.userKey)
	beforeOwner, beforeUser := queryConsensusAccount(t, a, owner), queryConsensusAccount(t, a, user)
	blockTime := f.pool.UpdatedAt.Add(time.Second)
	fund := ResourcePoolFundPayload{PoolID: f.pool.ID, Additional: chain.ResourceUnits{Bandwidth: 5}, ExpectedPolicyHash: f.pool.PolicyHash, IdempotencyKey: "after-import-fund"}
	next := f.sponsor
	next.Amount, next.ActionReference, next.IdempotencyKey = 3, "after-import:invoice-2", "after-import-sponsor"
	fundRaw := mustResourceAction(t, f.ownerKey, ActionResourcePoolFund, fund, 2)
	sponsorRaw := mustResourceAction(t, f.userKey, ActionResourceSponsor, next, 2)
	commitSponsorBlock(t, a, int64(f.m.Height)+1, blockTime, fundRaw, sponsorRaw)
	pool := a.committed.ResourcePools[0]
	if pool.ID != f.pool.ID || pool.Consumed.Bandwidth != 5 || pool.CumulativeAllowance.Bandwidth != 17 || pool.SourceAnchor != f.m.StateHash {
		t.Fatalf("imported pool did not execute: %+v", pool)
	}
	gotOwner, gotUser := queryConsensusAccount(t, a, owner), queryConsensusAccount(t, a, user)
	if gotOwner.Nonce != beforeOwner.Nonce+1 || gotUser.Nonce != beforeUser.Nonce+1 || gotOwner.ResourceUsage.BandwidthUsed != beforeOwner.ResourceUsage.BandwidthUsed+5 || gotUser.ResourceUsage != beforeUser.ResourceUsage || gotOwner.Balance != beforeOwner.Balance || gotUser.Balance != beforeUser.Balance || len(a.committed.FeeEvents) != 0 {
		t.Fatal("imported sponsorship nonce/usage/zero-fee accounting changed")
	}
	tail, offset := sourceSponsorAuditTail(a.committed.LegacyResourceSponsor)
	if len(a.committed.ResourceSponsorAudit) != 2 || a.committed.ResourceSponsorAudit[0].PreviousHash != tail || a.committed.ResourceSponsorAudit[0].Sequence != offset+1 || a.committed.ResourceSponsorAudit[1].PreviousHash != a.committed.ResourceSponsorAudit[0].AuditHash {
		t.Fatal("new audit did not continue the untouched source segment")
	}
	if !reflect.DeepEqual(a.committed.LegacyResourceSponsor.Audit, f.m.Runtime.SponsorLog) {
		t.Fatal("source audit was rewritten")
	}
	var analytics chain.ResourceAnalytics
	queryJSON(t, a, "/resource/analytics", &analytics)
	if analytics.SponsorshipCount != 2 || analytics.SponsoredResources.Bandwidth != 5 {
		t.Fatal("source sponsor analytics disappeared")
	}
	var sourceView sourceSponsorshipView
	queryJSON(t, a, "/resource/sponsorships/"+f.value.ID, &sourceView)
	if sourceView.SourceAnchor != f.m.StateHash || !reflect.DeepEqual(sourceView.ResourceSponsorship, f.value) {
		t.Fatal("live source sponsorship query changed original record")
	}

	// Replay uses the old nonce and old pool snapshot even after the live pool
	// changed. Both CheckTx and FinalizeBlock must leave all charged state intact.
	replayCreate := mustResourceAction(t, f.ownerKey, ActionResourcePoolCreate, f.create, 1)
	replaySponsor := mustResourceAction(t, f.userKey, ActionResourceSponsor, f.sponsor, 1)
	before := mustJSON(t, a.committed)
	for _, raw := range [][]byte{replayCreate, replaySponsor} {
		check, err := a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: raw})
		if err != nil || check.Code != 0 {
			t.Fatalf("source replay rejected: %+v %v", check, err)
		}
		var result SourceSponsorReplay
		if err = json.Unmarshal(check.Data, &result); err != nil {
			t.Fatal(err)
		}
		if result.SourceAnchor != f.m.StateHash || result.Record.Signer == "" || result.Transaction.Hash != result.Record.TransactionHash {
			t.Fatal("source replay omitted original authority/result")
		}
		if result.Pool != nil && (result.Pool.Consumed.Bandwidth != 0 || result.Pool.CumulativeAllowance.Bandwidth != 12) {
			t.Fatal("source create replay returned the current pool, not the old result")
		}
	}
	if string(before) != string(mustJSON(t, a.committed)) {
		t.Fatal("CheckTx source replay mutated state")
	}
	beforeHash := a.committed.AppHash
	commitSponsorBlock(t, a, int64(f.m.Height)+2, blockTime.Add(time.Second), replayCreate, replaySponsor, sponsorRaw)
	if a.committed.AppHash != beforeHash || !reflect.DeepEqual(gotOwner, queryConsensusAccount(t, a, owner)) || !reflect.DeepEqual(gotUser, queryConsensusAccount(t, a, user)) || len(a.committed.ResourceSponsorAudit) != 2 {
		t.Fatal("idempotent replay charged nonce, allowance, fee or audit again")
	}
	conflict := f.create
	conflict.Name = "changed"
	assertResourceSponsorRejected(t, a, mustResourceAction(t, f.ownerKey, ActionResourcePoolCreate, conflict, 3), "changed source request")
	duplicate := next
	duplicate.IdempotencyKey = "new-key-old-reference"
	duplicate.ActionReference = f.sponsor.ActionReference
	assertResourceSponsorRejected(t, a, mustResourceAction(t, f.userKey, ActionResourceSponsor, duplicate, 3), "source action reference reuse")

	restarted, err := NewPersistentApplication(f.m, path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a.committed, restarted.committed) {
		before, after := reflect.ValueOf(a.committed), reflect.ValueOf(restarted.committed)
		for i := 0; i < before.NumField(); i++ {
			if !before.Field(i).CanInterface() || !after.Field(i).CanInterface() {
				continue // Diagnostic logging only; the full DeepEqual assertion above still includes private fields.
			}
			if !reflect.DeepEqual(before.Field(i).Interface(), after.Field(i).Interface()) {
				t.Logf("restart difference in %s: before=%#v after=%#v", before.Type().Field(i).Name, before.Field(i).Interface(), after.Field(i).Interface())
			}
		}
		t.Fatal("restart lost source sponsor or live state")
	}
	check, err := restarted.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: replaySponsor})
	if err != nil || check.Code != 0 {
		t.Fatal("restart lost source idempotency replay")
	}
	bad := restarted.committed
	bad.LegacyResourceSponsor = nil
	if bad.Validate(f.m) == nil {
		t.Fatal("source sponsor omission accepted")
	}
	bad = restarted.committed
	bad.ResourcePools = cloneBFTResourcePools(bad.ResourcePools)
	bad.ResourcePools[0].SourceAnchor = strings.Repeat("a", 64)
	if bad.Validate(f.m) == nil {
		t.Fatal("invented source anchor accepted")
	}
	bad = restarted.committed
	bad.ResourceSponsorAudit = append([]BFTResourceSponsorAudit(nil), bad.ResourceSponsorAudit...)
	bad.ResourceSponsorAudit[0].PreviousHash = ""
	bad.ResourceSponsorAudit[0].AuditHash = resourceSponsorAuditHash(bad.ResourceSponsorAudit[0])
	if bad.Validate(f.m) == nil {
		t.Fatal("source audit chain detach accepted")
	}

	revoke := ResourcePoolStatusPayload{PoolID: pool.ID, Status: "revoked", ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "after-import-revoke"}
	commitSponsorBlock(t, restarted, int64(f.m.Height)+3, blockTime.Add(2*time.Second), mustResourceAction(t, f.ownerKey, ActionResourcePoolStatus, revoke, 3))
	if queryConsensusAccount(t, restarted, owner).ResourceUsage.BandwidthUsed != beforeOwner.ResourceUsage.BandwidthUsed-7 {
		t.Fatal("revoke did not retain exactly the source and new consumed resources")
	}
}

func TestMigratedSponsorActivePQOwnerRejectsClassicPaths(t *testing.T) {
	f := newSponsorSourceFixture(t)
	if err := f.d.EnableAccountPQ(f.m.Height + 1); err != nil {
		t.Fatal(err)
	}
	var err error
	f.m, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	a, err := NewApplication(f.m)
	if err != nil {
		t.Fatal(err)
	}
	key, pub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	network, err := hex.DecodeString(f.m.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	owner := mustNativeAddress(t, f.ownerKey)
	intent := ynxauth.RegistrationIntent{ChainID: network, Owner: owner, PKA: pub.PKA, PKB: pub.PKB, PriorRevision: 0, NewRevision: 1, LedgerNonce: 2, ActivateAt: f.m.Height + 2}
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	proof, _ := consensusPQProof(t, key, network, owner, ynxauth.MigrationPurpose, message)
	digest := sha256.Sum256(message)
	registration := ynxauth.Migration{Intent: intent, ClassicPublicKey: f.ownerKey.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(f.ownerKey, digest[:]).Serialize(), NewKeyProof: proof}
	wire, err := registration.Encode()
	if err != nil {
		t.Fatal(err)
	}
	payload, err := EncodePQTransaction(PQMigrationType, wire)
	if err != nil {
		t.Fatal(err)
	}
	commitSponsorBlock(t, a, int64(f.m.Height)+1, f.pool.UpdatedAt.Add(time.Second), payload)
	fund := ResourcePoolFundPayload{PoolID: f.pool.ID, Additional: chain.ResourceUnits{Bandwidth: 1}, ExpectedPolicyHash: f.pool.PolicyHash, IdempotencyKey: "pq-owner-fund"}
	sponsor := f.sponsor
	sponsor.ActionReference, sponsor.IdempotencyKey = "pq-owner:use", "pq-owner-use"
	for _, raw := range [][]byte{mustResourceAction(t, f.ownerKey, ActionResourcePoolFund, fund, 3), mustResourceAction(t, f.ownerKey, ActionResourcePoolCreate, f.create, 1), mustResourceAction(t, f.userKey, ActionResourceSponsor, sponsor, 2)} {
		result, err := a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: raw})
		if err != nil || result.Code == 0 || !strings.Contains(result.Log, "post-quantum") {
			t.Fatalf("active PQ owner classic path did not fail closed: %+v %v", result, err)
		}
	}
}
