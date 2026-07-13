package chain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestResourceSponsorPoolLifecycleAuthorizationAndAccounting(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	ownerKey, userKey := resourceTestKey(1), resourceTestKey(2)
	owner, user := resourceTestAddress(t, ownerKey), resourceTestAddress(t, userKey)
	_, _ = d.Faucet(owner, 100)
	_, _ = d.Faucet(user, 100)
	ownerBefore, _ := d.Account(owner)
	userBefore, _ := d.Account(user)

	create := resourcePoolCreateFixture(user, "merchant", "merchant-pool", time.Now().UTC().Add(time.Hour), "pool-create-001")
	create.Authorization = mustResourceAuthorization(t, ownerKey, d.cfg.ChainID, ResourcePoolCreateAction, create, 1)
	pool, createTx, err := d.CreateResourcePool(create)
	if err != nil {
		t.Fatal(err)
	}
	if pool.Owner != owner || pool.Status != "active" || createTx.Sponsor != owner || createTx.SponsorPoolID != pool.ID || createTx.Fee != 0 || createTx.Amount != 0 {
		t.Fatalf("unexpected created pool or transaction: %+v %+v", pool, createTx)
	}
	ownerAfterCreate, _ := d.Account(owner)
	if ownerAfterCreate.Balance != ownerBefore.Balance || ownerAfterCreate.ResourceUsage.BandwidthUsed != 30 || ownerAfterCreate.ResourceUsage.ComputeUsed != 6 || ownerAfterCreate.Nonce != 1 {
		t.Fatalf("pool reservation moved balance or mis-accounted resources: before=%+v after=%+v", ownerBefore, ownerAfterCreate)
	}
	replayedPool, replayedTx, err := d.CreateResourcePool(create)
	if err != nil || replayedPool.ID != pool.ID || replayedTx.Hash != createTx.Hash {
		t.Fatalf("exact create replay failed: %+v %+v %v", replayedPool, replayedTx, err)
	}
	changed := create
	changed.Name = "changed"
	changed.Authorization = ResourceAuthorization{}
	changed.Authorization = mustResourceAuthorization(t, ownerKey, d.cfg.ChainID, ResourcePoolCreateAction, changed, 1)
	if _, _, err := d.CreateResourcePool(changed); err == nil || !strings.Contains(err.Error(), "idempotency") {
		t.Fatalf("expected changed replay rejection, got %v", err)
	}

	sponsor := ResourceSponsorshipInput{PoolID: pool.ID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 5, ActionReference: "pay-intent:001", IdempotencyKey: "sponsor-001"}
	sponsor.Authorization = mustResourceAuthorization(t, userKey, d.cfg.ChainID, ResourceSponsorAction, sponsor, 1)
	record, sponsorTx, err := d.SponsorResource(sponsor)
	if err != nil {
		t.Fatal(err)
	}
	if record.Sponsor != owner || record.Payer != user || sponsorTx.From != user || sponsorTx.Sponsor != owner || sponsorTx.ResourceConsumed != 5 || sponsorTx.Fee != 0 || sponsorTx.Amount != 0 {
		t.Fatalf("sponsored transaction hides payer/source or moves value: %+v %+v", record, sponsorTx)
	}
	replay, replayTx, err := d.SponsorResource(sponsor)
	if err != nil || replay.ID != record.ID || replayTx.Hash != sponsorTx.Hash {
		t.Fatalf("exact sponsorship replay failed: %+v %+v %v", replay, replayTx, err)
	}
	ownerAfterSponsor, _ := d.Account(owner)
	userAfterSponsor, _ := d.Account(user)
	if ownerAfterSponsor.Balance != ownerBefore.Balance || userAfterSponsor.Balance != userBefore.Balance || ownerAfterSponsor.ResourceUsage != ownerAfterCreate.ResourceUsage || userAfterSponsor.ResourceUsage != userBefore.ResourceUsage || userAfterSponsor.Nonce != 1 {
		t.Fatalf("sponsorship changed balances or user resource usage: owner=%+v user=%+v", ownerAfterSponsor, userAfterSponsor)
	}

	over := ResourceSponsorshipInput{PoolID: pool.ID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 11, ActionReference: "pay-intent:over", IdempotencyKey: "sponsor-over"}
	over.Authorization = mustResourceAuthorization(t, userKey, d.cfg.ChainID, ResourceSponsorAction, over, 2)
	if _, _, err := d.SponsorResource(over); err == nil || !strings.Contains(err.Error(), "per-action") {
		t.Fatalf("expected per-action rejection, got %v", err)
	}

	pause := ResourcePoolStatusInput{PoolID: pool.ID, Status: "paused", ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "pool-pause-001"}
	pause.Authorization = mustResourceAuthorization(t, ownerKey, d.cfg.ChainID, ResourcePoolStatusAction, pause, 2)
	pool, _, err = d.UpdateResourcePoolStatus(pause)
	if err != nil || pool.Status != "paused" {
		t.Fatalf("pause failed: %+v %v", pool, err)
	}
	blocked := ResourceSponsorshipInput{PoolID: pool.ID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 1, ActionReference: "pay-intent:paused", IdempotencyKey: "sponsor-paused"}
	blocked.Authorization = mustResourceAuthorization(t, userKey, d.cfg.ChainID, ResourceSponsorAction, blocked, 2)
	if _, _, err := d.SponsorResource(blocked); err == nil {
		t.Fatal("paused pool accepted sponsorship")
	}

	resume := ResourcePoolStatusInput{PoolID: pool.ID, Status: "active", ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "pool-resume-001"}
	resume.Authorization = mustResourceAuthorization(t, ownerKey, d.cfg.ChainID, ResourcePoolStatusAction, resume, 3)
	pool, _, err = d.UpdateResourcePoolStatus(resume)
	if err != nil || pool.Status != "active" {
		t.Fatalf("resume failed: %+v %v", pool, err)
	}
	fund := ResourcePoolFundInput{PoolID: pool.ID, Additional: ResourceUnits{Bandwidth: 10, Compute: 2}, ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "pool-fund-001"}
	fund.Authorization = mustResourceAuthorization(t, ownerKey, d.cfg.ChainID, ResourcePoolFundAction, fund, 4)
	pool, _, err = d.FundResourcePool(fund)
	if err != nil || pool.CumulativeAllowance.Bandwidth != 40 {
		t.Fatalf("fund failed: %+v %v", pool, err)
	}
	policy := ResourcePoolPolicyInput{PoolID: pool.ID, AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"dapp_action", "pay_api"}, AllowedResourceTypes: []string{"bandwidth", "compute"}, PerActionLimit: ResourceUnits{Bandwidth: 8, Compute: 2}, ExpiresAt: time.Now().UTC().Add(2 * time.Hour), ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "pool-policy-001"}
	policy.Authorization = mustResourceAuthorization(t, ownerKey, d.cfg.ChainID, ResourcePoolPolicyAction, policy, 5)
	pool, _, err = d.UpdateResourcePoolPolicy(policy)
	if err != nil || !containsStringValue(pool.AllowedScopes, "dapp_action") {
		t.Fatalf("policy update failed: %+v %v", pool, err)
	}
	revoke := ResourcePoolStatusInput{PoolID: pool.ID, Status: "revoked", ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "pool-revoke-001"}
	revoke.Authorization = mustResourceAuthorization(t, ownerKey, d.cfg.ChainID, ResourcePoolStatusAction, revoke, 6)
	pool, _, err = d.UpdateResourcePoolStatus(revoke)
	if err != nil || pool.Status != "revoked" {
		t.Fatalf("revoke failed: %+v %v", pool, err)
	}
	originalReplay, originalTx, err := d.CreateResourcePool(create)
	if err != nil || originalReplay.Status != "active" || originalReplay.CumulativeAllowance.Bandwidth != 30 || len(originalReplay.AllowedScopes) != 1 || originalTx.Hash != createTx.Hash {
		t.Fatalf("create replay did not return the original persisted response: %+v %+v %v", originalReplay, originalTx, err)
	}
	ownerAfterRevoke, _ := d.Account(owner)
	if ownerAfterRevoke.ResourceUsage.BandwidthUsed != 5 || ownerAfterRevoke.ResourceUsage.ComputeUsed != 0 {
		t.Fatalf("revoke did not release only unused reservation: %+v", ownerAfterRevoke.ResourceUsage)
	}
	if analytics := d.ResourceAnalytics(); analytics.MerchantPoolCount != 1 || analytics.ActiveSponsorPoolCount != 0 || analytics.SponsorshipCount != 1 || analytics.SponsoredResources.Bandwidth != 5 {
		t.Fatalf("unexpected sponsor analytics: %+v", analytics)
	}
	if len(d.ResourceSponsorAudit()) != 7 {
		t.Fatalf("unexpected audit event count: %d", len(d.ResourceSponsorAudit()))
	}
}

