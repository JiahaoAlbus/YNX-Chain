package main_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// PUBLIC/CONTROLLED fixture only: HTTP source, Wallet publisher, original
// results and temporary PQ keys are local test services, not product admission.
func withdrawalRequest(f *participationFixture, id string) participation.Request {
	r := f.request(id)
	r.Action, r.Validator, r.AmountYNXT = participation.Withdraw, "", ""
	r.UnbondingID = strings.Repeat("3", 24)
	return r
}
func matureWithdrawal(f *participationFixture) {
	f.mu.Lock()
	f.chainTime = time.Date(2030, 1, 8, 0, 0, 0, 0, time.UTC)
	f.mu.Unlock()
}

func TestP0906ParticipationWithdrawOriginalWindowAndTypedData(t *testing.T) {
	f := newParticipationFixture(t, true)
	ctx := context.Background()
	locked, err := f.service.Prepare(ctx, withdrawalRequest(f, "withdraw-locked"))
	if !errors.Is(err, participation.ErrUnsupported) || locked.State != participation.Unsupported || locked.Intent.Conditions.NativeAvailable || locked.Intent.ActionKind != "" || locked.Intent.Conditions.AvailableYNXT != "7" || locked.Intent.Conditions.WithdrawAvailableAt != "2030-01-08T00:00:00Z" {
		t.Fatalf("chain-locked original promoted: %+v %v", locked, err)
	}
	if _, err = f.service.Submit(ctx, locked.ID); !errors.Is(err, participation.ErrUnsupported) {
		t.Fatal("locked record entered Wallet", err)
	}
	matureWithdrawal(f)
	if old, err := f.service.Review(ctx, locked.ID); !errors.Is(err, participation.ErrStale) || old.ConditionStatus != "STALE" {
		t.Fatal("maturity refreshed old immutable metadata", err)
	}
	req := withdrawalRequest(f, "withdraw-at-exact-chain-boundary")
	entry, err := f.service.Prepare(ctx, req)
	if err != nil || entry.ID == locked.ID || entry.Intent.ActionKind != ynxauth.ActionStakeWithdraw || entry.Intent.Conditions.FeeYNXT != "1" || entry.Intent.Request.AmountYNXT != "" || !entry.Intent.Conditions.NativeAvailable {
		t.Fatalf("original ready action missing: %+v %v", entry, err)
	}
	decoded, err := ynxauth.DecodeActionPayload(entry.Intent.ActionKind, entry.Intent.CanonicalPayload)
	if err != nil || decoded.(ynxauth.StakeWithdrawPayload).UnbondingID != req.UnbondingID {
		t.Fatalf("not sole typed withdrawal codec: %+v %v", decoded, err)
	}
	before, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	review, err := f.service.Review(ctx, entry.ID)
	if err != nil || review.WalletInput == nil || review.Authority || review.IndependentFinality || !review.RequiresWalletApproval {
		t.Fatalf("review elevated DATA: %+v %v", review, err)
	}
	raw, _ := json.Marshal(review.WalletInput)
	var input map[string]json.RawMessage
	var fields map[string]string
	if json.Unmarshal(raw, &input) != nil || json.Unmarshal(input["payload"], &fields) != nil || len(input) != 3 || len(fields) != 1 || fields["unbondingID"] != req.UnbondingID {
		t.Fatalf("withdraw Main DATA must contain no caller amount/nonce/authority: %s", raw)
	}
	network, _ := hex.DecodeString(f.network.NetworkID32)
	want, err := (ynxauth.Action{ChainID: network, NativeChainID: 6423, Owner: f.owner, Nonce: 2, Fee: 1, Kind: ynxauth.ActionStakeWithdraw, Payload: entry.Intent.CanonicalPayload}).SigningBytes()
	digest := sha256.Sum256(want)
	if err != nil || !bytes.Equal(review.CanonicalAction, want) || review.CanonicalActionSHA256 != hex.EncodeToString(digest[:]) {
		t.Fatal("original ACTION/v1 bytes changed", err)
	}
	after, err := os.ReadFile(f.path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("review mutated durable original", err)
	}
	if p, s, l := f.counts(); p != 0 || s != 0 || l != 0 {
		t.Fatalf("prepare/review caused effect %d/%d/%d", p, s, l)
	}
	result, err := f.service.Submit(ctx, entry.ID)
	if err != nil || result.State != participation.ReportedCommitted || result.Observation == nil || result.Observation.IndependentFinality || result.Observation.NativeHash != result.WalletResult.NativeHash {
		t.Fatalf("original Member/action readback missing: %+v %v", result, err)
	}
	if p, s, l := f.counts(); p != 1 || s != 1 || l != 0 {
		t.Fatalf("publish/sign/lookup %d/%d/%d", p, s, l)
	}
	t.Logf("PUBLIC_CONTROLLED_WITHDRAW_TYPED_DATA %s; source amount=7 caller amount absent; exact chain boundary; RPC finality=false", raw)
}

