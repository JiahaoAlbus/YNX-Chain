package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func pqABCIVValidatorStake(t *testing.T, f *abciRevocationFixture, key *ynxbatch.PrivateKey, owner, kind string, payload any, nonce uint64) []byte {
	t.Helper()
	wire := pqABCIContractWire(t, f, key, owner, kind, payload, nonce, 1)
	raw, err := EncodePQNativeActionTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func pqValidatorStakeBlock(t *testing.T, a *Application, height int64, at time.Time, raw ...[]byte) {
	t.Helper()
	before := mustJSON(t, a.committed)
	proposal, err := a.ProcessProposal(context.Background(), &abcitypes.RequestProcessProposal{Height: height, Time: at, Txs: raw})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("real staking proposal: %+v %v", proposal, err)
	}
	if !bytes.Equal(before, mustJSON(t, a.committed)) {
		t.Fatal("staking proposal mutated committed state")
	}
	commitSponsorBlock(t, a, height, at, raw...)
}

func TestABCIPQValidatorStakingImportsSuccessfulClassicOriginals(t *testing.T) {
	f, originals, oldAt := legacyStakingOriginalFixture(t)
	oldFees := mustJSON(t, f.a.committed.FeeEvents)
	oldRecords := mustJSON(t, f.a.committed.StakeDelegations)
	registration := abciRegistrationWire(t, f.classic, nil, f.key, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: f.public.PKA, PKB: f.public.PKB, NewRevision: 1, LedgerNonce: 6, ActivateAt: 7})
	pqValidatorStakeBlock(t, f.a, 6, oldAt.Add(time.Second), mustPQEnvelope(t, PQMigrationType, registration))
	if !bytes.Equal(oldRecords, mustJSON(t, f.a.committed.StakeDelegations)) {
		t.Fatal("account migration rewrote opaque classic staking records")
	}
	queuedID := ApplicationActionRecordID("stake-unbonding", ApplicationActionHash(originals[4]))
	firstWire := pqABCIContractWire(t, f, f.key, f.owner, ynxauth.ActionStakeWithdraw, ynxauth.StakeWithdrawPayload{UnbondingID: queuedID}, 7, 1)
	without, err := EncodePQStakingActionTransaction(firstWire, nil)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractRejected(t, f.a, without)
	pqABCIContractRejected(t, f.a, mustStakingAction(t, f.classic, ActionStakeWithdraw, StakeWithdrawPayload{UnbondingID: queuedID}, 7))
	partial, err := EncodePQStakingActionTransaction(firstWire, originals[:len(originals)-1])
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractRejected(t, f.a, partial)
	first, err := EncodePQStakingActionTransaction(firstWire, originals)
	if err != nil {
		t.Fatal(err)
	}
	check, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: first})
	if err != nil || check.Code != 0 {
		t.Fatalf("PQ_CLASSIC_STAKING_ORIGINAL_WITNESS_MISSING: actual original-backed withdrawal rejected: %+v %v", check, err)
	}
	release := oldAt.Add(7 * 24 * time.Hour)
	pqValidatorStakeBlock(t, f.a, 7, release, first)
	if !bytes.Equal(oldFees, mustJSON(t, f.a.committed.FeeEvents[:len(originals)])) {
		t.Fatal("original witness charged or changed an old successful fee")
	}
	if err = ValidateLegacyStakingOriginals(f.a.committed, f.m, f.owner, originals); err != nil {
		t.Fatalf("first imported record lost the other original delegation: %v", err)
	}
	secondID := stakingDelegationID(f.owner, f.m.Validators[1].Address)
	secondWire := pqABCIContractWire(t, f, f.key, f.owner, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: secondID, AmountYNXT: 4}, 8, 1)
	second, err := EncodePQStakingActionTransaction(secondWire, originals)
	if err != nil {
		t.Fatal(err)
	}
	secondAt := release.Add(time.Second)
	pqValidatorStakeBlock(t, f.a, 8, secondAt, second)
	more := pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: f.m.Validators[0].Address, AmountYNXT: 2}, 9)
	moreWire, _, err := DecodePQNativeActionTransaction(more)
	if err != nil {
		t.Fatal(err)
	}
	redundant, err := EncodePQStakingActionTransaction(moreWire, originals)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractRejected(t, f.a, redundant)
	pqValidatorStakeBlock(t, f.a, 9, secondAt.Add(time.Second), more)
	withdraw := pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeWithdraw, ynxauth.StakeWithdrawPayload{UnbondingID: ApplicationActionRecordID("stake-unbonding", SignedTransactionHash(second))}, 10)
	secondRelease := secondAt.Add(7 * 24 * time.Hour)
	before := queryConsensusAccount(t, f.a, f.owner)
	finalizeStakeBlock(t, context.Background(), f.a, 10, secondRelease.Add(-time.Nanosecond), withdraw, false)
	if !reflect.DeepEqual(before, queryConsensusAccount(t, f.a, f.owner)) {
		t.Fatal("original-backed premature withdrawal consumed fee, nonce or funds")
	}
	pqValidatorStakeBlock(t, f.a, 11, secondRelease, withdraw)
	account := queryConsensusAccount(t, f.a, f.owner)
	if account.Balance != 72 || account.Staked != 18 || account.Nonce != 10 || account.ResourceUsage.BandwidthUsed != 10 {
		t.Fatalf("classic/PQ staking funds were charged or restored twice: %+v", account)
	}
	pqValidatorStakeBlock(t, f.a, 12, secondRelease.Add(time.Second), mustPQEnvelope(t, PQRevocationType, f.revocation(t, 11, 12, 1)))
	pqABCIContractRejected(t, f.a, pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: secondID, AmountYNXT: 1}, 12))
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
		t.Fatalf("original-backed staking cold restore changed checkpoint: %v", err)
	}
	for _, entry := range cold.committed.PQHistory {
		if !isPQStakingHistory(entry.Transaction) {
			continue
		}
		view, err := pqActionHistoryView(cold.committed, f.m, entry.Transaction.Hash)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err = ValidatePQActionHistoryView(view, 12); err != nil {
			t.Fatalf("mixed original query did not preserve historical authority: %v", err)
		}
	}
	// A self-consistently rehashed optional history is still checked against
	// exact old successful fees and all original classic signatures.
	for _, mode := range []string{"drop-classic", "fee-time", "original-bytes", "queued", "erase-original-fee"} {
		t.Run(mode, func(t *testing.T) {
			var bad CommittedState
			if err := json.Unmarshal(mustJSON(t, cold.committed), &bad); err != nil {
				t.Fatal(err)
			}
			i, _ := stakingDelegationIndex(bad.StakeDelegations, stakingDelegationID(f.owner, f.m.Validators[0].Address))
			switch mode {
			case "drop-classic", "original-bytes":
				events, _ := decodeStakingAuthorizations(bad.StakeDelegations[i].AuthorizationHistory)
				var envelope PQStakingActionTransaction
				if err := json.Unmarshal(events[0].Transport, &envelope); err != nil {
					t.Fatal(err)
				}
				if mode == "drop-classic" {
					envelope.Originals = envelope.Originals[:len(envelope.Originals)-1]
				} else {
					tx, _ := DecodeSignedApplicationAction(envelope.Originals[0])
					tx.Signature = "00"
					envelope.Originals[0], _ = json.Marshal(tx)
				}
				events[0].Transport, _ = json.Marshal(envelope)
				encoded, _ := json.Marshal(events)
				bad.StakeDelegations[i].AuthorizationHistory = string(encoded)
				bad.StakeDelegations[i].AuditHash = stakingAuditHash(bad.StakeDelegations[i])
			case "fee-time":
				bad.FeeEvents[0].RecordedAt = bad.FeeEvents[0].RecordedAt.Add(time.Second)
				bad.FeeEvents[0].AuditHash = feeEventAuditHash(bad.FeeEvents[0])
			case "queued":
				bad.Unbondings[0].AmountYNXT++
				bad.Unbondings[0].AuditHash = stakingAuditHash(bad.Unbondings[0])
			case "erase-original-fee":
				bad.FeeEvents = bad.FeeEvents[1:]
			}
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			if err = bad.Validate(f.m); err == nil {
				t.Fatalf("resealed classic witness %s survived cold validation", mode)
			}
		})
	}
}

