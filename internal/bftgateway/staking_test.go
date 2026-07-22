package bftgateway

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayCommitsAndQueriesStakingWithoutYieldClaims(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 71))
	delegator, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(delegator, 1_000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := consensus.NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	fixture := newABCICometFixture(t, app, int64(migration.Height))
	upstream := httptest.NewServer(fixture)
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()

	validator := migration.Validators[0].Address
	delegateTx, _ := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionStakeDelegate, consensus.StakeDelegatePayload{Validator: validator, AmountYNXT: 400}, 1)
	delegateRaw, _ := consensus.EncodeSignedApplicationAction(delegateTx)
	var delegated struct {
		Delegation consensus.BFTStakeDelegation `json:"delegation"`
		Source     string                       `json:"source"`
		Failure    bool                         `json:"failure"`
	}
	postSignedAction(t, server.URL+"/staking/delegations", delegateRaw, http.StatusCreated, &delegated)
	if delegated.Failure || delegated.Source != "ynx-consensus-abci" || delegated.Delegation.AmountYNXT != 400 {
		t.Fatalf("unexpected delegation response: %+v", delegated)
	}

	unbondTx, _ := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionStakeUnbond, consensus.StakeUnbondPayload{DelegationID: delegated.Delegation.ID, AmountYNXT: 150}, 2)
	unbondRaw, _ := consensus.EncodeSignedApplicationAction(unbondTx)
	var unbonded struct {
		Unbonding consensus.BFTUnbondingEntry `json:"unbonding"`
		Failure   bool                        `json:"failure"`
	}
	postSignedAction(t, server.URL+"/staking/unbondings", unbondRaw, http.StatusCreated, &unbonded)
	if unbonded.Failure || unbonded.Unbonding.Status != "queued" || unbonded.Unbonding.AmountYNXT != 150 {
		t.Fatalf("unexpected unbonding response: %+v", unbonded)
	}

	var summary map[string]any
	getJSON(t, server.URL+"/staking/summary", &summary)
	if summary["yieldGuaranteed"] != false || summary["rewardSource"] != "none_until_governed_issuance_activation" || summary["jailAndSlashing"] != "not_activated_requires_governance_authority" {
		t.Fatalf("staking summary overclaimed: %+v", summary)
	}
	var records struct {
		Delegations []consensus.BFTStakeDelegation `json:"delegations"`
		Failure     bool                           `json:"failure"`
	}
	getJSON(t, server.URL+"/staking/delegations", &records)
	if records.Failure || len(records.Delegations) != 1 || records.Delegations[0].AmountYNXT != 250 {
		t.Fatalf("unexpected delegation list: %+v", records)
	}
	var treasury struct {
		Failure  bool                          `json:"failure"`
		Source   string                        `json:"source"`
		Treasury consensus.BFTTreasurySnapshot `json:"treasury"`
	}
	getJSON(t, server.URL+"/treasury/snapshot", &treasury)
	if treasury.Failure || treasury.Source != "ynx-consensus-abci" || treasury.Treasury.TransferExecutionEnabled || treasury.Treasury.SecretMarketSupport || !treasury.Treasury.Reconciled {
		t.Fatalf("Treasury boundary was not truthful: %+v", treasury)
	}
}
