package consensus

import (
	"context"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestStakingDelegationUnbondingAndWithdrawalLifecycle(t *testing.T) {
	key := deterministicPrivateKey(41)
	delegator := mustNativeAddress(t, key)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(delegator, 1_000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	validator := migration.Validators[0].Address
	app, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	height := int64(migration.Height)
	started := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)

	delegate := mustStakingAction(t, key, ActionStakeDelegate, StakeDelegatePayload{Validator: validator, AmountYNXT: 400}, 1)
	height++
	finalizeStakeBlock(t, ctx, app, height, started, delegate, true)
	delegationID := stakingDelegationID(delegator, validator)
	var delegation BFTStakeDelegation
	queryJSON(t, app, "/staking/delegations/"+delegationID, &delegation)
	if delegation.AmountYNXT != 400 || delegation.CommissionBPS != 1_000 || delegation.RewardSource != "none_until_governed_issuance_activation" {
		t.Fatalf("unexpected delegation: %+v", delegation)
	}

	unbond := mustStakingAction(t, key, ActionStakeUnbond, StakeUnbondPayload{DelegationID: delegationID, AmountYNXT: 150}, 2)
	height++
	unbondTime := started.Add(time.Hour)
	finalizeStakeBlock(t, ctx, app, height, unbondTime, unbond, true)
	unbondingID := ApplicationActionRecordID("stake-unbonding", ApplicationActionHash(unbond))
	var entry BFTUnbondingEntry
	queryJSON(t, app, "/staking/unbondings/"+unbondingID, &entry)
	if entry.Status != "queued" || entry.AmountYNXT != 150 || !entry.AvailableAt.Equal(unbondTime.Add(7*24*time.Hour)) {
		t.Fatalf("unexpected unbonding: %+v", entry)
	}

	withdraw := mustStakingAction(t, key, ActionStakeWithdraw, StakeWithdrawPayload{UnbondingID: unbondingID}, 3)
	height++
	finalizeStakeBlock(t, ctx, app, height, unbondTime.Add(6*24*time.Hour), withdraw, false)
	height++
	finalizeStakeBlock(t, ctx, app, height, entry.AvailableAt, withdraw, true)
	queryJSON(t, app, "/staking/unbondings/"+unbondingID, &entry)
	if entry.Status != "withdrawn" || entry.WithdrawnAt == nil {
		t.Fatalf("unbonding was not withdrawn: %+v", entry)
	}
	index, _ := accountIndex(app.committed.Accounts, delegator)
	account := app.committed.Accounts[index]
	if account.Balance != 747 || account.Staked != 250 || account.Nonce != 3 {
		t.Fatalf("unexpected post-withdrawal account: %+v", account)
	}
	if len(app.committed.FeeEvents) != 3 {
		t.Fatalf("staking fees were not transparently recorded: %+v", app.committed.FeeEvents)
	}
	if err := app.committed.Validate(migration); err != nil {
		t.Fatalf("staking supply did not reconcile: %v", err)
	}
	var summary map[string]any
	queryJSON(t, app, "/staking/summary", &summary)
	if summary["yieldGuaranteed"] != false || summary["rewardSource"] != "none_until_governed_issuance_activation" || summary["jailAndSlashing"] != "not_activated_requires_governance_authority" {
		t.Fatalf("staking summary overclaimed capability: %+v", summary)
	}
}

func mustStakingAction(t *testing.T, key *secp256k1.PrivateKey, action string, payload any, nonce uint64) []byte {
	t.Helper()
	tx, err := NewSignedApplicationAction(key, 6423, action, payload, nonce)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func finalizeStakeBlock(t *testing.T, ctx context.Context, app *Application, height int64, blockTime time.Time, raw []byte, expectSuccess bool) {
	t.Helper()
	result, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: [][]byte{raw}})
	if err != nil {
		t.Fatal(err)
	}
	if got := result.TxResults[0].Code == 0; got != expectSuccess {
		t.Fatalf("staking result success=%t expected=%t log=%s", got, expectSuccess, result.TxResults[0].Log)
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
}