// The original 7c5 applyPQActionTransaction dispatcher may be substituted by CI
// while retaining current codec definitions. Its actual CheckTx rejects this
// signed delegation with the marker below; no compilation failure is a RED.
func TestABCIPQValidatorStakingMigratedOwnerLifecycle(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	validator := f.m.Validators[0].Address
	classic := mustStakingAction(t, f.classic, ActionStakeDelegate, StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 2)
	pqABCIContractRejected(t, f.a, classic)
	delegate := pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 2)
	check, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: delegate})
	if err != nil || check.Code != 0 {
		t.Fatalf("PQ_VALIDATOR_STAKING_TYPED_ENTRY_MISSING: actual migrated owner delegation CheckTx: %+v %v", check, err)
	}
	start := time.Date(2030, 1, 1, 0, 0, 3, 0, time.UTC)
	otherDelegate := mustStakingAction(t, f.otherClassic, ActionStakeDelegate, StakeDelegatePayload{Validator: validator, AmountYNXT: 10}, 1)
	pqValidatorStakeBlock(t, f.a, 3, start, delegate, otherDelegate)
	id, otherID := stakingDelegationID(f.owner, validator), stakingDelegationID(f.other, validator)
	unbond := pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: id, AmountYNXT: 7}, 3)
	otherUnbond := mustStakingAction(t, f.otherClassic, ActionStakeUnbond, StakeUnbondPayload{DelegationID: otherID, AmountYNXT: 4}, 2)
	unbondAt := start.Add(time.Second)
	pqValidatorStakeBlock(t, f.a, 4, unbondAt, unbond, otherUnbond)
	unbondID := ApplicationActionRecordID("stake-unbonding", SignedTransactionHash(unbond))
	otherUnbondID := ApplicationActionRecordID("stake-unbonding", ApplicationActionHash(otherUnbond))
	withdraw := pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeWithdraw, ynxauth.StakeWithdrawPayload{UnbondingID: unbondID}, 4)
	available := unbondAt.Add(7 * 24 * time.Hour)
	before := queryConsensusAccount(t, f.a, f.owner)
	beforeHistory, beforeFees := mustJSON(t, f.a.committed.PQHistory), mustJSON(t, f.a.committed.FeeEvents)
	proposal, err := f.a.ProcessProposal(context.Background(), &abcitypes.RequestProcessProposal{Height: 5, Time: available.Add(-time.Nanosecond), Txs: [][]byte{withdraw}})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_REJECT {
		t.Fatal("seven-day release was bypassed in ProcessProposal")
	}
	finalizeStakeBlock(t, context.Background(), f.a, 5, available.Add(-time.Nanosecond), withdraw, false)
	if !reflect.DeepEqual(before, queryConsensusAccount(t, f.a, f.owner)) || !bytes.Equal(beforeHistory, mustJSON(t, f.a.committed.PQHistory)) || !bytes.Equal(beforeFees, mustJSON(t, f.a.committed.FeeEvents)) {
		t.Fatal("premature withdrawal consumed funds, fee, nonce or proof")
	}
	pqValidatorStakeBlock(t, f.a, 6, available, withdraw, mustStakingAction(t, f.otherClassic, ActionStakeWithdraw, StakeWithdrawPayload{UnbondingID: otherUnbondID}, 3))
	account := queryConsensusAccount(t, f.a, f.owner)
	if account.Balance != 83 || account.Staked != 13 || account.Nonce != 4 || account.ResourceUsage.BandwidthUsed != 4 || account.ResourceUsage.ComputeUsed != 0 {
		t.Fatalf("staking changed original fee/nonce/BW rules: %+v", account)
	}
	for _, entry := range f.a.committed.PQHistory {
		if !isPQStakingHistory(entry.Transaction) {
			continue
		}
		view, err := pqActionHistoryView(f.a.committed, f.m, entry.Transaction.Hash)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err = ValidatePQActionHistoryView(view, 6); err != nil {
			t.Fatal(err)
		}
		if len(entry.Transaction.LotFlows) == 0 || entry.Transaction.Fee != 1 {
			t.Fatal("staking fee lacks actual lot movement")
		}
	}
	i, _ := stakingDelegationIndex(f.a.committed.StakeDelegations, otherID)
	if f.a.committed.StakeDelegations[i].AuthorizationHistory != "" {
		t.Fatal("classic staking changed its old serialized effect")
	}
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
		t.Fatalf("staking cold restore lost complete original state: %v", err)
	}
	// A pending rotation and its terminal cancellation leave the H3/H4/H6
	// originals valid at their actual heights, but close H8/current authority.
	newKey, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(newKey.Destroy)
	rotation := abciRegistrationWire(t, nil, f.key, newKey, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 5, ActivateAt: 9})
	pqValidatorStakeBlock(t, f.a, 7, available.Add(time.Second), mustPQEnvelope(t, PQMigrationType, rotation), mustPQEnvelope(t, PQRevocationType, f.revocation(t, 6, 7, 2)))
	pqABCIContractRejected(t, f.a, pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: validator, AmountYNXT: 1}, 7))
	pqABCIContractRejected(t, f.a, pqABCIVValidatorStake(t, f, newKey, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: validator, AmountYNXT: 1}, 7))
	pqABCIContractRejected(t, f.a, mustStakingAction(t, f.classic, ActionStakeDelegate, StakeDelegatePayload{Validator: validator, AmountYNXT: 1}, 7))
	pqValidatorStakeBlock(t, f.a, 8, available.Add(2*time.Second), mustStakingAction(t, f.otherClassic, ActionStakeDelegate, StakeDelegatePayload{Validator: validator, AmountYNXT: 2}, 4))
	cold, err = NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
		t.Fatalf("revocation erased historical staking authorization: %v", err)
	}
	for _, entry := range cold.committed.PQHistory {
		if isPQStakingHistory(entry.Transaction) {
			if _, err := pqActionHistoryView(cold.committed, f.m, entry.Transaction.Hash); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestABCIPQValidatorStakingOriginalANDAtomicBoundaries(t *testing.T) {
	f := newABCIRevocationFixture(t)
	validator := f.m.Validators[0].Address
	valid := pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 2)
	pqABCIContractRejected(t, f.a, valid)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 4)))
	pqABCIContractRejected(t, f.a, valid)
	pqABCIContractBlock(t, f.a, 3)
	wire, action, err := DecodePQNativeActionTransaction(valid)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{"A", "B"} {
		member, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			t.Fatal(err)
		}
		if part == "A" {
			member.Certificate.SigmaA[0] ^= 1
		} else {
			member.Certificate.SigmaB[0] ^= 1
		}
		badWire, err := ynxbatch.EncodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
		bad, err := EncodePQNativeActionTransaction(badWire)
		if err != nil {
			t.Fatal(err)
		}
		pqABCIContractRejected(t, f.a, bad)
	}
	for _, p := range []ynxauth.StakeDelegatePayload{{Validator: "unknown-validator", AmountYNXT: 1}, {Validator: validator, AmountYNXT: 100}} {
		pqABCIContractRejected(t, f.a, pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeDelegate, p, 2))
	}
	pqABCIContractRejected(t, f.a, pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 3))
	pqABCIContractRejected(t, f.a, pqABCIVValidatorStake(t, f, f.otherKey, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 2))
	action.ChainID = bytes.Repeat([]byte{0x45}, 32)
	message, err := action.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	_, wrongWire := consensusPQProof(t, f.key, action.ChainID, f.owner, ynxauth.TransactionPurpose, message)
	wrong, err := EncodePQNativeActionTransaction(wrongWire)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractRejected(t, f.a, wrong)
	for _, field := range []string{"nonce", "bandwidth", "staked", "fee-recipient"} {
		s := f.a.cloneExecutionState()
		i, _ := accountIndex(s.accounts, f.owner)
		switch field {
		case "nonce":
			s.accounts[i].Nonce = math.MaxUint64
		case "bandwidth":
			s.accounts[i].ResourceUsage.BandwidthUsed = math.MaxInt64
		case "staked":
			s.accounts[i].Staked = math.MaxInt64
		case "fee-recipient":
			j, _ := accountIndex(s.accounts, f.a.feeRecipient)
			s.accounts[j].Balance = math.MaxInt64
		}
		before := mustJSON(t, s.accounts)
		if _, _, err := f.a.applyPQStakingAction(s, valid, 4, time.Unix(4, 0).UTC()); err == nil {
			t.Fatalf("staking accepted %s overflow", field)
		}
		if !bytes.Equal(before, mustJSON(t, s.accounts)) {
			t.Fatal("failed staking changed original detached candidate")
		}
	}
	pqABCIContractBlock(t, f.a, 4, valid)
	pqABCIContractRejected(t, f.a, valid)
	// Another migrated owner cannot spend this delegation or its unbonding.
	pqABCIContractBlock(t, f.a, 5, mustPQEnvelope(t, PQMigrationType, f.registration(t, true, 6)))
	id := stakingDelegationID(f.owner, validator)
	pqABCIContractRejected(t, f.a, pqABCIVValidatorStake(t, f, f.otherKey, f.other, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: id, AmountYNXT: 1}, 2))
	pqABCIContractRejected(t, f.a, pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: id, AmountYNXT: 21}, 3))
}

