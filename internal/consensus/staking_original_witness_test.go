package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func newABCIStakingWitnessFixture(t *testing.T) *abciRevocationFixture {
	t.Helper()
	f := &abciRevocationFixture{classic: deterministicPrivateKey(193), otherClassic: deterministicPrivateKey(194)}
	f.owner, f.other = mustNativeAddress(t, f.classic), mustNativeAddress(t, f.otherClassic)
	var err error
	// The default revocation fixture has one validator. This source must have
	// two before genesis/history and the migration hash are created; changing
	// an exported checkpoint's validator array would not be a valid fixture.
	f.d, err = chain.NewPersistentDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), t.TempDir(), []chain.Validator{
		{Address: "ynx_validator_0", Moniker: "ynx-staking-witness-0", VotingPower: 1, Active: true},
		{Address: "ynx_validator_1", Moniker: "ynx-staking-witness-1", VotingPower: 1, Active: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, owner := range []string{f.owner, f.other} {
		if _, err = f.d.Faucet(owner, 100); err != nil {
			t.Fatal(err)
		}
	}
	f.d.ProduceBlock()
	if err = f.d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	f.m, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if len(f.m.Validators) != 2 || !f.m.Validators[0].Active || !f.m.Validators[1].Active || f.m.Validators[0].Address == f.m.Validators[1].Address {
		t.Fatal("original staking witness source did not export two distinct active validators")
	}
	f.network, err = hex.DecodeString(f.m.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	f.key, f.public, err = ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(f.key.Destroy)
	f.otherKey, f.otherPublic, err = ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(f.otherKey.Destroy)
	f.path = filepath.Join(t.TempDir(), "staking-witness-state.json")
	f.a, err = NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func legacyStakingOriginalFixture(t *testing.T) (*abciRevocationFixture, [][]byte, time.Time) {
	t.Helper()
	f := newABCIStakingWitnessFixture(t)
	v0, v1 := f.m.Validators[0].Address, f.m.Validators[1].Address
	id := stakingDelegationID(f.owner, v0)
	first := mustStakingAction(t, f.classic, ActionStakeDelegate, StakeDelegatePayload{Validator: v0, AmountYNXT: 20}, 1)
	second := mustStakingAction(t, f.classic, ActionStakeDelegate, StakeDelegatePayload{Validator: v1, AmountYNXT: 10}, 2)
	unbond := mustStakingAction(t, f.classic, ActionStakeUnbond, StakeUnbondPayload{DelegationID: id, AmountYNXT: 7}, 3)
	withdraw := mustStakingAction(t, f.classic, ActionStakeWithdraw, StakeWithdrawPayload{UnbondingID: ApplicationActionRecordID("stake-unbonding", ApplicationActionHash(unbond))}, 4)
	queued := mustStakingAction(t, f.classic, ActionStakeUnbond, StakeUnbondPayload{DelegationID: id, AmountYNXT: 3}, 5)
	start := time.Date(2030, 2, 1, 0, 0, 0, 0, time.UTC)
	pqValidatorStakeBlock(t, f.a, 2, start, first, second)
	pqValidatorStakeBlock(t, f.a, 3, start.Add(time.Second), unbond)
	released := start.Add(time.Second + 7*24*time.Hour)
	pqValidatorStakeBlock(t, f.a, 4, released, withdraw)
	pqValidatorStakeBlock(t, f.a, 5, released.Add(time.Second), queued)
	return f, [][]byte{first, second, unbond, withdraw, queued}, released.Add(time.Second)
}

func TestLegacyStakingOriginalWitnessCompleteCheckpoint(t *testing.T) {
	f, originals, _ := legacyStakingOriginalFixture(t)
	before := mustJSON(t, f.a.committed)
	disk, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	if err = ValidateLegacyStakingOriginals(f.a.committed, f.m, f.owner, originals); err != nil {
		t.Fatalf("actual classic originals rejected: %v", err)
	}
	for _, mode := range []string{"missing", "other-delegation-omitted", "duplicate", "reordered", "signature", "missing-fee", "fee-time", "fee-height", "fee-recipient", "fee-amount", "delegation", "unbonding", "nonce", "no-originals", "wrong-network", "wrong-owner"} {
		t.Run(mode, func(t *testing.T) {
			var state CommittedState
			if err := json.Unmarshal(before, &state); err != nil {
				t.Fatal(err)
			}
			inputs := make([][]byte, len(originals))
			for i := range originals {
				inputs[i] = bytes.Clone(originals[i])
			}
			owner := f.owner
			switch mode {
			case "missing":
				inputs = inputs[:len(inputs)-1]
			case "other-delegation-omitted":
				inputs = append(inputs[:1], inputs[2:]...)
			case "duplicate":
				inputs[1] = inputs[0]
			case "reordered":
				inputs[0], inputs[1] = inputs[1], inputs[0]
			case "signature":
				tx, err := DecodeSignedApplicationAction(inputs[0])
				if err != nil {
					t.Fatal(err)
				}
				tx.Signature = "00"
				inputs[0], _ = json.Marshal(tx)
			case "missing-fee":
				state.FeeEvents = state.FeeEvents[1:]
			case "fee-time":
				state.FeeEvents[0].RecordedAt = state.FeeEvents[0].RecordedAt.Add(time.Nanosecond)
				state.FeeEvents[0].AuditHash = feeEventAuditHash(state.FeeEvents[0])
			case "fee-height":
				state.FeeEvents[0].BlockHeight++
				state.FeeEvents[0].AuditHash = feeEventAuditHash(state.FeeEvents[0])
			case "fee-recipient":
				state.FeeEvents[0].Recipient = f.other
				state.FeeEvents[0].AuditHash = feeEventAuditHash(state.FeeEvents[0])
			case "fee-amount":
				state.FeeEvents[0].GrossFeeYNXT++
				state.FeeEvents[0].AuditHash = feeEventAuditHash(state.FeeEvents[0])
			case "delegation":
				state.StakeDelegations[0].AmountYNXT++
				state.StakeDelegations[0].AuditHash = stakingAuditHash(state.StakeDelegations[0])
			case "unbonding":
				state.Unbondings[0].AmountYNXT++
				state.Unbondings[0].AuditHash = stakingAuditHash(state.Unbondings[0])
			case "nonce":
				i, _ := accountIndex(state.Accounts, f.owner)
				state.Accounts[i].Nonce--
			case "no-originals":
				inputs = nil
			case "wrong-network":
				state.ChainID++
			case "wrong-owner":
				owner = f.other
			}
			if err := ValidateLegacyStakingOriginals(state, f.m, owner, inputs); err == nil {
				t.Fatalf("classic witness accepted %s", mode)
			}
		})
	}
	afterDisk, err := os.ReadFile(f.path)
	if err != nil || !bytes.Equal(disk, afterDisk) || !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatal("pure witness validation changed the original checkpoint")
	}
	for _, record := range f.a.committed.StakeDelegations {
		if record.AuthorizationHistory != "" {
			t.Fatal("classic fixture acquired a new historical field")
		}
	}
}
