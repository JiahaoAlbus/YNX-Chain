package bftgateway

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayCommitsAndQueriesSignedResourceWorkflow(t *testing.T) {
	providerKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 96))
	renterKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 97))
	provider, _ := consensus.NativeAddress(providerKey.PubKey().SerializeCompressed())
	renter, _ := consensus.NativeAddress(renterKey.PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_, _ = devnet.Faucet(provider, 1000)
	_, _ = devnet.Faucet(renter, 100)
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

	var policy chain.ResourceMarketPolicy
	getJSON(t, server.URL+"/resource-market/policy", &policy)
	if policy.PolicyHash != migration.ResourcePolicy.PolicyHash {
		t.Fatalf("unexpected Resource policy: %+v", policy)
	}
	var quote chain.ResourceQuote
	query := url.Values{"address": {renter}, "bandwidth": {"100"}, "compute": {"10"}, "aiCredits": {"1"}, "trustCredits": {"1"}}
	getJSON(t, server.URL+"/resource-market/quote?"+query.Encode(), &quote)
	if quote.PriceYNXT <= 0 || quote.PolicyHash != policy.PolicyHash {
		t.Fatalf("unexpected Resource quote: %+v", quote)
	}

	delegation := consensus.ResourceDelegationPayload{Provider: provider, Beneficiary: provider, AmountYNXT: 100, PolicyHash: policy.PolicyHash, IdempotencyKey: "gateway-delegate"}
	delegation.RequestHash = consensus.ResourceDelegationRequestHash(delegation.Provider, delegation.Beneficiary, delegation.AmountYNXT, delegation.PolicyHash, delegation.IdempotencyKey)
	delegationRaw := signedResource(t, providerKey, consensus.ActionResourceDelegate, delegation, 1)
	var delegationRecord consensus.BFTResourceDelegation
	postSignedAction(t, server.URL+"/resource-market/delegations", delegationRaw, http.StatusCreated, &delegationRecord)
	if delegationRecord.Provider != provider || delegationRecord.AmountYNXT != 100 {
		t.Fatalf("unexpected delegation: %+v", delegationRecord)
	}

	rental := consensus.ResourceRentalPayload{Address: renter, Provider: provider, Bandwidth: quote.Bandwidth, Compute: quote.Compute, AICredits: quote.AICredits, TrustCredits: quote.TrustCredits, QuoteID: quote.ID, QuoteExpiresAt: quote.ExpiresAt, PolicyHash: quote.PolicyHash, MaxPriceYNXT: quote.PriceYNXT, IdempotencyKey: "gateway-rent"}
	rental.RequestHash = consensus.ResourceRentalRequestHash(rental.Address, rental.Provider, rental.Bandwidth, rental.Compute, rental.AICredits, rental.TrustCredits, rental.QuoteID, rental.QuoteExpiresAt, rental.PolicyHash, rental.MaxPriceYNXT, rental.IdempotencyKey)
	rentalRaw := signedResource(t, renterKey, consensus.ActionResourceRent, rental, 1)
	var rentalRecord consensus.BFTResourceRental
	postSignedAction(t, server.URL+"/resource-market/rent", rentalRaw, http.StatusCreated, &rentalRecord)
	if rentalRecord.QuoteID != quote.ID || rentalRecord.ProviderIncomeYNXT+rentalRecord.ProtocolFeeYNXT != quote.PriceYNXT {
		t.Fatalf("unexpected rental: %+v", rentalRecord)
	}

	var delegations []consensus.BFTResourceDelegation
	getJSON(t, server.URL+"/resource-market/delegations/"+provider, &delegations)
	if len(delegations) != 1 || delegations[0].ID != delegationRecord.ID {
		t.Fatalf("unexpected delegation list: %+v", delegations)
	}
	var income []consensus.BFTResourceIncome
	getJSON(t, server.URL+"/resource-market/income/"+provider, &income)
	if len(income) != 1 || income[0].RentalID != rentalRecord.ID {
		t.Fatalf("unexpected Resource income: %+v", income)
	}
	var analytics chain.ResourceAnalytics
	getJSON(t, server.URL+"/resource-market/analytics", &analytics)
	if analytics.ResourceRentalCount != 1 || analytics.ActiveDelegationCount != 1 || analytics.TruthfulStatus != "committed_bft_state" {
		t.Fatalf("unexpected analytics: %+v", analytics)
	}
	var idempotency consensus.BFTResourceIdempotency
	getJSON(t, server.URL+"/resource-market/idempotency?"+url.Values{"signer": {renter}, "key": {"gateway-rent"}}.Encode(), &idempotency)
	if idempotency.ObjectID != rentalRecord.ID {
		t.Fatalf("unexpected idempotency: %+v", idempotency)
	}
	var rentalLookup consensus.BFTResourceRental
	getJSON(t, server.URL+"/resource-market/rentals/"+rentalRecord.ID, &rentalLookup)
	if rentalLookup.ID != rentalRecord.ID {
		t.Fatal("Resource rental lookup mismatch")
	}

	wrongRaw := signedResource(t, providerKey, consensus.ActionResourceDelegate, delegationWithKey(delegation, "wrong-route"), 2)
	postSignedAction(t, server.URL+"/resource-market/rent", wrongRaw, http.StatusBadRequest, nil)
}

func delegationWithKey(input consensus.ResourceDelegationPayload, key string) consensus.ResourceDelegationPayload {
	input.IdempotencyKey = key
	input.RequestHash = consensus.ResourceDelegationRequestHash(input.Provider, input.Beneficiary, input.AmountYNXT, input.PolicyHash, input.IdempotencyKey)
	return input
}

func signedResource(t *testing.T, key *secp256k1.PrivateKey, action string, payload any, nonce uint64) []byte {
	t.Helper()
	tx, err := consensus.NewSignedApplicationAction(key, 6423, action, payload, nonce)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := consensus.EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