func TestABCIPQValidatorStakingResealedHistoryAndOpaqueLegacy(t *testing.T) {
	f := newABCIRevocationFixture(t)
	validator := f.m.Validators[0].Address
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	pqABCIContractBlock(t, f.a, 3, pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 2))
	id := stakingDelegationID(f.owner, validator)
	pqABCIContractBlock(t, f.a, 4, pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: id, AmountYNXT: 7}, 3))
	for _, mode := range []string{"erase-proof", "erase-history", "nonce", "balance", "amount", "available", "withdrawn", "history-time", "signature", "fee", "flow", "resource"} {
		t.Run(mode, func(t *testing.T) {
			var bad CommittedState
			if err := json.Unmarshal(mustJSON(t, f.a.committed), &bad); err != nil {
				t.Fatal(err)
			}
			i, _ := stakingDelegationIndex(bad.StakeDelegations, id)
			ai, _ := accountIndex(bad.Accounts, f.owner)
			switch mode {
			case "erase-proof":
				bad.PQHistory = bad.PQHistory[:len(bad.PQHistory)-1]
			case "erase-history":
				bad.StakeDelegations[i].AuthorizationHistory = ""
			case "nonce":
				bad.Accounts[ai].Nonce--
			case "balance":
				bad.Accounts[ai].Balance++
			case "amount":
				bad.StakeDelegations[i].AmountYNXT++
				bad.Accounts[ai].Staked++
				bad.Accounts[ai].Balance--
			case "available":
				bad.Unbondings[0].AvailableAt = bad.Unbondings[0].AvailableAt.Add(-time.Second)
			case "withdrawn":
				now := bad.Unbondings[0].AvailableAt
				bad.Unbondings[0].Status, bad.Unbondings[0].WithdrawnAt = "withdrawn", &now
				bad.Accounts[ai].Balance += 7
			case "history-time", "signature":
				values, err := decodeStakingAuthorizations(bad.StakeDelegations[i].AuthorizationHistory)
				if err != nil {
					t.Fatal(err)
				}
				if mode == "history-time" {
					values[0].At = values[0].At.Add(time.Second)
				} else {
					values[0].Transport[len(values[0].Transport)/2] ^= 1
				}
				bad.StakeDelegations[i].AuthorizationHistory = string(mustJSON(t, values))
			case "fee":
				bad.FeeEvents[len(bad.FeeEvents)-1].GrossFeeYNXT++
			case "flow":
				bad.PQHistory[len(bad.PQHistory)-1].Transaction.LotFlows[0].To = f.other
			case "resource":
				bad.Accounts[ai].ResourceUsage.BandwidthUsed = 0
			}
			for j := range bad.StakeDelegations {
				bad.StakeDelegations[j].AuditHash = stakingAuditHash(bad.StakeDelegations[j])
			}
			for j := range bad.Unbondings {
				bad.Unbondings[j].AuditHash = stakingAuditHash(bad.Unbondings[j])
			}
			var err error
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			if err = bad.Validate(f.m); err == nil {
				t.Fatalf("resealed staking %s survived", mode)
			}
		})
	}
	legacy := newABCIRevocationFixture(t)
	pqABCIContractBlock(t, legacy.a, 2, mustStakingAction(t, legacy.classic, ActionStakeDelegate, StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 1))
	if legacy.a.committed.StakeDelegations[0].AuthorizationHistory != "" {
		t.Fatal("classic original effect/hash changed")
	}
	registration := abciRegistrationWire(t, legacy.classic, nil, legacy.key, ynxauth.RegistrationIntent{ChainID: legacy.network, Owner: legacy.owner, PKA: legacy.public.PKA, PKB: legacy.public.PKB, NewRevision: 1, LedgerNonce: 2, ActivateAt: 4})
	pqABCIContractBlock(t, legacy.a, 3, mustPQEnvelope(t, PQMigrationType, registration))
	legacyID := stakingDelegationID(legacy.owner, validator)
	pqABCIContractRejected(t, legacy.a, pqABCIVValidatorStake(t, legacy, legacy.key, legacy.owner, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: legacyID, AmountYNXT: 1}, 3))
	cold, err := NewPersistentApplication(legacy.m, legacy.path)
	if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, legacy.a.committed)) {
		t.Fatalf("opaque legacy preservation failed: %v", err)
	}
}

