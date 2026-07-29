package cardproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func newLifecycleTestService(t *testing.T, now *time.Time, policy RetentionPolicy) (*Service, []byte) {
	t.Helper()
	providerKey := bytes.Repeat([]byte{0x61}, 32)
	service, err := New(Config{
		StorePath:        t.TempDir() + "/card-state.json",
		IntegrityKey:     bytes.Repeat([]byte{0x17}, 32),
		GatewayKey:       bytes.Repeat([]byte{0x32}, 32),
		ProviderEventKey: providerKey,
		Provider:         NewSandboxProvider(func() time.Time { return *now }),
		AI:               fixedAI{},
		Retention:        policy,
		Now:              func() time.Time { return *now },
	})
	if err != nil {
		t.Fatal(err)
	}
	return service, providerKey
}

func addLifecycleEvent(t *testing.T, service *Service, providerKey []byte, card Card, now time.Time) CardEvent {
	t.Helper()
	input := ProviderEventInput{
		EventID:        "provider-event-lifecycle-01",
		ProviderCardID: card.ProviderCardID,
		Type:           "decline",
		AmountMinor:    4200,
		Currency:       "USD",
		Merchant:       "Lifecycle Books",
		MCC:            "5942",
		Country:        "US",
		ReasonCode:     "spend_limit",
		OccurredAt:     now.Add(-time.Minute),
	}
	event, err := service.AcceptProviderEvent(input, now, signProviderEvent(providerKey, input, now))
	if err != nil {
		t.Fatal(err)
	}
	return event
}

func TestAccountExportRedactsProviderSensitiveReferences(t *testing.T) {
	now := time.Date(2026, 7, 29, 8, 0, 0, 0, time.UTC)
	service, providerKey := newLifecycleTestService(t, &now, RetentionPolicy{})
	application, card := applySandbox(t, service)
	event := addLifecycleEvent(t, service, providerKey, card, now)

	export, err := service.ExportAccount(context.Background(), testAccount)
	if err != nil {
		t.Fatal(err)
	}
	if export.SchemaVersion != DataExportSchema || export.ProductID != ProductID || export.Account != testAccount {
		t.Fatalf("unexpected account export identity: %+v", export)
	}
	if export.RecordCounts["applications"] != 1 || export.RecordCounts["cards"] != 1 || export.RecordCounts["events"] != 1 {
		t.Fatalf("unexpected account export counts: %+v", export.RecordCounts)
	}
	raw, err := json.Marshal(export)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, forbidden := range []string{
		"kyc_sandbox_verified_01",
		application.ProviderReference,
		card.ProviderCardID,
		event.ProviderEventID,
	} {
		if forbidden != "" && strings.Contains(text, forbidden) {
			t.Fatalf("provider-sensitive reference leaked in export: %s", forbidden)
		}
	}
	if !strings.Contains(text, card.Last4) || !strings.Contains(text, "Lifecycle Books") {
		t.Fatalf("account-owned safe metadata missing from export: %s", text)
	}
}

