package consensus

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestResourceSponsorActionsCommitDeterministicallyAndPersist(t *testing.T) {
	ctx := context.Background()
	ownerKey, userKey := deterministicPrivateKey(121), deterministicPrivateKey(122)
	owner, user := mustNativeAddress(t, ownerKey), mustNativeAddress(t, userKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_, _ = devnet.Faucet(owner, 100)
	_, _ = devnet.Faucet(user, 50)
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	blockTime := time.Date(2026, 7, 14, 9, 0, 0, 0, time.UTC)
	create := ResourcePoolCreatePayload{PoolType: "merchant", Name: "Checkout", Public: false, AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"pay_api", "dapp_action"}, AllowedResourceTypes: []string{"bandwidth", "compute"}, PerActionLimit: chain.ResourceUnits{Bandwidth: 3, Compute: 2}, CumulativeAllowance: chain.ResourceUnits{Bandwidth: 12, Compute: 5}, ExpiresAt: blockTime.Add(time.Hour), IdempotencyKey: "pool-create-1"}
	createRaw := mustResourceAction(t, ownerKey, ActionResourcePoolCreate, create, 1)
	poolID := "rsp_" + ApplicationActionRecordID("resource-pool", ApplicationActionHash(createRaw))
	sponsor := ResourceSponsorshipPayload{PoolID: poolID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 2, ActionReference: "pay:invoice-100", IdempotencyKey: "sponsor-1"}
	sponsorRaw := mustResourceAction(t, userKey, ActionResourceSponsor, sponsor, 1)

	var expectedHash string
	for i := 0; i < 4; i++ {
		statePath := filepath.Join(t.TempDir(), "state.json")
		app, err := NewPersistentApplication(migration, statePath)
		if err != nil {
			t.Fatal(err)
		}
		height := int64(migration.Height) + 1
		proposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: [][]byte{createRaw, sponsorRaw}})
		if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_ACCEPT {
			t.Fatalf("application %d proposal failed: %+v %v", i, proposal, err)
		}
		finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: [][]byte{createRaw, sponsorRaw}})
		if err != nil || len(finalized.TxResults) != 2 || finalized.TxResults[0].Code != 0 || finalized.TxResults[1].Code != 0 {
			t.Fatalf("application %d finalize failed: %+v %v", i, finalized, err)
		}
		if finalized.TxResults[0].Events[0].Type != "ynx.resource_sponsor_action" || finalized.TxResults[1].Events[0].Type != "ynx.resource_sponsor_action" {
			t.Fatal("missing Resource sponsor events")
		}
		if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		var state CommittedState
		queryJSON(t, app, "/state", &state)
		if i == 0 {
			expectedHash = state.AppHash
		} else if state.AppHash != expectedHash {
			t.Fatalf("four-application AppHash mismatch: %s != %s", state.AppHash, expectedHash)
		}
		if liquid, staked := sumConsensusYNXT(state.Accounts); liquid+staked != migration.LiquidSupplyYNXT+migration.StakedSupplyYNXT {
			t.Fatal("Resource sponsorship changed total YNXT supply")
		}
		ownerAccount, userAccount := queryConsensusAccount(t, app, owner), queryConsensusAccount(t, app, user)
		if ownerAccount.Balance != accountByAddress(t, migration.Accounts, owner).Balance || userAccount.Balance != accountByAddress(t, migration.Accounts, user).Balance {
			t.Fatal("Resource sponsor actions moved YNXT")
		}
		if ownerAccount.Nonce != 1 || userAccount.Nonce != 1 || ownerAccount.ResourceUsage.BandwidthUsed != 12 || ownerAccount.ResourceUsage.ComputeUsed != 5 || userAccount.ResourceUsage != accountByAddress(t, migration.Accounts, user).ResourceUsage {
			t.Fatalf("unexpected sponsor accounting: owner=%+v user=%+v", ownerAccount, userAccount)
		}
		var pool BFTResourcePool
		queryJSON(t, app, "/resource/pools/"+poolID, &pool)
		if pool.Owner != owner || pool.Consumed.Bandwidth != 2 || pool.CumulativeAllowance.Bandwidth != 12 || pool.PolicyHash != chain.ResourcePoolPolicyHash(pool.ResourcePool) {
			t.Fatalf("bad committed pool: %+v", pool)
		}
		sponsorshipID := "rss_" + ApplicationActionRecordID("resource-sponsorship", ApplicationActionHash(sponsorRaw))
		var record BFTResourceSponsorship
		queryJSON(t, app, "/resource/sponsorships/"+sponsorshipID, &record)
		if record.Sponsor != owner || record.Beneficiary != user || record.Payer != user || record.Amount != 2 || record.ResourceSource != "merchant-resource-pool" {
			t.Fatalf("bad committed sponsorship: %+v", record)
		}
		var audit []BFTResourceSponsorAudit
		queryJSON(t, app, "/resource/sponsor-audit", &audit)
		if len(audit) != 2 || audit[0].Sequence != 1 || audit[1].PreviousHash != audit[0].AuditHash {
			t.Fatalf("bad sponsor audit chain: %+v", audit)
		}
		var idem BFTResourceSponsorIdempotency
		queryJSON(t, app, "/resource/sponsor-idempotency/"+ResourceSponsorIdempotencyID(owner, create.IdempotencyKey), &idem)
		if idem.PoolSnapshot == nil || idem.PoolSnapshot.Consumed.Bandwidth != 0 {
			t.Fatalf("pool replay snapshot was not exact: %+v", idem)
		}
		var analytics chain.ResourceAnalytics
		queryJSON(t, app, "/resource/analytics", &analytics)
		if analytics.MerchantPoolCount != 1 || analytics.ActiveSponsorPoolCount != 1 || analytics.SponsorshipCount != 1 || analytics.SponsoredResources.Bandwidth != 2 {
			t.Fatalf("bad BFT sponsor analytics: %+v", analytics)
		}
		restarted, err := NewPersistentApplication(migration, statePath)
		if err != nil {
			t.Fatal(err)
		}
		var restored CommittedState
		queryJSON(t, restarted, "/state", &restored)
		if restored.AppHash != state.AppHash || string(mustJSON(t, restored.ResourcePools)) != string(mustJSON(t, state.ResourcePools)) {
			t.Fatal("Resource sponsor state changed after restart")
		}
	}
}

