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
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

func TestP0906ParticipationReviewTypedDataPrecision(t *testing.T) {
	for _, action := range []string{participation.Delegate, participation.Unbond} {
		t.Run(action, func(t *testing.T) {
			f := newParticipationFixture(t, false)
			req := f.request("typed-data-" + action)
			req.AmountYNXT = "9007199254740993"
			if action == participation.Unbond {
				req.Action = action
				req.Validator = ""
				req.DelegationID = strings.Repeat("1", 24)
				req.AmountYNXT = "3"
			}
			entry, err := f.service.Prepare(context.Background(), req)
			if !errors.Is(err, participation.ErrUnsupported) {
				t.Fatal(err)
			}
			review, err := f.service.Review(context.Background(), entry.ID)
			if err != nil || review.WalletInput == nil {
				t.Fatalf("typed DATA absent: %+v %v", review, err)
			}
			raw, err := json.Marshal(review.WalletInput)
			if err != nil {
				t.Fatal(err)
			}
			var input map[string]any
			if err = json.Unmarshal(raw, &input); err != nil {
				t.Fatal(err)
			}
			payload := input["payload"].(map[string]any)
			if len(input) != 3 || len(payload) != 2 || input["fee"] != "1" || payload["amountYNXT"] != req.AmountYNXT {
				t.Fatalf("Main exact DATA projection lost integer/string: %s", raw)
			}
			if action == participation.Unbond && payload["delegationID"] != req.DelegationID {
				t.Fatal("original delegation ID key changed")
			}
			fixture, _ := json.Marshal(map[string]any{"input": review.WalletInput, "canonicalAction": review.CanonicalAction, "sha256": review.CanonicalActionSHA256, "expected": map[string]string{"chainId": f.network.NetworkID32, "nativeChainId": f.network.NativeChainID, "owner": f.owner, "nonce": entry.Intent.Conditions.NextNonce}})
			t.Logf("PUBLIC_TYPED_DATA_FIXTURE %s", fixture)
			participationStatusNoEffects(t, f)
		})
	}
}

func TestP0906ParticipationReviewWithoutWalletIsExactReadOnlyData(t *testing.T) {
	f := newParticipationFixture(t, false)
	entry, err := f.service.Prepare(context.Background(), f.request("review-without-wallet"))
	if !errors.Is(err, participation.ErrUnsupported) {
		t.Fatal(err)
	}
	before, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	review, err := f.service.Review(context.Background(), entry.ID)
	if err != nil || review.ConditionStatus != "CURRENT_RPC_REPORTED" || review.Current == nil || review.WalletAdapterConfigured || !review.RequiresWalletApproval || review.Authority || review.IndependentFinality || review.OriginalEffectMayExist || review.LocalDispatchCancelled {
		t.Fatalf("unsupported Wallet blocked or elevated DATA: %+v %v", review, err)
	}
	network, _ := hex.DecodeString(f.network.NetworkID32)
	want, err := (ynxauth.Action{ChainID: network, NativeChainID: 6423, Owner: f.owner, Nonce: 2, Fee: 1, Kind: ynxauth.ActionStakeDelegate, Payload: entry.Intent.CanonicalPayload}).SigningBytes()
	digest := sha256.Sum256(want)
	if err != nil || !bytes.Equal(review.CanonicalAction, want) || review.CanonicalActionSHA256 != hex.EncodeToString(digest[:]) || review.Entry.Binding != entry.Binding {
		t.Fatalf("original action bytes or intent changed: %v", err)
	}
	review.Entry.Intent.CanonicalPayload[0] ^= 1
	review.CanonicalAction[0] ^= 1
	f.mu.Lock()
	f.nonce++
	f.mu.Unlock()
	stale, err := f.service.Review(context.Background(), entry.ID)
	if !errors.Is(err, participation.ErrStale) || stale.ConditionStatus != "STALE" || stale.Entry.Intent.Conditions.NextNonce != "2" || !bytes.Equal(stale.CanonicalAction, want) {
		t.Fatalf("current read refreshed an old intent: %+v %v", stale, err)
	}
	after, err := os.ReadFile(f.path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("review wrote journal or exposed mutable retained bytes")
	}
	participationStatusNoEffects(t, f)
}