func TestABCIPQValidatorStakingCommitUnknownKeepsOriginal(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		t.Run(map[bool]string{false: "before-rename", true: "after-rename"}[afterRename], func(t *testing.T) {
			f := newABCIRevocationFixture(t)
			pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
			raw := pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: f.m.Validators[0].Address, AmountYNXT: 20}, 2)
			before := mustJSON(t, f.a.committed)
			disk, err := os.ReadFile(f.path)
			if err != nil {
				t.Fatal(err)
			}
			out, err := f.a.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{raw}})
			if err != nil || out.TxResults[0].Code != 0 {
				t.Fatalf("staking finalize: %+v %v", out, err)
			}
			pending := mustJSON(t, f.a.pending)
			injected := errors.New("staking checkpoint fault")
			f.a.persistenceHooks = &committedPersistenceHooks{}
			if afterRename {
				f.a.persistenceHooks.syncDirectory = func(string) error { return injected }
			} else {
				f.a.persistenceHooks.beforeRename = func() error { return injected }
			}
			_, err = f.a.Commit(context.Background(), &abcitypes.RequestCommit{})
			if !errors.Is(err, injected) || errors.Is(err, ErrCommittedStateDurabilityUncertain) != afterRename || !bytes.Equal(before, mustJSON(t, f.a.committed)) || !bytes.Equal(pending, mustJSON(t, f.a.pending)) {
				t.Fatalf("staking lost original commit/UNKNOWN: %v", err)
			}
			if afterRename {
				cold, err := NewPersistentApplication(f.m, f.path)
				if err != nil || !bytes.Equal(pending, mustJSON(t, cold.committed)) {
					t.Fatalf("staking UNKNOWN cold restore: %v", err)
				}
			} else {
				current, err := os.ReadFile(f.path)
				if err != nil || !bytes.Equal(disk, current) {
					t.Fatal("pre-rename failure changed original checkpoint")
				}
			}
			f.a.persistenceHooks = nil
			if _, err := f.a.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(pending, mustJSON(t, f.a.committed)) {
				t.Fatal("original commit retry reexecuted staking")
			}
			pqABCIContractRejected(t, f.a, raw)
		})
	}
}