func TestResourceSponsorLifecycleAndFailClosedRules(t *testing.T) {
	ownerKey, userKey, attackerKey := deterministicPrivateKey(123), deterministicPrivateKey(124), deterministicPrivateKey(125)
	owner, user, attacker := mustNativeAddress(t, ownerKey), mustNativeAddress(t, userKey), mustNativeAddress(t, attackerKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	for _, address := range []string{owner, user, attacker} {
		_, _ = devnet.Faucet(address, 100)
	}
	devnet.ProduceBlock()
	migration, _ := devnet.ExportConsensusMigrationState()
	app, _ := NewApplication(migration)
	blockTime := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	create := ResourcePoolCreatePayload{PoolType: "dapp", Name: "Actions", Public: false, AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"dapp_action"}, AllowedResourceTypes: []string{"compute"}, PerActionLimit: chain.ResourceUnits{Compute: 2}, CumulativeAllowance: chain.ResourceUnits{Compute: 4}, ExpiresAt: blockTime.Add(time.Hour), IdempotencyKey: "lifecycle-create"}
	createRaw := mustResourceAction(t, ownerKey, ActionResourcePoolCreate, create, 1)
	commitSponsorBlock(t, app, int64(migration.Height)+1, blockTime, createRaw)
	poolID := "rsp_" + ApplicationActionRecordID("resource-pool", ApplicationActionHash(createRaw))
	var pool BFTResourcePool
	queryJSON(t, app, "/resource/pools/"+poolID, &pool)

	wrong := ResourcePoolFundPayload{PoolID: poolID, Additional: chain.ResourceUnits{Compute: 1}, ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "wrong-owner"}
	assertResourceSponsorRejected(t, app, mustResourceAction(t, attackerKey, ActionResourcePoolFund, wrong, 1), "wrong owner")
	changedReplay := create
	changedReplay.Name = "Changed"
	changedReplay.IdempotencyKey = create.IdempotencyKey
	assertResourceSponsorRejected(t, app, mustResourceAction(t, ownerKey, ActionResourcePoolCreate, changedReplay, 2), "changed idempotency replay")
	fund := ResourcePoolFundPayload{PoolID: poolID, Additional: chain.ResourceUnits{Compute: 2}, ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "fund-1"}
	commitSponsorBlock(t, app, int64(migration.Height)+2, blockTime.Add(time.Minute), mustResourceAction(t, ownerKey, ActionResourcePoolFund, fund, 2))
	queryJSON(t, app, "/resource/pools/"+poolID, &pool)
	if pool.CumulativeAllowance.Compute != 6 {
		t.Fatalf("Resource pool funding was not committed: %+v", pool)
	}
	policy := ResourcePoolPolicyPayload{PoolID: poolID, Public: false, AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"dapp_action"}, AllowedResourceTypes: []string{"compute"}, PerActionLimit: chain.ResourceUnits{Compute: 2}, ExpiresAt: blockTime.Add(2 * time.Hour), ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "policy-1"}
	commitSponsorBlock(t, app, int64(migration.Height)+3, blockTime.Add(2*time.Minute), mustResourceAction(t, ownerKey, ActionResourcePoolPolicy, policy, 3))
	queryJSON(t, app, "/resource/pools/"+poolID, &pool)
	if !pool.ExpiresAt.Equal(policy.ExpiresAt) || pool.PolicyHash == policy.ExpectedPolicyHash {
		t.Fatalf("Resource pool policy was not committed: %+v", pool)
	}
	expired := ResourceSponsorshipPayload{PoolID: poolID, Beneficiary: user, Scope: "dapp_action", ResourceType: "compute", Amount: 1, ActionReference: "dapp:expired", IdempotencyKey: "sponsor-expired"}
	expiredRaw := mustResourceAction(t, userKey, ActionResourceSponsor, expired, 1)
	proposal, _ := app.ProcessProposal(context.Background(), &abcitypes.RequestProcessProposal{Height: int64(migration.Height) + 4, Time: policy.ExpiresAt.Add(time.Second), Txs: [][]byte{expiredRaw}})
	if proposal.Status != abcitypes.ResponseProcessProposal_REJECT {
		t.Fatal("expired Resource pool sponsorship was accepted")
	}

	pause := ResourcePoolStatusPayload{PoolID: poolID, Status: "paused", ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "pause-1"}
	commitSponsorBlock(t, app, int64(migration.Height)+4, blockTime.Add(3*time.Minute), mustResourceAction(t, ownerKey, ActionResourcePoolStatus, pause, 4))
	sponsor := ResourceSponsorshipPayload{PoolID: poolID, Beneficiary: user, Scope: "dapp_action", ResourceType: "compute", Amount: 2, ActionReference: "dapp:1", IdempotencyKey: "sponsor-paused"}
	assertResourceSponsorRejected(t, app, mustResourceAction(t, userKey, ActionResourceSponsor, sponsor, 1), "paused pool")
	queryJSON(t, app, "/resource/pools/"+poolID, &pool)
	resume := ResourcePoolStatusPayload{PoolID: poolID, Status: "active", ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "resume-1"}
	commitSponsorBlock(t, app, int64(migration.Height)+5, blockTime.Add(4*time.Minute), mustResourceAction(t, ownerKey, ActionResourcePoolStatus, resume, 5))
	sponsor.IdempotencyKey = "sponsor-live"
	sponsorRaw := mustResourceAction(t, userKey, ActionResourceSponsor, sponsor, 1)
	commitSponsorBlock(t, app, int64(migration.Height)+6, blockTime.Add(5*time.Minute), sponsorRaw)
	duplicateRef := sponsor
	duplicateRef.IdempotencyKey = "sponsor-duplicate-ref"
	assertResourceSponsorRejected(t, app, mustResourceAction(t, userKey, ActionResourceSponsor, duplicateRef, 2), "duplicate action reference")
	overLimit := sponsor
	overLimit.ActionReference, overLimit.IdempotencyKey, overLimit.Amount = "dapp:2", "sponsor-over", 3
	assertResourceSponsorRejected(t, app, mustResourceAction(t, userKey, ActionResourceSponsor, overLimit, 2), "per action limit")
	queryJSON(t, app, "/resource/pools/"+poolID, &pool)
	revoke := ResourcePoolStatusPayload{PoolID: poolID, Status: "revoked", ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "revoke-1"}
	commitSponsorBlock(t, app, int64(migration.Height)+7, blockTime.Add(6*time.Minute), mustResourceAction(t, ownerKey, ActionResourcePoolStatus, revoke, 6))
	ownerAccount := queryConsensusAccount(t, app, owner)
	if ownerAccount.ResourceUsage.ComputeUsed != 2 {
		t.Fatalf("revoke did not release only unused reservation: %+v", ownerAccount.ResourceUsage)
	}
	sponsor.ActionReference, sponsor.IdempotencyKey = "dapp:3", "sponsor-revoked"
	assertResourceSponsorRejected(t, app, mustResourceAction(t, userKey, ActionResourceSponsor, sponsor, 2), "revoked pool")
}