func TestP0906ParticipationWithdrawSourceRecordNegatives(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*participationFixture)
		want error
	}{
		{"foreign-owner", func(f *participationFixture) {
			f.unbondingEdit = func(v *consensus.BFTUnbondingEntry) { v.Delegator = "0x" + strings.Repeat("5", 40) }
		}, participation.ErrInvalid},
		{"wrong-unbonding-id", func(f *participationFixture) {
			f.unbondingEdit = func(v *consensus.BFTUnbondingEntry) { v.ID = strings.Repeat("5", 24) }
		}, participation.ErrInvalid},
		{"shortened-seven-day-window", func(f *participationFixture) {
			f.unbondingEdit = func(v *consensus.BFTUnbondingEntry) { v.AvailableAt = v.AvailableAt.Add(-time.Second) }
		}, participation.ErrInvalid},
		{"uncommitted-record-height", func(f *participationFixture) {
			f.unbondingEdit = func(v *consensus.BFTUnbondingEntry) { v.BlockHeight = 21 }
		}, participation.ErrInvalid},
		{"zero-original-amount", func(f *participationFixture) {
			f.unbondingEdit = func(v *consensus.BFTUnbondingEntry) { v.AmountYNXT = 0 }
		}, participation.ErrInvalid},
		{"queued-with-withdrawn-time", func(f *participationFixture) {
			f.unbondingEdit = func(v *consensus.BFTUnbondingEntry) { v.WithdrawnAt = &v.AvailableAt }
		}, participation.ErrInvalid},
		{"parent-owner-drift", func(f *participationFixture) {
			f.delegationEdit = func(v *consensus.BFTStakeDelegation) { v.Delegator = "0x" + strings.Repeat("5", 40) }
		}, participation.ErrInvalid},
		{"parent-id-drift", func(f *participationFixture) {
			f.delegationEdit = func(v *consensus.BFTStakeDelegation) { v.ID = strings.Repeat("6", 24) }
		}, participation.ErrInvalid},
		{"parent-validator-drift", func(f *participationFixture) {
			f.delegationEdit = func(v *consensus.BFTStakeDelegation) { v.Validator = "other-validator" }
		}, participation.ErrInvalid},
		{"opaque-protected-lineage", func(f *participationFixture) { f.opaque = true }, participation.ErrUnsupported},
		{"withdrawn-is-historical", func(f *participationFixture) {
			f.unbondingEdit = func(v *consensus.BFTUnbondingEntry) { v.Status = "withdrawn"; v.WithdrawnAt = &v.AvailableAt }
		}, participation.ErrUnsupported},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newParticipationFixture(t, true)
			matureWithdrawal(f)
			f.mu.Lock()
			tc.edit(f)
			f.mu.Unlock()
			entry, err := f.service.Prepare(context.Background(), withdrawalRequest(f, "negative-"+tc.name))
			if !errors.Is(err, tc.want) {
				t.Fatalf("invalid source admitted: %+v %v want %v", entry, err, tc.want)
			}
			if p, s, l := f.counts(); p != 0 || s != 0 || l != 0 {
				t.Fatalf("source refusal effected %d/%d/%d", p, s, l)
			}
		})
	}
}

