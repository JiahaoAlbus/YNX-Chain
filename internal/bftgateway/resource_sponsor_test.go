package bftgateway

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayCommitsDirectSignedResourceSponsorWorkflow(t *testing.T) {
	ownerKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 127))
	userKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 128))
	owner, _ := consensus.NativeAddress(ownerKey.PubKey().SerializeCompressed())
	user, _ := consensus.NativeAddress(userKey.PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_, _ = devnet.Faucet(owner, 100)
	_, _ = devnet.Faucet(user, 50)
	devnet.ProduceBlock()
	migration, _ := devnet.ExportConsensusMigrationState()
	app, err := consensus.NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	fixture := newABCICometFixture(t, app, int64(migration.Height))
	upstream := httptest.NewServer(fixture)
	defer upstream.Close()
	gateway, _ := New(Config{CometRPCURL: upstream.URL})
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()

	create := consensus.ResourcePoolCreatePayload{PoolType: "merchant", Name: "Gateway", Public: false, AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: chain.ResourceUnits{Bandwidth: 2}, CumulativeAllowance: chain.ResourceUnits{Bandwidth: 6}, ExpiresAt: time.Now().UTC().Add(time.Hour), IdempotencyKey: "gateway-pool-create"}
	createRaw := signedResource(t, ownerKey, consensus.ActionResourcePoolCreate, create, 1)
	var created struct {
		Pool        consensus.BFTResourcePool `json:"pool"`
		Transaction chain.Transaction         `json:"transaction"`
	}
	postSignedAction(t, server.URL+"/resource-market/pools", createRaw, http.StatusCreated, &created)
	if created.Pool.Owner != owner || created.Transaction.From != owner || created.Transaction.Fee != 0 || created.Pool.TxHash != created.Transaction.Hash {
		t.Fatalf("unexpected committed pool response: %+v", created)
	}
	poolID := created.Pool.ID

	sponsor := consensus.ResourceSponsorshipPayload{PoolID: poolID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 2, ActionReference: "pay:gateway-1", IdempotencyKey: "gateway-sponsor-1"}
	sponsorRaw := signedResource(t, userKey, consensus.ActionResourceSponsor, sponsor, 1)
	var sponsored struct {
		Sponsorship consensus.BFTResourceSponsorship `json:"sponsorship"`
		Transaction chain.Transaction                `json:"transaction"`
	}
	postSignedAction(t, server.URL+"/resource-market/sponsorships", sponsorRaw, http.StatusCreated, &sponsored)
	if sponsored.Sponsorship.Sponsor != owner || sponsored.Transaction.Sponsor != owner || sponsored.Transaction.SponsorPoolID != poolID || sponsored.Transaction.ResourceSource != "merchant-resource-pool" || sponsored.Transaction.ResourceConsumed != 2 {
		t.Fatalf("BFT transaction lacks Explorer sponsor evidence: %+v", sponsored)
	}

	var pools struct {
		Pools []consensus.BFTResourcePool `json:"pools"`
	}
	getJSON(t, server.URL+"/resource-market/pools?owner="+owner, &pools)
	if len(pools.Pools) != 1 || pools.Pools[0].Consumed.Bandwidth != 2 {
		t.Fatalf("unexpected pool list: %+v", pools)
	}
	var sponsorships struct {
		Sponsorships []consensus.BFTResourceSponsorship `json:"sponsorships"`
	}
	getJSON(t, server.URL+"/resource-market/sponsorships?poolId="+poolID, &sponsorships)
	if len(sponsorships.Sponsorships) != 1 || sponsorships.Sponsorships[0].ID != sponsored.Sponsorship.ID {
		t.Fatalf("unexpected sponsorship list: %+v", sponsorships)
	}
	var audit struct {
		Events []consensus.BFTResourceSponsorAudit `json:"events"`
	}
	getJSON(t, server.URL+"/resource-market/sponsor-audit", &audit)
	if len(audit.Events) != 2 || audit.Events[1].PreviousHash != audit.Events[0].AuditHash {
		t.Fatalf("unexpected sponsor audit: %+v", audit)
	}
	var analytics chain.ResourceAnalytics
	getJSON(t, server.URL+"/resource-market/analytics", &analytics)
	if analytics.MerchantPoolCount != 1 || analytics.SponsorshipCount != 1 || analytics.SponsoredResources.Bandwidth != 2 {
		t.Fatalf("unexpected sponsor analytics: %+v", analytics)
	}

	var replay struct {
		Pool        consensus.BFTResourcePool `json:"pool"`
		Transaction chain.Transaction         `json:"transaction"`
	}
	postSignedAction(t, server.URL+"/resource-market/pools", createRaw, http.StatusOK, &replay)
	if replay.Pool.Consumed.Bandwidth != 0 || replay.Pool.TxHash != created.Pool.TxHash {
		t.Fatalf("replay did not return exact original snapshot: %+v", replay)
	}
	changed := create
	changed.Name = "Changed"
	changedRaw := signedResource(t, ownerKey, consensus.ActionResourcePoolCreate, changed, 2)
	postSignedAction(t, server.URL+"/resource-market/pools", changedRaw, http.StatusConflict, nil)
	postSignedAction(t, server.URL+"/resource-market/sponsorships", createRaw, http.StatusBadRequest, nil)

	var ownerAfter chain.ConsensusAccount
	getJSON(t, server.URL+"/accounts/"+owner, &ownerAfter)
	var userAfter chain.ConsensusAccount
	getJSON(t, server.URL+"/accounts/"+user, &userAfter)
	if ownerAfter.Balance != accountBalance(migration.Accounts, owner) || userAfter.Balance != accountBalance(migration.Accounts, user) {
		t.Fatal("BFT Gateway Resource sponsor workflow moved YNXT")
	}
}

func accountBalance(accounts []chain.ConsensusAccount, address string) int64 {
	for _, account := range accounts {
		if account.Address == address {
			return account.Balance
		}
	}
	return -1
}
