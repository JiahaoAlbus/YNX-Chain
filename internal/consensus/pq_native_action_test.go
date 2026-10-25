package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func pqABCIStake(t *testing.T, f *abciRevocationFixture, other bool, amount, nonce, fee uint64) []byte {
	t.Helper()
	key, owner := f.key, f.owner
	if other {
		key, owner = f.otherKey, f.other
	}
	wire := pqABCIContractWire(t, f, key, owner, ynxauth.ActionStake, ynxauth.StakePayload{Amount: amount}, nonce, fee)
	raw, err := EncodePQNativeActionTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestABCIPQNativeStakeRealExecutionHistoryRevocationAndRestart(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)), mustPQEnvelope(t, PQMigrationType, f.registration(t, true, 3)))
	before, feeBefore := queryConsensusAccount(t, f.a, f.owner), queryConsensusAccount(t, f.a, f.a.feeRecipient)
	first := pqABCIStake(t, f, false, 20, 2, 0)
	pqABCIContractBlock(t, f.a, 3, first, pqABCIStake(t, f, true, 7, 2, 0))
	pqABCIContractBlock(t, f.a, 4, pqABCIStake(t, f, false, 5, 3, 0))
	after := queryConsensusAccount(t, f.a, f.owner)
	if after.Balance != before.Balance-25 || after.Staked != before.Staked+25 || after.Nonce != 3 || after.ResourceUsage.ComputeUsed != before.ResourceUsage.ComputeUsed+2 || after.ResourceUsage.BandwidthUsed != before.ResourceUsage.BandwidthUsed || !reflect.DeepEqual(after.Lots, before.Lots) || !reflect.DeepEqual(queryConsensusAccount(t, f.a, f.a.feeRecipient), feeBefore) {
		t.Fatal("native stake changed its actual fee-zero, compute-one, bandwidth-zero or preserved lineage semantics")
	}
	for _, fee := range f.a.committed.FeeEvents {
		if fee.TransactionType == PQActionType {
			t.Fatal("native stake fabricated a fee")
		}
	}
	pqABCIContractRejected(t, f.a, first)
	pqABCIContractBlock(t, f.a, 5, mustPQEnvelope(t, PQRevocationType, f.revocation(t, 4, 5, 1)))
	pqABCIContractRejected(t, f.a, pqABCIStake(t, f, false, 1, 5, 0))
	legacy := ResourceDelegationPayload{Provider: f.owner, Beneficiary: f.owner, AmountYNXT: 1, PolicyHash: f.m.ResourcePolicy.PolicyHash, IdempotencyKey: "revoked-native-classic-fallback"}
	legacy.RequestHash = ResourceDelegationRequestHash(legacy.Provider, legacy.Beneficiary, legacy.AmountYNXT, legacy.PolicyHash, legacy.IdempotencyKey)
	pqABCIContractRejected(t, f.a, mustResourceAction(t, f.classic, ActionResourceDelegate, legacy, 5))
	pqABCIContractBlock(t, f.a, 6, pqABCIStake(t, f, true, 2, 3, 0))
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
		t.Fatalf("historical native stakes were erased by later revocation or restart: %v", err)
	}
	if queryConsensusAccount(t, cold, f.other).Staked != 9 {
		t.Fatal("global v2 policy froze another lawful native owner")
	}
}

func TestABCIPQNativeStakeOriginalANDAndAtomicRejections(t *testing.T) {
	f := newABCIRevocationFixture(t)
	valid := pqABCIStake(t, f, false, 20, 2, 0)
	pqABCIContractRejected(t, f.a, valid)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 4)))
	pqABCIContractRejected(t, f.a, valid) // registration exists but not active at H3
	pqABCIContractBlock(t, f.a, 3)
	wire, _, err := DecodePQNativeActionTransaction(valid)
	if err != nil {
		t.Fatal(err)
	}
	for _, component := range []string{"A", "B"} {
		member, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			t.Fatal(err)
		}
		if component == "A" {
			member.Certificate.SigmaA[0] ^= 1
		} else {
			member.Certificate.SigmaB[0] ^= 1
		}
		bad, err := ynxbatch.EncodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := EncodePQNativeActionTransaction(bad)
		if err != nil {
			t.Fatal(err)
		}
		pqABCIContractRejected(t, f.a, raw)
	}
	for _, raw := range [][]byte{pqABCIStake(t, f, false, 20, 3, 0), pqABCIStake(t, f, false, 20, 2, 1), pqABCIStake(t, f, false, 100, 2, 0), pqABCIStake(t, f, true, 1, 1, 0)} {
		pqABCIContractRejected(t, f.a, raw)
	}
	wrongWire := pqABCIContractWire(t, f, f.otherKey, f.owner, ynxauth.ActionStake, ynxauth.StakePayload{Amount: 20}, 2, 0)
	wrong, err := EncodePQNativeActionTransaction(wrongWire)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractRejected(t, f.a, wrong)
	for _, field := range []string{"stake", "compute", "nonce"} {
		candidate := f.a.cloneExecutionState()
		i, _ := accountIndex(candidate.accounts, f.owner)
		switch field {
		case "stake":
			candidate.accounts[i].Staked = math.MaxInt64
		case "compute":
			candidate.accounts[i].ResourceUsage.ComputeUsed = math.MaxInt64
		case "nonce":
			candidate.accounts[i].Nonce = math.MaxUint64
		}
		accounts, history := mustJSON(t, candidate.accounts), mustJSON(t, candidate.pqHistory)
		if _, _, err := f.a.applyPQNativeAction(candidate, valid, 4, time.Unix(4, 0).UTC()); err == nil {
			t.Fatalf("native stake accepted %s overflow", field)
		}
		if !bytes.Equal(accounts, mustJSON(t, candidate.accounts)) || !bytes.Equal(history, mustJSON(t, candidate.pqHistory)) {
			t.Fatal("rejected native stake modified the original execution candidate")
		}
	}
	pqABCIContractBlock(t, f.a, 4, valid)
}

