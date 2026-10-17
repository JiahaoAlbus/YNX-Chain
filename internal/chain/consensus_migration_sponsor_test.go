package chain

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestConsensusSponsorReplayHashMatchesOriginalAuthorization(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes([]byte{1})
	expired := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		action string
		input  any
	}{
		{ResourcePoolCreateAction, ResourcePoolCreateInput{PoolType: "merchant", Name: "Old", Public: true, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: ResourceUnits{Bandwidth: 1}, CumulativeAllowance: ResourceUnits{Bandwidth: 3}, ExpiresAt: expired, IdempotencyKey: "old-create"}},
		{ResourcePoolFundAction, ResourcePoolFundInput{PoolID: "rsp_original", Additional: ResourceUnits{Bandwidth: 2}, ExpectedPolicyHash: "original-policy", IdempotencyKey: "old-fund"}},
		{ResourcePoolPolicyAction, ResourcePoolPolicyInput{PoolID: "rsp_original", Public: true, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: ResourceUnits{Bandwidth: 1}, ExpiresAt: expired, ExpectedPolicyHash: "original-policy", IdempotencyKey: "old-policy"}},
		{ResourcePoolStatusAction, ResourcePoolStatusInput{PoolID: "rsp_original", Status: "paused", ExpectedPolicyHash: "original-policy", IdempotencyKey: "old-status"}},
		{ResourceSponsorAction, ResourceSponsorshipInput{PoolID: "rsp_original", Beneficiary: "source-beneficiary", Scope: "pay_api", ResourceType: "bandwidth", Amount: 1, ActionReference: "old:action", IdempotencyKey: "old-use"}},
	}
	for _, tc := range cases {
		t.Run(tc.action, func(t *testing.T) {
			auth, err := SignResourceAuthorization(key, 6423, tc.action, tc.input, 1)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(tc.input)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = ConsensusSourceSponsorRequestHash(tc.action, raw); err == nil {
				t.Fatal("caller-supplied historical authorization field accepted")
			}
			var fields map[string]json.RawMessage
			if err = json.Unmarshal(raw, &fields); err != nil {
				t.Fatal(err)
			}
			delete(fields, "authorization")
			body, err := json.Marshal(fields)
			if err != nil {
				t.Fatal(err)
			}
			hash, err := ConsensusSourceSponsorRequestHash(tc.action, body)
			if err != nil || hash != auth.PayloadHash {
				t.Fatalf("original signer payload hash changed: %s %s %v", hash, auth.PayloadHash, err)
			}
			fields["unexpected"] = json.RawMessage(`true`)
			body, err = json.Marshal(fields)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = ConsensusSourceSponsorRequestHash(tc.action, body); err == nil {
				t.Fatal("unknown replay payload field accepted")
			}
		})
	}
}