func TestABCIPQValidatorStakingAllPersistenceLayouts(t *testing.T) {
	f := newABCIRevocationFixture(t)
	registration := mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3))
	delegate := pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: f.m.Validators[0].Address, AmountYNXT: 20}, 2)
	id := stakingDelegationID(f.owner, f.m.Validators[0].Address)
	unbond := pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: id, AmountYNXT: 7}, 3)
	unbondID := ApplicationActionRecordID("stake-unbonding", SignedTransactionHash(unbond))
	withdraw := pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeWithdraw, ynxauth.StakeWithdrawPayload{UnbondingID: unbondID}, 4)
	var expected []byte
	for _, layout := range []struct {
		name string
		open func(chain.ConsensusMigrationState, string) (*Application, error)
	}{{"atomic", NewPersistentApplication}, {"snapshot-journal", NewJournaledApplication}, {"block-journal", NewBlockJournaledApplication}} {
		t.Run(layout.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state")
			app, err := layout.open(f.m, path)
			if err != nil {
				t.Fatal(err)
			}
			commitSponsorBlock(t, app, 2, time.Unix(2, 0).UTC(), registration)
			commitSponsorBlock(t, app, 3, time.Unix(3, 0).UTC(), delegate)
			commitSponsorBlock(t, app, 4, time.Unix(4, 0).UTC(), unbond)
			queued, err := layout.open(f.m, path)
			if err != nil || !bytes.Equal(mustJSON(t, queued.committed), mustJSON(t, app.committed)) {
				t.Fatalf("queued staking restore: %v", err)
			}
			commitSponsorBlock(t, app, 5, time.Unix(4+StakingUnbondingSeconds, 0).UTC(), withdraw)
			actual := mustJSON(t, app.committed)
			if expected == nil {
				expected = actual
			} else if !bytes.Equal(expected, actual) {
				t.Fatal("layout changed complete staking state/hash")
			}
			cold, err := layout.open(f.m, path)
			if err != nil || !bytes.Equal(actual, mustJSON(t, cold.committed)) {
				t.Fatalf("withdrawn staking restore: %v", err)
			}
			if layout.name == "atomic" {
				pqABCIContractRejected(t, cold, delegate)
				return
			}
			// Journal files are framed snapshots/requests, not an atomic JSON
			// checkpoint. Compare their actual bytes and file inventory rather
			// than decoding the base file as the already-replayed tip state.
			root := filepath.Dir(path)
			readFiles := func() (map[string][]byte, map[string]os.FileInfo) {
				t.Helper()
				entries, err := os.ReadDir(root)
				if err != nil {
					t.Fatal(err)
				}
				data, info := map[string][]byte{}, map[string]os.FileInfo{}
				for _, entry := range entries {
					name := filepath.Join(root, entry.Name())
					meta, err := os.Lstat(name)
					if err != nil || !meta.Mode().IsRegular() {
						t.Fatalf("unexpected journal persistence object %q: %v", entry.Name(), err)
					}
					data[entry.Name()], err = os.ReadFile(name)
					if err != nil {
						t.Fatal(err)
					}
					info[entry.Name()] = meta
				}
				return data, info
			}
			beforeFiles, beforeInfo := readFiles()
			beforeState, beforePending := mustJSON(t, cold.committed), mustJSON(t, cold.pending)
			result, err := cold.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: delegate})
			if err != nil || result.Code == 0 || !bytes.Equal(beforeState, mustJSON(t, cold.committed)) || !bytes.Equal(beforePending, mustJSON(t, cold.pending)) {
				t.Fatalf("replayed staking changed complete committed/pending state: %+v %v", result, err)
			}
			afterFiles, afterInfo := readFiles()
			if !reflect.DeepEqual(beforeFiles, afterFiles) {
				t.Fatal("rejected staking changed journal bytes or persistence file inventory")
			}
			for name, before := range beforeInfo {
				after := afterInfo[name]
				if !os.SameFile(before, after) || before.Size() != after.Size() || before.Mode() != after.Mode() || !before.ModTime().Equal(after.ModTime()) {
					t.Fatalf("rejected staking replaced or rewrote journal object %q", name)
				}
			}
			reopened, err := layout.open(f.m, path)
			if err != nil || !bytes.Equal(actual, mustJSON(t, reopened.committed)) {
				t.Fatalf("post-rejection journal cold replay lost exact tip, accounts, nonce or original history: %v", err)
			}
		})
	}
}

