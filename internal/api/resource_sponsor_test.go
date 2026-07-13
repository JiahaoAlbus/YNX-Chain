package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestResourceSponsorHTTPAuthorizationLifecycleAndEvidence(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	server := httptest.NewServer(NewServerWithConfig(devnet, ServerConfig{ResourceGatewayUpstreamKey: "resource-upstream-test"}))
	defer server.Close()
	ownerKey, userKey := apiResourceKey(1), apiResourceKey(2)
	owner, _ := consensus.NativeAddress(ownerKey.PubKey().SerializeCompressed())
	user, _ := consensus.NativeAddress(userKey.PubKey().SerializeCompressed())
	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": owner, "amount": 100}, http.StatusCreated, nil)
	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": user, "amount": 100}, http.StatusCreated, nil)

	input := chain.ResourcePoolCreateInput{PoolType: "merchant", Name: "API merchant", AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: chain.ResourceUnits{Bandwidth: 5}, CumulativeAllowance: chain.ResourceUnits{Bandwidth: 20}, ExpiresAt: time.Now().UTC().Add(time.Hour), IdempotencyKey: "api-pool-create"}
	input.Authorization = apiResourceAuthorization(t, ownerKey, chain.ResourcePoolCreateAction, input, 1)
	doJSON(t, http.MethodPost, server.URL+"/resource-market/pools", input, http.StatusUnauthorized, nil)
	var created struct {
		Pool        chain.ResourcePool `json:"pool"`
		Transaction chain.Transaction  `json:"transaction"`
	}
	doResourceJSON(t, http.MethodPost, server.URL+"/resource-market/pools", input, http.StatusCreated, &created)
	if created.Pool.Owner != owner || created.Transaction.SponsorPoolID != created.Pool.ID {
		t.Fatalf("unexpected pool HTTP response: %+v", created)
	}
	var lookup chain.ResourcePool
	doResourceJSON(t, http.MethodGet, server.URL+"/resource-market/pools/"+created.Pool.ID, nil, http.StatusOK, &lookup)
	if lookup.PolicyHash != created.Pool.PolicyHash {
		t.Fatalf("pool lookup lost policy evidence: %+v", lookup)
	}

	sponsor := chain.ResourceSponsorshipInput{PoolID: created.Pool.ID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 3, ActionReference: "api-pay:001", IdempotencyKey: "api-sponsor-001"}
	sponsor.Authorization = apiResourceAuthorization(t, userKey, chain.ResourceSponsorAction, sponsor, 1)
	var sponsored struct {
		Sponsorship chain.ResourceSponsorship `json:"sponsorship"`
		Transaction chain.Transaction         `json:"transaction"`
	}
	doResourceJSON(t, http.MethodPost, server.URL+"/resource-market/sponsorships", sponsor, http.StatusCreated, &sponsored)
	if sponsored.Sponsorship.ResourceSource != "merchant-resource-pool" || sponsored.Transaction.ResourceConsumed != 3 || sponsored.Transaction.Sponsor != owner {
		t.Fatalf("HTTP sponsorship omitted real source evidence: %+v", sponsored)
	}
	var sponsorshipLookup chain.ResourceSponsorship
	doResourceJSON(t, http.MethodGet, server.URL+"/resource-market/sponsorships/"+sponsored.Sponsorship.ID, nil, http.StatusOK, &sponsorshipLookup)
	if sponsorshipLookup.TransactionHash != sponsored.Transaction.Hash {
		t.Fatalf("sponsorship lookup mismatch: %+v", sponsorshipLookup)
	}
	var audit struct {
		Events []chain.ResourceSponsorAuditEvent `json:"events"`
	}
	doResourceJSON(t, http.MethodGet, server.URL+"/resource-market/sponsor-audit", nil, http.StatusOK, &audit)
	if len(audit.Events) != 2 || audit.Events[1].PreviousHash != audit.Events[0].AuditHash {
		t.Fatalf("HTTP audit chain missing: %+v", audit.Events)
	}

	badFund := chain.ResourcePoolFundInput{PoolID: "different", Additional: chain.ResourceUnits{Bandwidth: 1}, IdempotencyKey: "path-mismatch"}
	badFund.Authorization = apiResourceAuthorization(t, ownerKey, chain.ResourcePoolFundAction, badFund, 2)
	doResourceJSON(t, http.MethodPost, server.URL+"/resource-market/pools/"+created.Pool.ID+"/fund", badFund, http.StatusBadRequest, nil)
}

func doResourceJSON(t *testing.T, method, url string, body any, expected int, out any) {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, url, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Resource-Gateway-Upstream-Key", "resource-upstream-test")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		t.Fatalf("expected status %d, got %d", expected, resp.StatusCode)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}

func apiResourceAuthorization(t *testing.T, key *secp256k1.PrivateKey, action string, input any, nonce uint64) chain.ResourceAuthorization {
	t.Helper()
	auth, err := chain.SignResourceAuthorization(key, 6423, action, input, nonce)
	if err != nil {
		t.Fatal(err)
	}
	return auth
}

func apiResourceKey(marker byte) *secp256k1.PrivateKey {
	seed := make([]byte, 32)
	seed[31] = marker
	return secp256k1.PrivKeyFromBytes(seed)
}