func TestResourceSponsorDeterministicSelectionConcurrencyRestartAndTamper(t *testing.T) {
	dir := t.TempDir()
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	ownerKey := resourceTestKey(10)
	owner := resourceTestAddress(t, ownerKey)
	_, _ = d.Faucet(owner, 100)

	poolIDs := make([]string, 0, 2)
	for i := 0; i < 2; i++ {
		create := ResourcePoolCreateInput{PoolType: "dapp", Name: "public-dapp", Public: true, AllowedScopes: []string{"dapp_action"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: ResourceUnits{Bandwidth: 1}, CumulativeAllowance: ResourceUnits{Bandwidth: 10}, ExpiresAt: time.Now().UTC().Add(time.Hour), IdempotencyKey: "public-pool-00" + string(rune('1'+i))}
		create.Authorization = mustResourceAuthorization(t, ownerKey, d.cfg.ChainID, ResourcePoolCreateAction, create, uint64(i+1))
		pool, _, err := d.CreateResourcePool(create)
		if err != nil {
			t.Fatal(err)
		}
		poolIDs = append(poolIDs, pool.ID)
	}
	sort.Strings(poolIDs)

	var successes atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := resourceTestKey(byte(30 + i))
			address := resourceTestAddress(t, key)
			_, _ = d.Faucet(address, 10)
			input := ResourceSponsorshipInput{Beneficiary: address, Scope: "dapp_action", ResourceType: "bandwidth", Amount: 1, ActionReference: "dapp-call:" + string(rune('a'+i)), IdempotencyKey: "concurrent-" + string(rune('a'+i))}
			input.Authorization = mustResourceAuthorization(t, key, d.cfg.ChainID, ResourceSponsorAction, input, 1)
			record, _, err := d.SponsorResource(input)
			if err == nil {
				if record.PoolID != poolIDs[0] && record.PoolID != poolIDs[1] {
					t.Errorf("unexpected pool selection %s", record.PoolID)
				}
				successes.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if successes.Load() != 12 {
		t.Fatalf("expected all 12 actions across two deterministic pools, got %d", successes.Load())
	}
	first, _ := d.ResourcePool(poolIDs[0])
	second, _ := d.ResourcePool(poolIDs[1])
	if first.Consumed.Bandwidth != 10 || second.Consumed.Bandwidth != 2 {
		t.Fatalf("selection was not lexicographic with atomic exhaustion: first=%+v second=%+v", first.Consumed, second.Consumed)
	}

	restored, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.ResourcePools("", "", "")) != 2 || len(restored.ResourceSponsorships("", "")) != 12 || len(restored.ResourceSponsorAudit()) != 14 {
		t.Fatalf("sponsor state did not survive restart")
	}

	path := filepath.Join(dir, "devnet-state.json")
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(payload, &raw); err != nil {
		t.Fatal(err)
	}
	pools := raw["resourcePools"].(map[string]any)
	pool := pools[poolIDs[0]].(map[string]any)
	pool["status"] = "revoked"
	tampered, _ := json.Marshal(raw)
	if err := os.WriteFile(path, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir); err == nil || !strings.Contains(err.Error(), "integrity") {
		t.Fatalf("expected tampered sponsor snapshot rejection, got %v", err)
	}
}

func TestResourceSponsorRejectsUnauthorizedAndPolicyViolations(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	ownerKey, userKey, intruderKey := resourceTestKey(70), resourceTestKey(71), resourceTestKey(72)
	owner, user, intruder := resourceTestAddress(t, ownerKey), resourceTestAddress(t, userKey), resourceTestAddress(t, intruderKey)
	_, _ = d.Faucet(owner, 20)
	_, _ = d.Faucet(user, 20)
	_, _ = d.Faucet(intruder, 20)
	create := ResourcePoolCreateInput{PoolType: "merchant", Name: "bounded", AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: ResourceUnits{Bandwidth: 2}, CumulativeAllowance: ResourceUnits{Bandwidth: 2}, ExpiresAt: time.Now().UTC().Add(time.Hour), IdempotencyKey: "bounded-create"}
	create.Authorization = mustResourceAuthorization(t, ownerKey, d.cfg.ChainID, ResourcePoolCreateAction, create, 1)
	pool, _, err := d.CreateResourcePool(create)
	if err != nil {
		t.Fatal(err)
	}
	wrongFund := ResourcePoolFundInput{PoolID: pool.ID, Additional: ResourceUnits{Bandwidth: 1}, ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "wrong-owner-fund"}
	wrongFund.Authorization = mustResourceAuthorization(t, intruderKey, d.cfg.ChainID, ResourcePoolFundAction, wrongFund, 1)
	if _, _, err := d.FundResourcePool(wrongFund); err == nil || !strings.Contains(err.Error(), "not owned") {
		t.Fatalf("wrong owner funding was not rejected: %v", err)
	}

	cases := []struct {
		name  string
		key   *secp256k1.PrivateKey
		input ResourceSponsorshipInput
	}{
		{"beneficiary", intruderKey, ResourceSponsorshipInput{PoolID: pool.ID, Beneficiary: intruder, Scope: "pay_api", ResourceType: "bandwidth", Amount: 1, ActionReference: "bad:beneficiary", IdempotencyKey: "bad-beneficiary"}},
		{"scope", userKey, ResourceSponsorshipInput{PoolID: pool.ID, Beneficiary: user, Scope: "dapp_action", ResourceType: "bandwidth", Amount: 1, ActionReference: "bad:scope", IdempotencyKey: "bad-scope"}},
		{"type", userKey, ResourceSponsorshipInput{PoolID: pool.ID, Beneficiary: user, Scope: "pay_api", ResourceType: "trust_credits", Amount: 1, ActionReference: "bad:type", IdempotencyKey: "bad-type"}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			test.input.Authorization = mustResourceAuthorization(t, test.key, d.cfg.ChainID, ResourceSponsorAction, test.input, 1)
			if _, _, err := d.SponsorResource(test.input); err == nil {
				t.Fatalf("disallowed %s was accepted", test.name)
			}
		})
	}

	consume := ResourceSponsorshipInput{PoolID: pool.ID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 2, ActionReference: "pay:bounded", IdempotencyKey: "bounded-consume"}
	consume.Authorization = mustResourceAuthorization(t, userKey, d.cfg.ChainID, ResourceSponsorAction, consume, 1)
	if _, _, err := d.SponsorResource(consume); err != nil {
		t.Fatal(err)
	}
	duplicateRef := ResourceSponsorshipInput{PoolID: pool.ID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 1, ActionReference: consume.ActionReference, IdempotencyKey: "changed-action-reference"}
	duplicateRef.Authorization = mustResourceAuthorization(t, userKey, d.cfg.ChainID, ResourceSponsorAction, duplicateRef, 2)
	if _, _, err := d.SponsorResource(duplicateRef); err == nil || !strings.Contains(err.Error(), "actionReference") {
		t.Fatalf("duplicate action reference was not rejected: %v", err)
	}
	exhausted := duplicateRef
	exhausted.ActionReference, exhausted.IdempotencyKey, exhausted.Authorization = "pay:exhausted", "pool-exhausted", ResourceAuthorization{}
	exhausted.Authorization = mustResourceAuthorization(t, userKey, d.cfg.ChainID, ResourceSponsorAction, exhausted, 2)
	if _, _, err := d.SponsorResource(exhausted); err == nil || !strings.Contains(err.Error(), "exhausted") {
		t.Fatalf("exhausted pool was not rejected: %v", err)
	}

	expiring := ResourcePoolCreateInput{PoolType: "dapp", Name: "expires", Public: true, AllowedScopes: []string{"dapp_action"}, AllowedResourceTypes: []string{"compute"}, PerActionLimit: ResourceUnits{Compute: 1}, CumulativeAllowance: ResourceUnits{Compute: 1}, ExpiresAt: time.Now().UTC().Add(30 * time.Millisecond), IdempotencyKey: "expiring-create"}
	expiring.Authorization = mustResourceAuthorization(t, ownerKey, d.cfg.ChainID, ResourcePoolCreateAction, expiring, 2)
	expiredPool, _, err := d.CreateResourcePool(expiring)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(40 * time.Millisecond)
	expired := ResourceSponsorshipInput{PoolID: expiredPool.ID, Beneficiary: user, Scope: "dapp_action", ResourceType: "compute", Amount: 1, ActionReference: "dapp:expired", IdempotencyKey: "expired-use"}
	expired.Authorization = mustResourceAuthorization(t, userKey, d.cfg.ChainID, ResourceSponsorAction, expired, 2)
	if _, _, err := d.SponsorResource(expired); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expired pool was not rejected: %v", err)
	}
}

func resourcePoolCreateFixture(beneficiary, poolType, name string, expires time.Time, key string) ResourcePoolCreateInput {
	return ResourcePoolCreateInput{PoolType: poolType, Name: name, AllowedBeneficiaries: []string{beneficiary}, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth", "compute"}, PerActionLimit: ResourceUnits{Bandwidth: 10, Compute: 2}, CumulativeAllowance: ResourceUnits{Bandwidth: 30, Compute: 6}, ExpiresAt: expires.UTC(), IdempotencyKey: key}
}

func mustResourceAuthorization(t *testing.T, key *secp256k1.PrivateKey, chainID int64, action string, payload any, nonce uint64) ResourceAuthorization {
	t.Helper()
	auth, err := SignResourceAuthorization(key, chainID, action, payload, nonce)
	if err != nil {
		t.Fatal(err)
	}
	return auth
}

func resourceTestKey(marker byte) *secp256k1.PrivateKey {
	seed := make([]byte, 32)
	seed[31] = marker
	return secp256k1.PrivKeyFromBytes(seed)
}

func resourceTestAddress(t *testing.T, key *secp256k1.PrivateKey) string {
	t.Helper()
	address, err := nativeResourceAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	return address
}