func TestP0906ParticipationWithdrawRejectsCallerEffectFields(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*participation.Request)
	}{
		{"caller-amount", func(r *participation.Request) { r.AmountYNXT = "7" }},
		{"caller-validator", func(r *participation.Request) { r.Validator = "fixture-validator-A" }},
		{"caller-parent", func(r *participation.Request) { r.DelegationID = strings.Repeat("1", 24) }},
		{"invalid-original-id", func(r *participation.Request) { r.UnbondingID = "0x" + strings.Repeat("3", 24) }},
		{"delegate-with-unbonding", func(r *participation.Request) {
			r.Action = participation.Delegate
			r.Validator = "fixture-validator-A"
			r.AmountYNXT = "7"
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newParticipationFixture(t, true)
			matureWithdrawal(f)
			r := withdrawalRequest(f, "invalid-"+tc.name)
			tc.edit(&r)
			if _, err := f.service.Prepare(context.Background(), r); !errors.Is(err, participation.ErrInvalid) {
				t.Fatal("caller effect field accepted", err)
			}
			if len(f.service.List()) != 0 {
				t.Fatal("invalid request allocated journal intent")
			}
			if p, s, l := f.counts(); p != 0 || s != 0 || l != 0 {
				t.Fatalf("invalid request effected %d/%d/%d", p, s, l)
			}
		})
	}
}

func TestP0906ParticipationWithdrawMissingWalletRetainsOriginal(t *testing.T) {
	f := newParticipationFixture(t, false)
	matureWithdrawal(f)
	entry, err := f.service.Prepare(context.Background(), withdrawalRequest(f, "no-original-wallet"))
	if !errors.Is(err, participation.ErrUnsupported) || entry.State != participation.Unsupported || entry.Intent.ActionKind != ynxauth.ActionStakeWithdraw {
		t.Fatalf("blocked typed intent lost: %+v %v", entry, err)
	}
	review, err := f.service.Review(context.Background(), entry.ID)
	if err != nil || review.WalletHandoffState != "NOT_SUPPLIED" || review.WalletAdapterConfigured || review.Authority || review.WalletInput == nil {
		t.Fatalf("missing real Wallet concealed: %+v %v", review, err)
	}
	if _, err = f.service.Submit(context.Background(), entry.ID); !errors.Is(err, participation.ErrUnsupported) {
		t.Fatal("no Wallet bypassed", err)
	}
	if p, s, l := f.counts(); p != 0 || s != 0 || l != 0 {
		t.Fatalf("missing Wallet effected %d/%d/%d", p, s, l)
	}
}

func TestP0906ParticipationWithdrawRechecksOriginalAndChainTime(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*participationFixture)
		want error
	}{
		{"chain-time-reorg-to-locked", func(f *participationFixture) { f.chainTime = f.chainTime.Add(-time.Nanosecond) }, participation.ErrUnsupported},
		{"same-hash-original-amount-drift", func(f *participationFixture) {
			f.unbondingEdit = func(v *consensus.BFTUnbondingEntry) { v.AmountYNXT++ }
		}, participation.ErrStale},
		{"same-hash-original-parent-lineage-drift", func(f *participationFixture) {
			f.delegationEdit = func(v *consensus.BFTStakeDelegation) { v.AuthorizationHistory = "different original lineage" }
		}, participation.ErrStale},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newParticipationFixture(t, true)
			matureWithdrawal(f)
			entry, err := f.service.Prepare(context.Background(), withdrawalRequest(f, "fresh-record"))
			if err != nil {
				t.Fatal(err)
			}
			f.mu.Lock()
			tc.edit(f)
			f.mu.Unlock()
			if _, err = f.service.Submit(context.Background(), entry.ID); !errors.Is(err, tc.want) {
				t.Fatalf("stale original reused: %v want %v", err, tc.want)
			}
			if p, s, l := f.counts(); p != 0 || s != 0 || l != 0 {
				t.Fatalf("stale request effected %d/%d/%d", p, s, l)
			}
		})
	}
}