func TestResourceSponsorCommittedStateRejectsTamper(t *testing.T) {
	ownerKey := deterministicPrivateKey(126)
	owner := mustNativeAddress(t, ownerKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_, _ = devnet.Faucet(owner, 100)
	devnet.ProduceBlock()
	migration, _ := devnet.ExportConsensusMigrationState()
	path := filepath.Join(t.TempDir(), "state.json")
	app, _ := NewPersistentApplication(migration, path)
	blockTime := time.Date(2026, 7, 14, 11, 0, 0, 0, time.UTC)
	create := ResourcePoolCreatePayload{PoolType: "merchant", Name: "Tamper", Public: true, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: chain.ResourceUnits{Bandwidth: 1}, CumulativeAllowance: chain.ResourceUnits{Bandwidth: 2}, ExpiresAt: blockTime.Add(time.Hour), IdempotencyKey: "tamper-create"}
	commitSponsorBlock(t, app, int64(migration.Height)+1, blockTime, mustResourceAction(t, ownerKey, ActionResourcePoolCreate, create, 1))
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var state CommittedState
	if err := json.Unmarshal(payload, &state); err != nil {
		t.Fatal(err)
	}
	state.ResourcePools[0].Consumed.Bandwidth = 3
	payload, _ = json.Marshal(state)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPersistentApplication(migration, path); err == nil {
		t.Fatal("tampered Resource sponsor state restarted")
	}
}

func TestResourceSponsorSelectsPoolAndProposalOrderDeterministically(t *testing.T) {
	ownerKey, userKey := deterministicPrivateKey(127), deterministicPrivateKey(128)
	owner, user := mustNativeAddress(t, ownerKey), mustNativeAddress(t, userKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_, _ = devnet.Faucet(owner, 100)
	_, _ = devnet.Faucet(user, 50)
	devnet.ProduceBlock()
	migration, _ := devnet.ExportConsensusMigrationState()
	app, _ := NewApplication(migration)
	blockTime := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)
	base := ResourcePoolCreatePayload{PoolType: "dapp", Public: true, AllowedScopes: []string{"dapp_action"}, AllowedResourceTypes: []string{"compute"}, PerActionLimit: chain.ResourceUnits{Compute: 1}, CumulativeAllowance: chain.ResourceUnits{Compute: 3}, ExpiresAt: blockTime.Add(time.Hour)}
	first, second := base, base
	first.Name, first.IdempotencyKey = "First", "select-first"
	second.Name, second.IdempotencyKey = "Second", "select-second"
	firstRaw, secondRaw := mustResourceAction(t, ownerKey, ActionResourcePoolCreate, first, 1), mustResourceAction(t, ownerKey, ActionResourcePoolCreate, second, 2)
	firstID := "rsp_" + ApplicationActionRecordID("resource-pool", ApplicationActionHash(firstRaw))
	secondID := "rsp_" + ApplicationActionRecordID("resource-pool", ApplicationActionHash(secondRaw))
	expected := firstID
	if secondID < expected {
		expected = secondID
	}
	sponsor := ResourceSponsorshipPayload{Beneficiary: user, Scope: "dapp_action", ResourceType: "compute", Amount: 1, ActionReference: "select:1", IdempotencyKey: "select-sponsor"}
	sponsorRaw := mustResourceAction(t, userKey, ActionResourceSponsor, sponsor, 1)
	commitSponsorBlock(t, app, int64(migration.Height)+1, blockTime, firstRaw, secondRaw, sponsorRaw)
	var committed BFTResourceSponsorship
	queryJSON(t, app, "/resource/sponsorships/rss_"+ApplicationActionRecordID("resource-sponsorship", ApplicationActionHash(sponsorRaw)), &committed)
	if committed.PoolID != expected {
		t.Fatalf("deterministic pool selection chose %s, expected %s", committed.PoolID, expected)
	}
	a, b := sponsor, sponsor
	a.ActionReference, a.IdempotencyKey = "select:2a", "select-a"
	b.ActionReference, b.IdempotencyKey = "select:2b", "select-b"
	aRaw, bRaw := mustResourceAction(t, userKey, ActionResourceSponsor, a, 2), mustResourceAction(t, userKey, ActionResourceSponsor, b, 2)
	prepared, err := app.PrepareProposal(context.Background(), &abcitypes.RequestPrepareProposal{Height: int64(migration.Height) + 2, Time: blockTime.Add(time.Minute), Txs: [][]byte{aRaw, bRaw}, MaxTxBytes: 1 << 20})
	if err != nil || len(prepared.Txs) != 1 || string(prepared.Txs[0]) != string(aRaw) {
		t.Fatalf("proposal did not deterministically reject conflicting nonce order: %+v %v", prepared, err)
	}
}

func commitSponsorBlock(t *testing.T, app *Application, height int64, blockTime time.Time, txs ...[]byte) {
	t.Helper()
	ctx := context.Background()
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: txs})
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range finalized.TxResults {
		if result.Code != 0 {
			t.Fatalf("Resource sponsor transaction rejected: %+v", result)
		}
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
}

func assertResourceSponsorRejected(t *testing.T, app *Application, raw []byte, label string) {
	t.Helper()
	result, _ := app.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: raw})
	if result.Code == 0 {
		t.Fatalf("Resource sponsor accepted %s", label)
	}
}
