package payproduct

import (
	"crypto/ed25519"
	"encoding/hex"
	"testing"
	"time"
)

func TestRecurringDraftIsSignedPersistentAndNonExecuting(t *testing.T) {
	now := time.Date(2026, 7, 22, 7, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	input := RecurringDraftInput{Payer: merchant.PayoutAddress, Description: "Monthly membership", Amount: 8, CadenceDays: 30, MaximumOccurrences: 12, StartsAt: now.Add(24 * time.Hour), IdempotencyKey: "recurring-draft-01"}
	draft, err := service.CreateRecurringDraft(merchant, input)
	if err != nil {
		t.Fatal(err)
	}
	if draft.Status != "draft" || draft.AutomaticChargeEnabled || !draft.WalletApprovalEveryOccurrence || draft.Asset != NativeAsset || draft.Network != ChainID || pay.intentCalls != 0 || pay.invoiceCalls != 0 {
		t.Fatalf("recurring draft crossed its non-execution boundary: draft=%+v pay=%+v", draft, pay)
	}
	publicKey, _ := hex.DecodeString(draft.SigningPublicKey)
	signature, _ := hex.DecodeString(draft.Signature)
	if !ed25519.Verify(publicKey, recurringDraftMaterial(draft), signature) {
		t.Fatal("recurring draft signature did not verify")
	}
	tampered := draft
	tampered.Amount++
	if ed25519.Verify(publicKey, recurringDraftMaterial(tampered), signature) {
		t.Fatal("tampered recurring amount retained a valid signature")
	}
	replayed, err := service.CreateRecurringDraft(merchant, input)
	if err != nil || replayed.ID != draft.ID || replayed.Signature != draft.Signature {
		t.Fatalf("recurring draft idempotency failed: %+v %v", replayed, err)
	}
	state, err := service.SnapshotForMerchant(merchant.ID)
	if err != nil || state.RecurringDrafts[draft.ID].ID != draft.ID {
		t.Fatalf("recurring draft was not persisted for the merchant: %+v %v", state.RecurringDrafts, err)
	}
}

func TestRecurringDraftValidationFailsClosed(t *testing.T) {
	now := time.Date(2026, 7, 22, 7, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	base := RecurringDraftInput{Payer: merchant.PayoutAddress, Description: "Membership", Amount: 8, CadenceDays: 30, MaximumOccurrences: 12, StartsAt: now.Add(24 * time.Hour), IdempotencyKey: "recurring-draft-02"}
	bad := []RecurringDraftInput{base, base, base, base}
	bad[0].Amount = 0
	bad[1].CadenceDays = 0
	bad[2].MaximumOccurrences = 121
	bad[3].StartsAt = now.Add(-time.Second)
	for i, input := range bad {
		input.IdempotencyKey += string(rune('a' + i))
		if _, err := service.CreateRecurringDraft(merchant, input); err == nil {
			t.Fatalf("invalid recurring draft %d was accepted", i)
		}
	}
}
