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

func TestMerchantOperationsHTTPRBACAndValidation(t *testing.T) {
	now := time.Date(2026, 7, 27, 18, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	ownerAuth := addOperationsSession(t, service, merchant, "owner", strings.Repeat("o", 12))
	viewerAuth := addOperationsSession(t, service, merchant, "viewer", strings.Repeat("v", 12))
	if err := service.store.Update(func(data *Snapshot) error {
		data.Invoices["inv_http_ops"] = Invoice{Version: 1, ID: "inv_http_ops", MerchantID: merchant.ID, Description: "HTTP operations", Amount: 9, Asset: NativeAsset, Network: ChainID, Status: "pending", CreatedAt: now}
		data.Deliveries["whd_http_ops"] = WebhookDelivery{ID: "whd_http_ops", MerchantID: merchant.ID, EventType: "invoice.committed", ObjectID: "inv_http_ops", Status: "failed", CreatedAt: now, UpdatedAt: now}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(service).Handler()

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/v1/merchant/operations", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("missing operations session status=%d", unauthorized.Code)
	}
	setOperationsMemberRole(t, service, merchant, "viewer")

	request := httptest.NewRequest(http.MethodGet, "/v1/merchant/operations?kind=invoice&q=http&limit=1", nil)
	request.Header.Set("Authorization", viewerAuth)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("operations route status=%d cache=%q body=%s", response.Code, response.Header().Get("Cache-Control"), response.Body.String())
	}
	var page MerchantOperationsPage
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if page.SchemaVersion != 1 || len(page.Items) != 1 || page.Items[0].ID != "inv_http_ops" {
		t.Fatalf("unexpected operations route response: %+v", page)
	}

	badTime := httptest.NewRequest(http.MethodGet, "/v1/merchant/operations?from=not-a-time", nil)
	badTime.Header.Set("Authorization", viewerAuth)
	badTimeResponse := httptest.NewRecorder()
	handler.ServeHTTP(badTimeResponse, badTime)
	if badTimeResponse.Code != http.StatusBadRequest {
		t.Fatalf("invalid operation time status=%d", badTimeResponse.Code)
	}

	previewBody, _ := json.Marshal(BulkWebhookRetryPreviewInput{DeliveryIDs: []string{"whd_http_ops"}})
	forbidden := httptest.NewRequest(http.MethodPost, "/v1/merchant/webhooks/bulk-retry/preview", bytes.NewReader(previewBody))
	forbidden.Header.Set("Authorization", viewerAuth)
	forbiddenResponse := httptest.NewRecorder()
	handler.ServeHTTP(forbiddenResponse, forbidden)
	if forbiddenResponse.Code != http.StatusForbidden {
		t.Fatalf("viewer bulk preview status=%d body=%s", forbiddenResponse.Code, forbiddenResponse.Body.String())
	}
	setOperationsMemberRole(t, service, merchant, "owner")

	previewRequest := httptest.NewRequest(http.MethodPost, "/v1/merchant/webhooks/bulk-retry/preview", bytes.NewReader(previewBody))
	previewRequest.Header.Set("Authorization", ownerAuth)
	previewResponse := httptest.NewRecorder()
	handler.ServeHTTP(previewResponse, previewRequest)
	if previewResponse.Code != http.StatusOK {
		t.Fatalf("owner bulk preview status=%d body=%s", previewResponse.Code, previewResponse.Body.String())
	}
	var preview BulkWebhookRetryPreview
	if err := json.NewDecoder(previewResponse.Body).Decode(&preview); err != nil {
		t.Fatal(err)
	}
	if preview.ConfirmationToken == "" || len(preview.Items) != 1 || preview.Items[0].ID != "whd_http_ops" {
		t.Fatalf("owner bulk preview incomplete: %+v", preview)
	}

	executeInput := bulkRetryInputFromPreview(t, preview, []string{"whd_http_ops"}, strings.Repeat("h", 12))
	executeBody, _ := json.Marshal(executeInput)
	executeRequest := httptest.NewRequest(http.MethodPost, "/v1/merchant/webhooks/bulk-retry", bytes.NewReader(executeBody))
	executeRequest.Header.Set("Authorization", ownerAuth)
	executeResponse := httptest.NewRecorder()
	handler.ServeHTTP(executeResponse, executeRequest)
	if executeResponse.Code != http.StatusOK {
		t.Fatalf("owner bulk execute status=%d body=%s", executeResponse.Code, executeResponse.Body.String())
	}
	var result BulkWebhookRetryResult
	if err := json.NewDecoder(executeResponse.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Attempted != 1 || result.Items[0].ID != "whd_http_ops" || result.Replayed {
		t.Fatalf("owner bulk execute incomplete: %+v", result)
	}
}

func addOperationsSession(t *testing.T, service *Service, merchant Merchant, role, sessionValue string) string {
	t.Helper()
	id := "mcs_ops_" + role
	session := MerchantConsoleSession{ID: id, MerchantID: merchant.ID, Account: merchant.PayoutAddress, Role: role, TokenHash: hashString(sessionValue), ExpiresAt: service.now().Add(10 * time.Minute), CreatedAt: service.now()}
	if err := service.store.Update(func(data *Snapshot) error {
		data.ConsoleSessions[id] = session
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return "Bearer " + id + "." + sessionValue
}

func setOperationsMemberRole(t *testing.T, service *Service, merchant Merchant, role string) {
	t.Helper()
	if err := service.store.Update(func(data *Snapshot) error {
		key := merchant.ID + ":" + merchant.PayoutAddress
		member := data.MerchantMembers[key]
		member.Role = role
		member.UpdatedAt = service.now().UTC()
		data.MerchantMembers[key] = member
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