func TestABCIPQNativeStakeResealedHistoryAndStateTampering(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	pqABCIContractBlock(t, f.a, 3, pqABCIStake(t, f, false, 20, 2, 0))
	for _, mode := range []string{"amount", "owner", "fee", "sponsor", "flow", "compute", "stake", "nonce", "erase-proof", "duplicate", "false-fee"} {
		t.Run(mode, func(t *testing.T) {
			var bad CommittedState
			if err := json.Unmarshal(mustJSON(t, f.a.committed), &bad); err != nil {
				t.Fatal(err)
			}
			entry := &bad.PQHistory[len(bad.PQHistory)-1]
			i, _ := accountIndex(bad.Accounts, f.owner)
			switch mode {
			case "amount":
				entry.Transaction.Amount++
			case "owner":
				entry.Transaction.From = f.other
			case "fee":
				entry.Transaction.Fee = 1
			case "sponsor":
				entry.Transaction.Sponsor = f.other
			case "flow":
				entry.Transaction.LotFlows = []chain.LotFlow{{LotID: "forged", From: f.owner, To: f.other, Amount: 20}}
			case "compute":
				bad.Accounts[i].ResourceUsage.ComputeUsed = 0
			case "stake":
				bad.Accounts[i].Staked--
				bad.Accounts[i].Balance++
			case "nonce":
				bad.Accounts[i].Nonce--
			case "erase-proof":
				bad.PQHistory = bad.PQHistory[:len(bad.PQHistory)-1]
			case "duplicate":
				bad.PQHistory = append(bad.PQHistory, *entry)
			case "false-fee":
				bad.FeeEvents = append(bad.FeeEvents, newCurrentFeeEvent(entry.ABCITransactionHash, PQActionType, f.owner, f.a.feeRecipient, 1, 3, entry.Transaction.Timestamp))
			}
			var err error
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			if err := bad.Validate(f.m); err == nil {
				t.Fatalf("resealed native stake %s survived", mode)
			}
		})
	}
}

func TestABCIPQNativeStakeCommitFailureKeepsOriginalUnknownCandidate(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		t.Run(map[bool]string{false: "before-rename", true: "after-rename"}[afterRename], func(t *testing.T) {
			f := newABCIRevocationFixture(t)
			pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
			raw := pqABCIStake(t, f, false, 20, 2, 0)
			before := mustJSON(t, f.a.committed)
			diskBefore, err := os.ReadFile(f.path)
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			result, err := f.a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{raw}})
			if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
				t.Fatalf("real native stake finalize: %+v %v", result, err)
			}
			pending := mustJSON(t, f.a.pending)
			injected := errors.New("native stake checkpoint failure")
			f.a.persistenceHooks = &committedPersistenceHooks{}
			if afterRename {
				f.a.persistenceHooks.syncDirectory = func(string) error { return injected }
			} else {
				f.a.persistenceHooks.beforeRename = func() error { return injected }
			}
			_, err = f.a.Commit(ctx, &abcitypes.RequestCommit{})
			if !errors.Is(err, injected) || errors.Is(err, ErrCommittedStateDurabilityUncertain) != afterRename || !bytes.Equal(before, mustJSON(t, f.a.committed)) || !bytes.Equal(pending, mustJSON(t, f.a.pending)) {
				t.Fatalf("native stake lost original candidate or UNKNOWN classification: %v", err)
			}
			if _, err := f.a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: 3, Txs: [][]byte{raw}}); err == nil {
				t.Fatal("unresolved original commit allowed a duplicate execution")
			}
			if afterRename {
				cold, err := NewPersistentApplication(f.m, f.path)
				if err != nil || !bytes.Equal(pending, mustJSON(t, cold.committed)) {
					t.Fatalf("cold original native stake candidate lost: %v", err)
				}
			} else {
				disk, err := os.ReadFile(f.path)
				if err != nil || !bytes.Equal(disk, diskBefore) {
					t.Fatal("pre-rename failure changed original disk")
				}
			}
			f.a.persistenceHooks = nil
			if _, err := f.a.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(pending, mustJSON(t, f.a.committed)) {
				t.Fatal("retry changed or reapplied the original authorized stake")
			}
			pqABCIContractRejected(t, f.a, raw)
		})
	}
}