func TestP0906ParticipationCancelOneEntryAndColdRecovery(t *testing.T) {
	f := newParticipationFixture(t, true)
	ctx := context.Background()
	entry, err := f.service.Prepare(ctx, f.request("cancel-only-this"))
	if err != nil {
		t.Fatal(err)
	}
	other := f.request("unbond-keeps-own-review")
	other.Action = participation.Unbond
	other.Validator = ""
	other.DelegationID = strings.Repeat("1", 24)
	other.AmountYNXT = "3"
	second, err := f.service.Prepare(ctx, other)
	if err != nil {
		t.Fatal(err)
	}
	cancelled, err := f.service.Cancel(entry.ID)
	if !errors.Is(err, participation.ErrCancelled) || cancelled.State != participation.Cancelled || cancelled.CancelRequestedAt == "" || cancelled.PublishAttemptedAt != "" {
		t.Fatalf("cancel: %+v %v", cancelled, err)
	}
	before, _ := os.ReadFile(f.path)
	_, _ = f.service.Cancel(entry.ID)
	after, _ := os.ReadFile(f.path)
	if !bytes.Equal(before, after) {
		t.Fatal("idempotent cancel rewrote original metadata")
	}
	if _, err = f.service.Submit(ctx, entry.ID); !errors.Is(err, participation.ErrCancelled) {
		t.Fatal(err)
	}
	still, ok := f.service.Get(second.ID)
	if !ok || still.State != participation.Prepared || f.service.LocalStatus().Stopped {
		t.Fatal("one cancellation revoked unrelated local entry")
	}
	if err = f.service.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := participation.New(f.path, f.reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	review, err := reopened.Review(ctx, entry.ID)
	if err != nil || review.Entry.ID != entry.ID || review.Entry.Binding != entry.Binding || review.Entry.State != participation.Cancelled || review.Entry.CancelRequestedAt != cancelled.CancelRequestedAt || !review.LocalDispatchCancelled || review.OriginalEffectMayExist {
		t.Fatalf("cold cancelled metadata: %+v %v", review, err)
	}
	if _, err = reopened.Submit(ctx, entry.ID); !errors.Is(err, participation.ErrCancelled) {
		t.Fatal("cold original became dispatchable")
	}
	if fresh, err := reopened.Prepare(ctx, f.request("explicit-new-session-review")); !errors.Is(err, participation.ErrUnsupported) || fresh.ID == entry.ID {
		t.Fatalf("new metadata session blocked or resurrected old: %+v %v", fresh, err)
	}
	f.server.Close()
	if archived, err := reopened.Review(ctx, entry.ID); err != nil || archived.ConditionStatus != participation.Cancelled {
		t.Fatalf("offline cancelled record unreadable: %+v %v", archived, err)
	}
	participationStatusNoEffects(t, f)
}

func TestP0906ParticipationCancelledKnownHashReadsWithoutWallet(t *testing.T) {
	f := newParticipationFixture(t, true)
	ctx := context.Background()
	f.malformedResult = true
	entry, err := f.service.Prepare(ctx, f.request("retained-original-hash"))
	if err != nil {
		t.Fatal(err)
	}
	unknown, err := f.service.Submit(ctx, entry.ID)
	if !errors.Is(err, participation.ErrUnknown) || unknown.WalletResult == nil || unknown.WalletResult.NativeHash == "" {
		t.Fatalf("original hash not retained: %+v %v", unknown, err)
	}
	cancelled, err := f.service.Cancel(entry.ID)
	if !errors.Is(err, participation.ErrUnknown) {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.malformedResult = false
	f.mu.Unlock()
	if err = f.service.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := participation.New(f.path, f.reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	read, err := reopened.Reconcile(ctx, entry.ID)
	if err != nil || read.State != participation.ReportedCommitted || read.CancelRequestedAt != cancelled.CancelRequestedAt || read.FirstCause != unknown.FirstCause || read.WalletResult.NativeHash != unknown.WalletResult.NativeHash || read.Observation.IndependentFinality {
		t.Fatalf("missing Wallet blocked original RPC read or granted finality: %+v %v", read, err)
	}
	if p, s, l := f.counts(); p != 1 || s != 1 || l != 0 {
		t.Fatalf("retained hash used Wallet again: %d/%d/%d", p, s, l)
	}
}

func TestP0906ParticipationReviewCancelDuringCurrentRead(t *testing.T) {
	f := newParticipationFixture(t, false)
	ctx := context.Background()
	entry, err := f.service.Prepare(ctx, f.request("review-current-cancel"))
	if !errors.Is(err, participation.ErrUnsupported) {
		t.Fatal(err)
	}
	gate, reached := make(chan struct{}), make(chan struct{})
	f.mu.Lock()
	f.summaryBlock, f.summaryReached = gate, reached
	f.mu.Unlock()
	type observed struct {
		review participation.Review
		err    error
	}
	done := make(chan observed, 1)
	go func() { view, e := f.service.Review(ctx, entry.ID); done <- observed{view, e} }()
	select {
	case <-reached:
	case <-time.After(2 * time.Second):
		close(gate)
		t.Fatal("reader did not enter")
	}
	if _, err = f.service.Cancel(entry.ID); !errors.Is(err, participation.ErrCancelled) {
		close(gate)
		t.Fatal(err)
	}
	close(gate)
	result := <-done
	if !errors.Is(result.err, participation.ErrStale) || !result.review.LocalDispatchCancelled || result.review.ConditionStatus != participation.Cancelled || result.review.Entry.State != participation.Cancelled {
		t.Fatalf("stale summary hid concurrent cancel: %+v %v", result.review, result.err)
	}
	participationStatusNoEffects(t, f)
}

func TestP0906ParticipationCancelPersistenceFailureCannotAckDurableSuccess(t *testing.T) {
	f := newParticipationFixture(t, false)
	entry, err := f.service.Prepare(context.Background(), f.request("cancel-disk-failure"))
	if !errors.Is(err, participation.ErrUnsupported) {
		t.Fatal(err)
	}
	before, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	preserved := f.path + ".preserved"
	if err = os.Rename(f.path, preserved); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(f.path, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err = f.service.Cancel(entry.ID); !errors.Is(err, participation.ErrUnavailable) {
		t.Fatalf("failed persistence acknowledged cancel: %v", err)
	}
	if status := f.service.LocalStatus(); status.Code != "UNAVAILABLE" || !status.Stopped {
		t.Fatalf("failed cancel did not seal: %+v", status)
	}
	after, err := os.ReadFile(preserved)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("original journal destroyed")
	}
	participationStatusNoEffects(t, f)
}

func TestP0906ParticipationCancelDuringPreflightBlocksPublisher(t *testing.T) {
	f := newParticipationFixture(t, true)
	ctx := context.Background()
	entry, err := f.service.Prepare(ctx, f.request("cancel-in-preflight"))
	if err != nil {
		t.Fatal(err)
	}
	gate, reached := make(chan struct{}), make(chan struct{})
	f.mu.Lock()
	f.summaryBlock, f.summaryReached = gate, reached
	f.mu.Unlock()
	done := make(chan error, 1)
	go func() { _, e := f.service.Submit(ctx, entry.ID); done <- e }()
	select {
	case <-reached:
	case <-time.After(2 * time.Second):
		close(gate)
		t.Fatal("original reader not reached")
	}
	_, err = f.service.Cancel(entry.ID)
	if !errors.Is(err, participation.ErrCancelled) {
		close(gate)
		t.Fatal(err)
	}
	close(gate)
	if err = <-done; !errors.Is(err, participation.ErrCancelled) {
		t.Fatalf("preflight revived cancelled original: %v", err)
	}
	participationStatusNoEffects(t, f)
}

func TestP0906ParticipationCancelUnknownRetainsOriginalThroughColdLookup(t *testing.T) {
	f := newParticipationFixture(t, true)
	ctx := context.Background()
	f.drop = true
	entry, err := f.service.Prepare(ctx, f.request("lost-response-cancel"))
	if err != nil {
		t.Fatal(err)
	}
	unknown, err := f.service.Submit(ctx, entry.ID)
	if !errors.Is(err, participation.ErrUnknown) || unknown.FirstCause == "" {
		t.Fatalf("missing original uncertainty: %+v %v", unknown, err)
	}
	cancelled, err := f.service.Cancel(entry.ID)
	if !errors.Is(err, participation.ErrUnknown) || cancelled.State != participation.Unknown || cancelled.CancelRequestedAt == "" || cancelled.FirstCause != unknown.FirstCause {
		t.Fatalf("cancel hid effect: %+v %v", cancelled, err)
	}
	if _, err = f.service.Prepare(ctx, f.request("replacement-after-cancel")); !errors.Is(err, participation.ErrUnknown) {
		t.Fatal("cancel made unknown slot reusable")
	}
	if err = f.service.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := participation.New(f.path, f.reader, f.wallet)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	review, err := reopened.Review(ctx, entry.ID)
	if err != nil || !review.OriginalEffectMayExist || !review.LocalDispatchCancelled || review.Entry.FirstCause != unknown.FirstCause {
		t.Fatalf("cold review lost original: %+v %v", review, err)
	}
	resolved, err := reopened.Submit(ctx, entry.ID)
	if err != nil || resolved.State != participation.ReportedCommitted || resolved.CancelRequestedAt != cancelled.CancelRequestedAt || resolved.PublishAttemptedAt != unknown.PublishAttemptedAt || resolved.FirstCause != unknown.FirstCause {
		t.Fatalf("original lookup recovery: %+v %v", resolved, err)
	}
	if p, s, l := f.counts(); p != 1 || s != 1 || l != 1 {
		t.Fatalf("cancel/reopen replayed publisher: %d/%d/%d", p, s, l)
	}
}

type delayedParticipationResult struct {
	participation.Wallet
	produced, release chan struct{}
}

func (w delayedParticipationResult) Publish(ctx context.Context, id string, intent participation.Intent, b participation.Binding) (participation.WalletResult, error) {
	result, err := w.Wallet.Publish(ctx, id, intent, b)
	close(w.produced)
	<-w.release
	return result, err
}
func TestP0906ParticipationCancelSurvivesLateProducedResult(t *testing.T) {
	f := newParticipationFixture(t, true)
	if err := f.service.Close(); err != nil {
		t.Fatal(err)
	}
	wallet := delayedParticipationResult{f.wallet, make(chan struct{}), make(chan struct{})}
	var err error
	f.service, err = participation.New(f.path, f.reader, wallet)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	entry, err := f.service.Prepare(ctx, f.request("late-result-cancel"))
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, e := f.service.Submit(ctx, entry.ID); done <- e }()
	select {
	case <-wallet.produced:
	case <-ctx.Done():
		close(wallet.release)
		t.Fatal("fixture did not produce original")
	}
	cancelled, err := f.service.Cancel(entry.ID)
	if !errors.Is(err, participation.ErrUnknown) {
		close(wallet.release)
		t.Fatal(err)
	}
	close(wallet.release)
	if err = <-done; !errors.Is(err, participation.ErrUnknown) {
		t.Fatal(err)
	}
	late, _ := f.service.Get(entry.ID)
	if late.CancelRequestedAt != cancelled.CancelRequestedAt || late.State != participation.Unknown || late.WalletResult == nil || late.WalletResult.NativeHash == "" {
		t.Fatalf("late callback overwrote local cancellation: %+v", late)
	}
	resolved, err := f.service.Reconcile(context.Background(), entry.ID)
	if err != nil || resolved.State != participation.ReportedCommitted || resolved.CancelRequestedAt != cancelled.CancelRequestedAt {
		t.Fatalf("original resolution: %+v %v", resolved, err)
	}
	if p, s, l := f.counts(); p != 1 || s != 1 || l != 1 {
		t.Fatalf("late result caused replay: %d/%d/%d", p, s, l)
	}
}