func TestABCIPQValidatorStakingFullMemberAndEffectiveRotation(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	validator := f.m.Validators[0].Address
	var messages [][]byte
	for i, amount := range []uint64{20, 3} {
		payload, err := ynxauth.EncodeActionPayload(ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: validator, AmountYNXT: amount})
		if err != nil {
			t.Fatal(err)
		}
		message, err := (ynxauth.Action{ChainID: f.network, NativeChainID: uint64(f.m.Network.ChainID), Owner: f.owner, Kind: ynxauth.ActionStakeDelegate, Payload: payload, Nonce: uint64(i + 2), Fee: 1}).SigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		messages = append(messages, message)
	}
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	var raws [][]byte
	for i := range messages {
		member, err := ynxbatch.Extract(batch, uint32(i))
		if err != nil {
			t.Fatal(err)
		}
		wire, err := ynxbatch.EncodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := EncodePQNativeActionTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		raws = append(raws, raw)
	}
	pqABCIContractBlock(t, f.a, 3, raws...)
	next, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(next.Destroy)
	rotation := abciRegistrationWire(t, nil, f.key, next, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 4, ActivateAt: 6})
	pqABCIContractBlock(t, f.a, 4, mustPQEnvelope(t, PQMigrationType, rotation))
	pqABCIContractRejected(t, f.a, pqABCIVValidatorStake(t, f, next, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: validator, AmountYNXT: 2}, 5))
	pqABCIContractBlock(t, f.a, 5, pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: validator, AmountYNXT: 2}, 5))
	id := stakingDelegationID(f.owner, validator)
	pqABCIContractRejected(t, f.a, pqABCIVValidatorStake(t, f, f.key, f.owner, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: id, AmountYNXT: 7}, 6))
	unbond := pqABCIVValidatorStake(t, f, next, f.owner, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: id, AmountYNXT: 7}, 6)
	pqABCIContractBlock(t, f.a, 6, unbond)
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
		t.Fatalf("full Member or historical rotation lost at restart: %v", err)
	}
	for _, entry := range cold.committed.PQHistory {
		if isPQStakingHistory(entry.Transaction) {
			if _, err := pqActionHistoryView(cold.committed, f.m, entry.Transaction.Hash); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestClassicValidatorStakingOriginalEffectAndHashCompatibility(t *testing.T) {
	f := newABCIRevocationFixture(t)
	validator := f.m.Validators[0].Address
	delegate := mustStakingAction(t, f.classic, ActionStakeDelegate, StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 1)
	id := stakingDelegationID(f.owner, validator)
	unbond := mustStakingAction(t, f.classic, ActionStakeUnbond, StakeUnbondPayload{DelegationID: id, AmountYNXT: 7}, 2)
	unbondID := ApplicationActionRecordID("stake-unbonding", ApplicationActionHash(unbond))
	withdraw := mustStakingAction(t, f.classic, ActionStakeWithdraw, StakeWithdrawPayload{UnbondingID: unbondID}, 3)
	for i, raw := range [][]byte{delegate, unbond, withdraw} {
		height, at := int64(i+2), time.Unix(int64(i+2), 0).UTC()
		if i == 2 {
			at = time.Unix(3+StakingUnbondingSeconds, 0).UTC()
		}
		tx, err := DecodeSignedApplicationAction(raw)
		if err != nil {
			t.Fatal(err)
		}
		if err = tx.Verify(f.m.Network.ChainID); err != nil {
			t.Fatal(err)
		}
		if err = requireConsensusLegacy(f.a.committed.AccountPolicy, tx.Signer, height); err != nil {
			t.Fatal(err)
		}
		old, oldExecution, err := f.a.legacy7c5ApplyStakingAction(f.a.cloneExecutionState(), raw, tx, height, at, false)
		if err != nil {
			t.Fatal(err)
		}
		current, currentExecution, err := f.a.applyStakingAction(f.a.cloneExecutionState(), raw, tx, height, at, false)
		if err != nil || !reflect.DeepEqual(old, current) || !reflect.DeepEqual(oldExecution, currentExecution) {
			t.Fatalf("original classic effect changed: %v", err)
		}
		old.feeEvents = old.feeEvents.append(newCurrentFeeEvent(ApplicationActionHash(raw), tx.Action, tx.Signer, f.a.feeRecipient, tx.Fee, height, at))
		expected, err := sealCommittedState(f.m, height, old)
		if err != nil {
			t.Fatal(err)
		}
		commitSponsorBlock(t, f.a, height, at, raw)
		if !bytes.Equal(mustJSON(t, expected), mustJSON(t, f.a.committed)) {
			t.Fatal("normal classic ABCI path changed original serialized checkpoint")
		}
		// The exact old/new documents must hash identically in each existing
		// domain. This is serialization compatibility, not fabricated 19/20
		// registry authority or a claim that these copied domains can be loaded.
		for version := 7; version <= 20; version++ {
			a, b := expected, f.a.committed
			a.Version, b.Version = version, version
			ah, err := a.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			bh, err := b.calculateHash()
			if err != nil || ah != bh {
				t.Fatalf("classic V%d hash changed: %v", version, err)
			}
		}
	}
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
		t.Fatalf("classic unchanged checkpoint cold restore: %v", err)
	}
}

// Frozen verbatim executor from 7c5e2889df10741467c53d06bd093ef77325e24c,
// renamed only. It is the compatibility oracle for old classic journal effects.
func (a *Application) legacy7c5ApplyStakingAction(state executionState, raw []byte, tx SignedApplicationAction, height int64, blockTime time.Time, validationOnly bool) (executionState, transactionExecution, error) {
	if err := a.chargeApplicationAction(&state, tx); err != nil {
		return executionState{}, transactionExecution{}, err
	}
	txHash, recordID := ApplicationActionHash(raw), ""
	switch tx.Action {
	case ActionStakeDelegate:
		var input StakeDelegatePayload
		_ = json.Unmarshal(tx.Payload, &input)
		if !a.activeValidator(input.Validator) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("staking validator is not active in the migration validator set"))
		}
		accountIndex, ok := accountIndex(state.accounts, tx.Signer)
		if !ok || state.accounts[accountIndex].Balance < input.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient liquid YNXT for delegation after fee"))
		}
		if state.accounts[accountIndex].Staked > math.MaxInt64-input.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("staked balance overflow"))
		}
		state.accounts[accountIndex].Balance -= input.AmountYNXT
		state.accounts[accountIndex].Staked += input.AmountYNXT
		recordID = stakingDelegationID(tx.Signer, input.Validator)
		index, found := stakingDelegationIndex(state.stakeDelegations, recordID)
		if found {
			record := state.stakeDelegations[index]
			if record.AmountYNXT > math.MaxInt64-input.AmountYNXT {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("delegation amount overflow"))
			}
			record.AmountYNXT += input.AmountYNXT
			record.Status = "active"
			record.UpdatedAt = blockTime
			record.BlockHeight = height
			record.TxHash = txHash
			record.AuditHash = ""
			record.AuditHash = stakingAuditHash(record)
			state.stakeDelegations[index] = record
		} else {
			record := BFTStakeDelegation{ID: recordID, Delegator: tx.Signer, Validator: input.Validator, AmountYNXT: input.AmountYNXT, CommissionBPS: StakingCommissionBPS, RewardSource: "none_until_governed_issuance_activation", Status: "active", CreatedAt: blockTime, UpdatedAt: blockTime, BlockHeight: height, TxHash: txHash}
			record.AuditHash = stakingAuditHash(record)
			state.stakeDelegations = insertStakeDelegation(state.stakeDelegations, record)
		}
	case ActionStakeUnbond:
		var input StakeUnbondPayload
		_ = json.Unmarshal(tx.Payload, &input)
		index, ok := stakingDelegationIndex(state.stakeDelegations, input.DelegationID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("staking delegation not found"))
		}
		record := state.stakeDelegations[index]
		if record.Delegator != tx.Signer || record.AmountYNXT < input.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unbond exceeds signer-owned delegation"))
		}
		accountIndex, ok := accountIndex(state.accounts, tx.Signer)
		if !ok || state.accounts[accountIndex].Staked < input.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("delegator staked balance is inconsistent"))
		}
		state.accounts[accountIndex].Staked -= input.AmountYNXT
		record.AmountYNXT -= input.AmountYNXT
		if record.AmountYNXT == 0 {
			record.Status = "unbonded"
		}
		record.UpdatedAt = blockTime
		record.BlockHeight = height
		record.TxHash = txHash
		record.AuditHash = ""
		record.AuditHash = stakingAuditHash(record)
		state.stakeDelegations[index] = record
		recordID = ApplicationActionRecordID("stake-unbonding", txHash)
		entry := BFTUnbondingEntry{ID: recordID, DelegationID: record.ID, Delegator: tx.Signer, Validator: record.Validator, AmountYNXT: input.AmountYNXT, Status: "queued", RequestedAt: blockTime, AvailableAt: blockTime.Add(time.Duration(StakingUnbondingSeconds) * time.Second), BlockHeight: height, TxHash: txHash}
		entry.AuditHash = stakingAuditHash(entry)
		state.unbondings = insertUnbonding(state.unbondings, entry)
	case ActionStakeWithdraw:
		var input StakeWithdrawPayload
		_ = json.Unmarshal(tx.Payload, &input)
		index, ok := unbondingIndex(state.unbondings, input.UnbondingID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unbonding entry not found"))
		}
		entry := state.unbondings[index]
		if entry.Delegator != tx.Signer || entry.Status != "queued" {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unbonding entry is not withdrawable by signer"))
		}
		if !validationOnly && blockTime.Before(entry.AvailableAt) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unbonding entry is not yet available"))
		}
		accountIndex, _ := accountIndex(state.accounts, tx.Signer)
		if state.accounts[accountIndex].Balance > math.MaxInt64-entry.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("withdrawal balance overflow"))
		}
		state.accounts[accountIndex].Balance += entry.AmountYNXT
		now := blockTime
		entry.Status = "withdrawn"
		entry.WithdrawnAt = &now
		entry.BlockHeight = height
		entry.TxHash = txHash
		entry.AuditHash = ""
		entry.AuditHash = stakingAuditHash(entry)
		state.unbondings[index] = entry
		recordID = entry.ID
	}
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.staking", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}, {Key: "record_id", Value: recordID, Index: true}}}}, nil
}
