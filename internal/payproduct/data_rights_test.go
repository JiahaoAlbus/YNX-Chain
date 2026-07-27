package payproduct

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestMerchantDataExportRedactsRuntimeMaterialAndRequiresOwner(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	owner := MerchantPrincipal{Merchant: merchant, Account: merchant.PayoutAddress, Role: "owner"}

	const deliveryValue = "runtime-auth-value"
	const sessionValue = "runtime-session-value"
	const replayValue = "runtime-replay-value"
	const providerReference = "vault/provider/merchant/export"
	if err := service.store.Update(func(data *Snapshot) error {
		data.Deliveries["whd_export"] = WebhookDelivery{ID: "whd_export", MerchantID: merchant.ID, EventType: "invoice.committed", ObjectID: "inv_export", Endpoint: "https://merchant.example/webhook", Signature: deliveryValue, Status: "delivered", CreatedAt: now, UpdatedAt: now}
		data.Deliveries["whd_foreign"] = WebhookDelivery{ID: "whd_foreign", MerchantID: "mrc_foreign", Signature: "foreign-delivery-secret", Status: "delivered", CreatedAt: now, UpdatedAt: now}
		data.ConsoleSessions["mcs_export"] = MerchantConsoleSession{ID: "mcs_export", MerchantID: merchant.ID, Account: merchant.PayoutAddress, Role: "owner", TokenHash: sessionValue, ExpiresAt: now.Add(time.Minute), CreatedAt: now}
		data.GatewaySeen[replayValue] = now.Add(time.Minute)
		data.Idempotency["export:internal"] = IdempotencyRecord{Scope: "export", Key: "internal-key", RequestHash: "internal-hash", ObjectID: merchant.ID, CreatedAt: now}
		data.Providers["prv_export"] = ProviderConnection{ID: "prv_export", MerchantID: merchant.ID, ProviderID: "provider-export", Status: "configured", CredentialReference: providerReference, CredentialVersion: "version-1", CreatedAt: now, UpdatedAt: now}
		data.Providers["prv_foreign"] = ProviderConnection{ID: "prv_foreign", MerchantID: "mrc_foreign", ProviderID: "provider-foreign", Status: "configured", CredentialReference: "foreign-credential-reference", CreatedAt: now, UpdatedAt: now}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	exported, err := service.ExportMerchantData(owner)
	if err != nil {
		t.Fatal(err)
	}
	if exported.SchemaVersion != merchantDataExportSchemaVersion || exported.Policy.AutomaticDeletionEnabled || exported.Source != "integrity-protected-merchant-store" {
		t.Fatalf("unexpected export metadata: %+v", exported)
	}
	if exported.Merchant.SecretHash != "" || exported.Merchant.CredentialCipher != "" || exported.Merchant.WebhookSecretCipher != "" || exported.Merchant.InvoiceSigningPrivateCipher != "" {
		t.Fatalf("merchant runtime material was exported: %+v", exported.Merchant)
	}
	if len(exported.Deliveries) != 1 || exported.Deliveries[0].Signature != "" || exported.Deliveries[0].MerchantID != merchant.ID {
		t.Fatalf("delivery authentication or tenant isolation failed: %+v", exported.Deliveries)
	}
	if len(exported.Providers) != 1 || exported.Providers[0].CredentialReference != "" || exported.Providers[0].MerchantID != merchant.ID {
		t.Fatalf("provider credential or tenant isolation failed: %+v", exported.Providers)
	}
	raw, err := json.Marshal(exported)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{deliveryValue, sessionValue, replayValue, providerReference, merchant.SecretHash, merchant.CredentialCipher, merchant.WebhookSecretCipher, merchant.InvoiceSigningPrivateCipher, "internal-key", "internal-hash", "mrc_foreign", "foreign-delivery-secret", "foreign-credential-reference"} {
		if forbidden != "" && strings.Contains(string(raw), forbidden) {
			t.Fatalf("export contains runtime-only value %q", forbidden)
		}
	}

	finance := owner
	finance.Role = "finance"
	if _, err := service.ExportMerchantData(finance); err == nil {
		t.Fatal("finance role exported owner-only merchant data")
	}
	if _, err := service.MerchantDataRights(finance); err == nil {
		t.Fatal("finance role read owner-only merchant data rights")
	}
}

func TestMerchantDeletionRequestIsIdempotentBlockedAndCancelable(t *testing.T) {
	now := time.Date(2026, 7, 27, 13, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	owner := MerchantPrincipal{Merchant: merchant, Account: merchant.PayoutAddress, Role: "owner"}

	if err := service.store.Update(func(data *Snapshot) error {
		data.Invoices["inv_retained"] = Invoice{ID: "inv_retained", MerchantID: merchant.ID, Status: "committed", Settlement: &SettlementEvidence{ID: "set_retained", TransactionHash: "0xabc", BlockNumber: 7, Status: "committed", CommittedAt: now}}
		data.Refunds["rfd_open"] = RefundRequest{ID: "rfd_open", MerchantID: merchant.ID, Status: "requested", CreatedAt: now, UpdatedAt: now}
		data.Disputes["dsp_open"] = Dispute{ID: "dsp_open", MerchantID: merchant.ID, Status: "open", CreatedAt: now, UpdatedAt: now}
		data.Deliveries["whd_pending"] = WebhookDelivery{ID: "whd_pending", MerchantID: merchant.ID, Status: "queued", CreatedAt: now, UpdatedAt: now}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	input := MerchantDeletionRequestInput{ConfirmMerchantID: merchant.ID, Reason: "Close this merchant account after obligations are resolved", IdempotencyKey: "delete-request-01"}
	wrong := input
	wrong.ConfirmMerchantID = "mrc_wrong"
	if _, err := service.RequestMerchantDeletion(owner, wrong); err == nil {
		t.Fatal("wrong merchant confirmation was accepted")
	}
	finance := owner
	finance.Role = "finance"
	if _, err := service.RequestMerchantDeletion(finance, input); err == nil {
		t.Fatal("finance role created owner-only deletion request")
	}

	request, err := service.RequestMerchantDeletion(owner, input)
	if err != nil {
		t.Fatal(err)
	}
	wantBlockers := []string{"financial-record-retention-policy-unaccepted", "open-dispute", "open-refund-request", "pending-webhook-delivery"}
	if request.Status != "retention_blocked" || request.EligibleAt == nil || !request.EligibleAt.Equal(now.Add(merchantDeletionCoolingOffHours*time.Hour)) || !slices.Equal(request.Blockers, wantBlockers) {
		t.Fatalf("deletion request did not fail closed: %+v", request)
	}
	replayed, err := service.RequestMerchantDeletion(owner, input)
	if err != nil || replayed.ID != request.ID {
		t.Fatalf("idempotent replay failed: %+v %v", replayed, err)
	}
	changed := input
	changed.Reason = "A different deletion reason must conflict"
	if _, err := service.RequestMerchantDeletion(owner, changed); err == nil {
		t.Fatal("idempotency key accepted a different request")
	}
	second := input
	second.IdempotencyKey = "delete-request-02"
	if _, err := service.RequestMerchantDeletion(owner, second); err == nil {
		t.Fatal("competing active deletion request was accepted")
	}

	canceled, err := service.CancelMerchantDeletion(owner, request.ID)
	if err != nil || canceled.Status != "canceled" || canceled.CanceledAt == nil || !canceled.CanceledAt.Equal(now) {
		t.Fatalf("deletion cancellation failed: %+v %v", canceled, err)
	}
	overview, err := service.MerchantDataRights(owner)
	if err != nil || overview.Policy.AutomaticDeletionEnabled || overview.Policy.Version != merchantRetentionPolicyVersion || len(overview.Requests) != 1 || overview.Requests[0].Status != "canceled" {
		t.Fatalf("data rights overview is incomplete: %+v %v", overview, err)
	}
	state, err := service.SnapshotForMerchant(merchant.ID)
	if err != nil {
		t.Fatal(err)
	}
	var requested, canceledAudit bool
	for _, entry := range state.Audit {
		requested = requested || entry.Action == "merchant.data.deletion.request" && entry.ObjectID == request.ID
		canceledAudit = canceledAudit || entry.Action == "merchant.data.deletion.cancel" && entry.ObjectID == request.ID
	}
	if !requested || !canceledAudit {
		t.Fatalf("deletion audit trail is incomplete: %+v", state.Audit)
	}
}

func TestMerchantDataRightsHTTPRoutesRequireOwnerSessionAndKeepStatePrivate(t *testing.T) {
	now := time.Date(2026, 7, 27, 13, 30, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	token := "owner-data-rights-token-123456"
	session := MerchantConsoleSession{ID: "mcs_data_rights_owner", MerchantID: merchant.ID, Account: merchant.PayoutAddress, Role: "owner", TokenHash: hashString(token), ExpiresAt: now.Add(10 * time.Minute), CreatedAt: now}
	if err := service.store.Update(func(data *Snapshot) error {
		data.ConsoleSessions[session.ID] = session
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(service).Handler()
	authorization := "Bearer " + session.ID + "." + token

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/v1/merchant/data-rights", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("missing session status=%d", unauthorized.Code)
	}

	rightsRequest := httptest.NewRequest(http.MethodGet, "/v1/merchant/data-rights", nil)
	rightsRequest.Header.Set("Authorization", authorization)
	rightsResponse := httptest.NewRecorder()
	handler.ServeHTTP(rightsResponse, rightsRequest)
	if rightsResponse.Code != http.StatusOK {
		t.Fatalf("data rights status=%d body=%s", rightsResponse.Code, rightsResponse.Body.String())
	}
	var rights MerchantDataRightsOverview
	if err := json.NewDecoder(rightsResponse.Body).Decode(&rights); err != nil {
		t.Fatal(err)
	}
	if rights.MerchantID != merchant.ID || rights.Policy.AutomaticDeletionEnabled || rights.Policy.Version != merchantRetentionPolicyVersion {
		t.Fatalf("unexpected data rights response: %+v", rights)
	}

	requestBody, _ := json.Marshal(MerchantDeletionRequestInput{ConfirmMerchantID: merchant.ID, Reason: "Close this unused merchant account after review", IdempotencyKey: "delete-http-01"})
	deleteRequest := httptest.NewRequest(http.MethodPost, "/v1/merchant/data-deletion-requests", bytes.NewReader(requestBody))
	deleteRequest.Header.Set("Authorization", authorization)
	deleteRequest.Header.Set("Content-Type", "application/json")
	deleteResponse := httptest.NewRecorder()
	handler.ServeHTTP(deleteResponse, deleteRequest)
	if deleteResponse.Code != http.StatusCreated {
		t.Fatalf("deletion request status=%d body=%s", deleteResponse.Code, deleteResponse.Body.String())
	}
	var deletion MerchantDataRequest
	if err := json.NewDecoder(deleteResponse.Body).Decode(&deletion); err != nil {
		t.Fatal(err)
	}
	if deletion.Status != "cooling_off" || deletion.ID == "" {
		t.Fatalf("unexpected deletion response: %+v", deletion)
	}

	stateRequest := httptest.NewRequest(http.MethodGet, "/v1/merchant/state", nil)
	stateRequest.Header.Set("Authorization", authorization)
	stateResponse := httptest.NewRecorder()
	handler.ServeHTTP(stateResponse, stateRequest)
	if stateResponse.Code != http.StatusOK {
		t.Fatalf("merchant state status=%d body=%s", stateResponse.Code, stateResponse.Body.String())
	}
	var state Snapshot
	if err := json.NewDecoder(stateResponse.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	if len(state.DataRequests) != 0 {
		t.Fatalf("generic merchant state exposed owner-only data requests: %+v", state.DataRequests)
	}

	exportRequest := httptest.NewRequest(http.MethodGet, "/v1/merchant/data-export", nil)
	exportRequest.Header.Set("Authorization", authorization)
	exportResponse := httptest.NewRecorder()
	handler.ServeHTTP(exportResponse, exportRequest)
	if exportResponse.Code != http.StatusOK || exportResponse.Header().Get("X-YNX-Data-Export-Schema") != "1" {
		t.Fatalf("data export status=%d schema=%q body=%s", exportResponse.Code, exportResponse.Header().Get("X-YNX-Data-Export-Schema"), exportResponse.Body.String())
	}

	cancelRequest := httptest.NewRequest(http.MethodPost, "/v1/merchant/data-deletion-requests/"+deletion.ID+"/cancel", nil)
	cancelRequest.Header.Set("Authorization", authorization)
	cancelResponse := httptest.NewRecorder()
	handler.ServeHTTP(cancelResponse, cancelRequest)
	if cancelResponse.Code != http.StatusOK {
		t.Fatalf("deletion cancel status=%d body=%s", cancelResponse.Code, cancelResponse.Body.String())
	}
	var canceled MerchantDataRequest
	if err := json.NewDecoder(cancelResponse.Body).Decode(&canceled); err != nil {
		t.Fatal(err)
	}
	if canceled.Status != "canceled" || canceled.CanceledAt == nil {
		t.Fatalf("unexpected cancellation response: %+v", canceled)
	}
}

func TestMerchantDeletionWithoutObligationsUsesCoolingOff(t *testing.T) {
	now := time.Date(2026, 7, 27, 14, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	owner := MerchantPrincipal{Merchant: merchant, Account: merchant.PayoutAddress, Role: "owner"}

	request, err := service.RequestMerchantDeletion(owner, MerchantDeletionRequestInput{ConfirmMerchantID: merchant.ID, Reason: "Close this unused merchant account", IdempotencyKey: "delete-unused-01"})
	if err != nil {
		t.Fatal(err)
	}
	if request.Status != "cooling_off" || len(request.Blockers) != 0 || request.EligibleAt == nil || !request.EligibleAt.Equal(now.Add(merchantDeletionCoolingOffHours*time.Hour)) {
		t.Fatalf("clean deletion request skipped safe cooling off: %+v", request)
	}
	if request.Status == "completed" {
		t.Fatal("request path performed automatic deletion")
	}
}