func TestDeleteAccountClosesCardsDeletesRecordsAndPseudonymizesAudit(t *testing.T) {
	now := time.Date(2026, 7, 29, 8, 0, 0, 0, time.UTC)
	service, providerKey := newLifecycleTestService(t, &now, RetentionPolicy{})
	_, card := applySandbox(t, service)
	event := addLifecycleEvent(t, service, providerKey, card, now)
	if _, err := service.OpenDispute(testAccount, card.ID, DisputeInput{
		EventID:        event.ID,
		Reason:         "I do not recognize this lifecycle test event.",
		IdempotencyKey: "lifecycle-dispute-01",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RunAI(context.Background(), testAccount, AIRunInput{
		Workflow:       "card_decline_explanation",
		ContextEventID: event.ID,
		OutputLanguage: "en",
		Permission:     "allow_once",
	}); err != nil {
		t.Fatal(err)
	}

	input := DeleteAccountInput{Confirmation: DeleteConfirmation, IdempotencyKey: "account-delete-key-01"}
	receipt, err := service.DeleteAccount(context.Background(), testAccount, input)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.ClosedCards != 1 || receipt.AccountPseudonym == "" || receipt.AuditID == "" {
		t.Fatalf("incomplete deletion receipt: %+v", receipt)
	}
	if receipt.DeletedRecords["cards"] != 1 || receipt.DeletedRecords["events"] != 1 || receipt.DeletedRecords["applications"] != 1 {
		t.Fatalf("incomplete deletion counts: %+v", receipt.DeletedRecords)
	}

	repeated, err := service.DeleteAccount(context.Background(), testAccount, input)
	if err != nil || repeated.ID != receipt.ID || repeated.AuditID != receipt.AuditID {
		t.Fatalf("account deletion must be idempotent: %+v %v", repeated, err)
	}
	if _, err := service.DeleteAccount(context.Background(), testAccount, DeleteAccountInput{Confirmation: DeleteConfirmation, IdempotencyKey: "account-delete-key-02"}); err != ErrConflict {
		t.Fatalf("different account deletion key must conflict while receipt is retained: %v", err)
	}

	state, err := service.State(testAccount)
	if err != nil {
		t.Fatal(err)
	}
	if state.Eligibility != nil || len(state.Applications)+len(state.Cards)+len(state.Events)+len(state.Disputes)+len(state.Notifications)+len(state.AIRuns)+len(state.Audit) != 0 {
		t.Fatalf("raw account state remained after deletion: %+v", state)
	}
	if err := service.store.View(func(snapshot Snapshot) error {
		raw, marshalErr := json.Marshal(snapshot)
		if marshalErr != nil {
			return marshalErr
		}
		if strings.Contains(string(raw), testAccount) || strings.Contains(string(raw), card.ProviderCardID) || strings.Contains(string(raw), event.ProviderEventID) {
			t.Fatalf("deleted raw identifiers remain in persisted state: %s", raw)
		}
		if stored := snapshot.DeletionReceipts[receipt.AccountPseudonym]; stored.ID != receipt.ID {
			t.Fatalf("deletion receipt was not persisted: %+v", stored)
		}
		if err := validateBackupSnapshot(snapshot); err != nil {
			t.Fatalf("deletion broke snapshot integrity: %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRetentionDeletesOnlyExpiredBoundedRecords(t *testing.T) {
	now := time.Date(2026, 7, 29, 8, 0, 0, 0, time.UTC)
	policy := RetentionPolicy{
		NotificationMaxAge: 24 * time.Hour,
		AIRunMaxAge:        24 * time.Hour,
		IdempotencyMaxAge:  24 * time.Hour,
		ProviderReplayAge:  48 * time.Hour,
		DeletionReceiptAge: 24 * time.Hour,
	}
	service, providerKey := newLifecycleTestService(t, &now, policy)
	_, card := applySandbox(t, service)
	event := addLifecycleEvent(t, service, providerKey, card, now)

	if err := service.store.Update(func(snapshot *Snapshot) error {
		old := now.Add(-72 * time.Hour)
		for id, value := range snapshot.Notifications {
			value.CreatedAt = old
			snapshot.Notifications[id] = value
		}
		snapshot.AIRuns["cai_expired_retention"] = AIRun{ID: "cai_expired_retention", Account: testAccount, Workflow: "card_support_draft", Status: "reviewed", CreatedAt: old, UpdatedAt: old}
		for id, value := range snapshot.Idempotency {
			value.CreatedAt = old
			snapshot.Idempotency[id] = value
		}
		snapshot.ProviderSeen["provider-orphan-expired-01"] = old
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	result, err := service.EnforceAccountRetention(context.Background(), testAccount)
	if err != nil {
		t.Fatal(err)
	}
	if result.Deleted["notifications"] != 1 || result.Deleted["aiRuns"] != 1 || result.Deleted["idempotency"] == 0 || result.Deleted["orphanProviderReplayRecords"] != 1 || result.AuditID == "" {
		t.Fatalf("retention result incomplete: %+v", result)
	}
	state, err := service.State(testAccount)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Cards) != 1 || len(state.Events) != 1 || state.Events[0].ID != event.ID {
		t.Fatalf("retention deleted durable financial records: %+v", state)
	}
	if len(state.Notifications) != 0 || len(state.AIRuns) != 0 {
		t.Fatalf("retention left expired bounded records: %+v", state)
	}
}

func TestRetentionPolicyFailsClosedWhenIncompleteOrUnsafe(t *testing.T) {
	now := time.Date(2026, 7, 29, 8, 0, 0, 0, time.UTC)
	_, err := New(Config{
		StorePath:        t.TempDir() + "/card-state.json",
		IntegrityKey:     bytes.Repeat([]byte{0x17}, 32),
		GatewayKey:       bytes.Repeat([]byte{0x32}, 32),
		ProviderEventKey: bytes.Repeat([]byte{0x61}, 32),
		Provider:         NewSandboxProvider(func() time.Time { return now }),
		Retention: RetentionPolicy{
			NotificationMaxAge: time.Minute,
			AIRunMaxAge:        24 * time.Hour,
			IdempotencyMaxAge:  24 * time.Hour,
			ProviderReplayAge:  48 * time.Hour,
			DeletionReceiptAge: 24 * time.Hour,
		},
		Now: func() time.Time { return now },
	})
	if err == nil || !strings.Contains(err.Error(), "retention") {
		t.Fatalf("unsafe retention policy accepted: %v", err)
	}
}

func TestDataLifecycleHTTPRoutesRequireCanonicalScopes(t *testing.T) {
	now := time.Date(2026, 7, 29, 8, 0, 0, 0, time.UTC)
	service, _ := newLifecycleTestService(t, &now, RetentionPolicy{})
	_, card := applySandbox(t, service)
	gatewayKey := bytes.Repeat([]byte{0x32}, 32)
	server := httptest.NewServer(NewServer(service, buildinfo.Info{Commit: "lifecycle-commit", Release: "lifecycle-test"}).Handler())
	defer server.Close()

	exportRequest, err := http.NewRequest(http.MethodGet, server.URL+"/v1/account/export", nil)
	if err != nil {
		t.Fatal(err)
	}
	exportAssertion := lifecycleAssertion(now, "lifecycle-export-nonce-01", CardScopes)
	signRequest(t, exportRequest, nil, exportAssertion, gatewayKey)
	exportResponse, err := http.DefaultClient.Do(exportRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer exportResponse.Body.Close()
	if exportResponse.StatusCode != http.StatusOK {
		t.Fatalf("account export route status = %d", exportResponse.StatusCode)
	}
	var exported AccountExport
	if err := json.NewDecoder(exportResponse.Body).Decode(&exported); err != nil {
		t.Fatal(err)
	}
	if exported.SchemaVersion != DataExportSchema || len(exported.State.Cards) != 1 || exported.State.Cards[0].Last4 != card.Last4 || exported.State.Cards[0].ProviderCardID != "" {
		t.Fatalf("account export route returned unsafe or incomplete data: %+v", exported)
	}

	deleteBody, err := json.Marshal(DeleteAccountInput{Confirmation: DeleteConfirmation, IdempotencyKey: "http-delete-key-01"})
	if err != nil {
		t.Fatal(err)
	}
	insufficient, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/account/data", bytes.NewReader(deleteBody))
	if err != nil {
		t.Fatal(err)
	}
	signRequest(t, insufficient, deleteBody, lifecycleAssertion(now, "lifecycle-delete-nonce-01", CardScopes), gatewayKey)
	insufficientResponse, err := http.DefaultClient.Do(insufficient)
	if err != nil {
		t.Fatal(err)
	}
	_ = insufficientResponse.Body.Close()
	if insufficientResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("account deletion accepted without dedicated scope: %d", insufficientResponse.StatusCode)
	}

	deleteRequest, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/account/data", bytes.NewReader(deleteBody))
	if err != nil {
		t.Fatal(err)
	}
	signRequest(t, deleteRequest, deleteBody, lifecycleAssertion(now, "lifecycle-delete-nonce-02", CardDeleteScopes), gatewayKey)
	deleteResponse, err := http.DefaultClient.Do(deleteRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer deleteResponse.Body.Close()
	if deleteResponse.StatusCode != http.StatusOK || deleteResponse.Header.Get(AuditIDHeader) == "" {
		t.Fatalf("account deletion route status=%d audit=%q", deleteResponse.StatusCode, deleteResponse.Header.Get(AuditIDHeader))
	}
	var receipt DataDeletionReceipt
	if err := json.NewDecoder(deleteResponse.Body).Decode(&receipt); err != nil {
		t.Fatal(err)
	}
	if receipt.ClosedCards != 1 || receipt.AuditID == "" || receipt.IdempotencyDigest != "" {
		t.Fatalf("account deletion route returned incomplete or sensitive receipt: %+v", receipt)
	}
}

func lifecycleAssertion(now time.Time, nonce string, scopes []string) GatewayAssertion {
	assertion := testAssertion(nonce)
	assertion.Scopes = append([]string(nil), scopes...)
	assertion.IssuedAt = now.Add(-time.Minute)
	assertion.ExpiresAt = now.Add(4 * time.Minute)
	return assertion
}