func TestP0906ParticipationWithdrawUnknownCancelColdOriginalRecovery(t *testing.T) {
	f := newParticipationFixture(t, true)
	matureWithdrawal(f)
	ctx := context.Background()
	f.mu.Lock()
	f.drop = true
	f.mu.Unlock()
	entry, err := f.service.Prepare(ctx, withdrawalRequest(f, "withdraw-lost-ack"))
	if err != nil {
		t.Fatal(err)
	}
	unknown, err := f.service.Submit(ctx, entry.ID)
	if !errors.Is(err, participation.ErrUnknown) || unknown.State != participation.Unknown || unknown.FirstCause == "" {
		t.Fatalf("unknown lost: %+v %v", unknown, err)
	}
	cancelled, err := f.service.Cancel(entry.ID)
	if !errors.Is(err, participation.ErrUnknown) || cancelled.CancelRequestedAt == "" || cancelled.FirstCause != unknown.FirstCause {
		t.Fatalf("cancel erased effect: %+v %v", cancelled, err)
	}
	if _, err = f.service.Prepare(ctx, withdrawalRequest(f, "withdraw-different-nonce")); !errors.Is(err, participation.ErrUnknown) {
		t.Fatal("unknown target replayed after nonce advance", err)
	}
	if err = f.service.Close(); err != nil {
		t.Fatal(err)
	}
	restored, err := participation.New(f.path, f.reader, f.wallet)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	review, err := restored.Review(ctx, entry.ID)
	if err != nil || !review.OriginalEffectMayExist || !review.LocalDispatchCancelled || review.Entry.FirstCause != unknown.FirstCause || review.Entry.Binding != entry.Binding {
		t.Fatalf("cold original metadata drifted: %+v %v", review, err)
	}
	resolved, err := restored.Submit(ctx, entry.ID)
	if err != nil || resolved.State != participation.ReportedCommitted || resolved.CancelRequestedAt != cancelled.CancelRequestedAt || resolved.FirstCause != unknown.FirstCause || resolved.PublishAttemptedAt != unknown.PublishAttemptedAt || resolved.Observation == nil || resolved.Observation.IndependentFinality {
		t.Fatalf("cold lookup replaced original: %+v %v", resolved, err)
	}
	if p, s, l := f.counts(); p != 1 || s != 1 || l != 1 {
		t.Fatalf("unknown cancel cold retry republished %d/%d/%d", p, s, l)
	}
}

func TestP0906ParticipationWithdrawRevokedUnknownStillReadsOriginal(t *testing.T) {
	f := newParticipationFixture(t, true)
	matureWithdrawal(f)
	ctx := context.Background()
	f.mu.Lock()
	f.drop = true
	f.mu.Unlock()
	entry, err := f.service.Prepare(ctx, withdrawalRequest(f, "withdraw-revoke-unknown"))
	if err != nil {
		t.Fatal(err)
	}
	unknown, err := f.service.Submit(ctx, entry.ID)
	if !errors.Is(err, participation.ErrUnknown) {
		t.Fatal(err)
	}
	if err = f.service.Revoke(); err != nil {
		t.Fatal(err)
	}
	if err = f.service.Close(); err != nil {
		t.Fatal(err)
	}
	restored, err := participation.New(f.path, f.reader, f.wallet)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if _, err = restored.Prepare(ctx, withdrawalRequest(f, "withdraw-replacement-after-revoke")); !errors.Is(err, participation.ErrRevoked) {
		t.Fatal("cold revoke reopened dispatch", err)
	}
	resolved, err := restored.Reconcile(ctx, entry.ID)
	if err != nil || resolved.State != participation.ReportedCommitted || resolved.FirstCause != unknown.FirstCause || resolved.Binding != entry.Binding {
		t.Fatalf("revocation blocked original read or erased firstcause: %+v %v", resolved, err)
	}
	if p, s, l := f.counts(); p != 1 || s != 1 || l != 1 {
		t.Fatalf("revoked cold lookup republished %d/%d/%d", p, s, l)
	}
}
