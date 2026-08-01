package payproduct

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestApprovedMerchantDeletionHonorsLegalHoldAndPurgesOnlyLocalTenantData(t *testing.T) {
	current := time.Date(2026, 7, 29, 8, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return current })
	merchant, _ := onboard(t, service)
	owner := MerchantPrincipal{Merchant: merchant, Account: merchant.PayoutAddress, Role: "owner"}
	foreignID := "mrc_foreign_tenant"

	if err := service.store.Update(func(data *Snapshot) error {
		data.Merchants[foreignID] = Merchant{ID: foreignID, DisplayName: "Foreign Merchant", PayoutAddress: merchant.PayoutAddress, Status: "active", CreatedAt: current, UpdatedAt: current}
		data.Catalog["cat_delete"] = CatalogItem{ID: "cat_delete", MerchantID: merchant.ID, Name: "Delete me", Amount: 100, Asset: NativeAsset, Active: true, CreatedAt: current}
		data.Catalog["cat_foreign"] = CatalogItem{ID: "cat_foreign", MerchantID: foreignID, Name: "Keep me", Amount: 200, Asset: NativeAsset, Active: true, CreatedAt: current}
		data.Invoices["inv_expired"] = Invoice{ID: "inv_expired", MerchantID: merchant.ID, Status: "expired", CreatedAt: current}
		data.Refunds["rfd_resolved"] = RefundRequest{ID: "rfd_resolved", MerchantID: merchant.ID, Status: "resolved", CreatedAt: current, UpdatedAt: current}
		data.Disputes["dsp_resolved"] = Dispute{ID: "dsp_resolved", MerchantID: merchant.ID, Status: "resolved", CreatedAt: current, UpdatedAt: current}
		data.Deliveries["whd_delivered"] = WebhookDelivery{ID: "whd_delivered", MerchantID: merchant.ID, Status: "delivered", CreatedAt: current, UpdatedAt: current}
		data.AIRuns["air_completed"] = AIRun{ID: "air_completed", MerchantID: merchant.ID, Status: "completed", CreatedAt: current, UpdatedAt: current}
		data.Providers["prv_disabled"] = ProviderConnection{ID: "prv_disabled", MerchantID: merchant.ID, ProviderID: "disabled-provider", Status: "disabled", CreatedAt: current, UpdatedAt: current}
		data.BulkOperations["bwr_completed"] = BulkWebhookRetryResult{OperationID: "bwr_completed", MerchantID: merchant.ID, Status: "completed", StartedAt: current, CompletedAt: current}
		data.Nonces["nonce_delete"] = NonceRecord{MerchantID: merchant.ID, Nonce: "nonce_delete", SeenAt: current}
		data.Idempotency["custom:"+merchant.ID+":delete"] = IdempotencyRecord{Scope: "custom", Key: "delete", RequestHash: "hash", ObjectID: "cat_delete", CreatedAt: current}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	hold, err := service.PlaceMerchantDataHold(MerchantDataHoldInput{
		MerchantID:         merchant.ID,
		Reason:             "Preserve the account while a legal review is active",
		AuthorityReference: "legal-case-2026-07",
		OperatorID:         "privacy.ops",
		IdempotencyKey:     "hold-delete-01",
	})
	if err != nil || hold.Status != "active" {
		t.Fatalf("place hold: %+v %v", hold, err)
	}
	request, err := service.RequestMerchantDeletion(owner, MerchantDeletionRequestInput{
		ConfirmMerchantID: merchant.ID,
		Reason:            "Delete this merchant after the legal review is resolved",
		IdempotencyKey:    "delete-lifecycle-01",
	})
	if err != nil || request.Status != "retention_blocked" || request.EligibleAt == nil {
		t.Fatalf("request deletion: %+v %v", request, err)
	}

	current = request.EligibleAt.Add(time.Minute)
	approvalInput := MerchantDeletionApprovalInput{ConfirmMerchantID: merchant.ID, OperatorID: "privacy.ops", ApprovalReference: "approval-ticket-2026-07"}
	blocked, err := service.ApproveMerchantDeletion(request.ID, approvalInput)
	if err != nil || blocked.Status != "retention_blocked" || !lifecycleContainsString(blocked.Blockers, "legal-hold-active") {
		t.Fatalf("legal hold did not block approval: %+v %v", blocked, err)
	}
	if _, err := service.ExecuteMerchantDeletion(request.ID, MerchantDeletionExecutionInput{ConfirmMerchantID: merchant.ID, OperatorID: "privacy.ops", ApprovalReference: approvalInput.ApprovalReference, IdempotencyKey: "execute-delete-01"}); err == nil {
		t.Fatal("unapproved deletion execution succeeded")
	}

	released, err := service.ReleaseMerchantDataHold(hold.ID, MerchantDataHoldReleaseInput{MerchantID: merchant.ID, OperatorID: "legal.ops", Reason: "Legal review closed and the hold may be released"})
	if err != nil || released.Status != "released" || released.ReleasedAt == nil {
		t.Fatalf("release hold: %+v %v", released, err)
	}
	approved, err := service.ApproveMerchantDeletion(request.ID, approvalInput)
	if err != nil || approved.Status != "approved" || approved.ApprovedAt == nil || approved.ApprovedBy != approvalInput.OperatorID {
		t.Fatalf("approve deletion: %+v %v", approved, err)
	}

	executionInput := MerchantDeletionExecutionInput{ConfirmMerchantID: merchant.ID, OperatorID: approvalInput.OperatorID, ApprovalReference: approvalInput.ApprovalReference, IdempotencyKey: "execute-delete-01"}
	wrongApproval := executionInput
	wrongApproval.ApprovalReference = "different-approval-ticket"
	if _, err := service.ExecuteMerchantDeletion(request.ID, wrongApproval); err == nil {
		t.Fatal("mismatched approval reference executed deletion")
	}
	completed, err := service.ExecuteMerchantDeletion(request.ID, executionInput)
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != "completed" || completed.ExecutedAt == nil || completed.ExecutionSummary == nil {
		t.Fatalf("missing deletion completion evidence: %+v", completed)
	}
	if completed.ExecutionSummary.ProviderDeletionClaimed || completed.ExecutionSummary.PublicChainDeletionClaimed {
		t.Fatalf("execution overclaimed external deletion: %+v", completed.ExecutionSummary)
	}
	if completed.ExecutionSummary.RemovedRecords["merchants"] != 1 || completed.ExecutionSummary.RemovedRecords["providers"] != 1 || completed.ExecutionSummary.RetainedDataRequests < 1 || completed.ExecutionSummary.RetainedReleasedHolds != 1 {
		t.Fatalf("unexpected deletion summary: %+v", completed.ExecutionSummary)
	}

	replayed, err := service.ExecuteMerchantDeletion(request.ID, executionInput)
	if err != nil || replayed.Status != "completed" || replayed.ExecutedAt == nil || !replayed.ExecutedAt.Equal(*completed.ExecutedAt) {
		t.Fatalf("execution replay was not idempotent: %+v %v", replayed, err)
	}
	changedReplay := executionInput
	changedReplay.OperatorID = "other.privacy.ops"
	if _, err := service.ExecuteMerchantDeletion(request.ID, changedReplay); err == nil {
		t.Fatal("execution idempotency accepted a changed request")
	}

	if err := service.store.View(func(data Snapshot) error {
		if _, ok := data.Merchants[merchant.ID]; ok {
			t.Fatal("merchant record survived approved deletion")
		}
		if _, ok := data.Merchants[foreignID]; !ok || data.Catalog["cat_foreign"].MerchantID != foreignID {
			t.Fatal("foreign tenant data was modified")
		}
		for _, member := range data.MerchantMembers {
			if member.MerchantID == merchant.ID {
				t.Fatal("merchant member survived deletion")
			}
		}
		for _, session := range data.ConsoleSessions {
			if session.MerchantID == merchant.ID {
				t.Fatal("merchant session survived deletion")
			}
		}
		for _, nonce := range data.Nonces {
			if nonce.MerchantID == merchant.ID {
				t.Fatal("merchant nonce survived deletion")
			}
		}
		storedRequest := data.DataRequests[request.ID]
		if storedRequest.Status != "completed" || storedRequest.Reason != merchantDeletionRedaction || storedRequest.RequestedBy != "" {
			t.Fatalf("completion tombstone not redacted: %+v", storedRequest)
		}
		storedHold := data.DataHolds[hold.ID]
		if storedHold.Status != "released" || storedHold.Reason != merchantDeletionRedaction {
			t.Fatalf("released hold evidence not retained and redacted: %+v", storedHold)
		}
		var executionAudit bool
		for _, entry := range data.Audit {
			if entry.MerchantID == merchant.ID && entry.Action == "merchant.data.deletion.execute" && entry.Outcome == "committed" {
				executionAudit = true
			}
		}
		if !executionAudit {
			t.Fatal("deletion execution audit evidence missing")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SnapshotForMerchant(merchant.ID); err == nil {
		t.Fatal("deleted merchant remained available through merchant state")
	}
}

func TestMerchantDataOperatorHTTPAuthorityFailsClosed(t *testing.T) {
	now := time.Date(2026, 7, 29, 10, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	handler := NewServer(service).Handler()
	body, _ := json.Marshal(MerchantDataHoldInput{MerchantID: merchant.ID, Reason: "Preserve merchant data for an active legal review", AuthorityReference: "case-http-01", OperatorID: "privacy.ops", IdempotencyKey: "hold-http-01"})

	unconfigured := httptest.NewRecorder()
	handler.ServeHTTP(unconfigured, httptest.NewRequest(http.MethodPost, "/v1/operator/merchant-data-holds", bytes.NewReader(body)))
	if unconfigured.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured operator authority status=%d body=%s", unconfigured.Code, unconfigured.Body.String())
	}

	service.dataOperatorCredential = strings.Repeat("d", 24)
	unauthorizedRequest := httptest.NewRequest(http.MethodPost, "/v1/operator/merchant-data-holds", bytes.NewReader(body))
	unauthorizedRequest.Header.Set(dataOperatorCredentialHeader, "wrong-authority")
	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, unauthorizedRequest)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("invalid operator authority status=%d body=%s", unauthorized.Code, unauthorized.Body.String())
	}

	authorizedRequest := httptest.NewRequest(http.MethodPost, "/v1/operator/merchant-data-holds", bytes.NewReader(body))
	authorizedRequest.Header.Set(dataOperatorCredentialHeader, service.dataOperatorCredential)
	authorized := httptest.NewRecorder()
	handler.ServeHTTP(authorized, authorizedRequest)
	if authorized.Code != http.StatusCreated {
		t.Fatalf("valid operator authority status=%d body=%s", authorized.Code, authorized.Body.String())
	}
	var hold MerchantDataHold
	if err := json.NewDecoder(authorized.Body).Decode(&hold); err != nil {
		t.Fatal(err)
	}
	if hold.Status != "active" || hold.MerchantID != merchant.ID {
		t.Fatalf("unexpected hold response: %+v", hold)
	}
	if strings.Contains(authorized.Body.String(), service.dataOperatorCredential) {
		t.Fatal("operator credential leaked in response")
	}
}

func lifecycleContainsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
func TestDataOperatorCredentialMustBeDistinct(t *testing.T) {
	bootstrap := strings.Repeat("b", 24)
	monitor := strings.Repeat("m", 24)
	integrity := strings.Repeat("i", 32)
	gateway := strings.Repeat("g", 32)
	for name, credential := range map[string]string{"bootstrap": bootstrap, "monitor": monitor, "integrity": integrity, "gateway": gateway} {
		t.Run(name, func(t *testing.T) {
			_, err := New(Config{
				StorePath:              t.TempDir() + "/state.json",
				IntegrityKey:           []byte(integrity),
				GatewayKey:             []byte(gateway),
				BootstrapKey:           bootstrap,
				DataOperatorCredential: credential,
				MonitorKey:             monitor,
				PublicBaseURL:          "https://pay.example",
				PayAPI:                 &fakePay{},
			})
			if err == nil || !strings.Contains(err.Error(), "must be distinct") {
				t.Fatalf("reused %s credential was accepted: %v", name, err)
			}
		})
	}
}
