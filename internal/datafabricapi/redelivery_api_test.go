package datafabricapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

func TestReplayAPIPreviewApprovalExecuteAndIdempotentRetry(t *testing.T) {
	server, store := newTestServer(t, fakeAuthorizer{})
	event := apiEvent(t)
	if err := store.Append(event, apiTestKey); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkPublished(event.EventID, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	previewBody, _ := json.Marshal(map[string]any{
		"dryRun": true, "aggregateId": event.AggregateID, "limit": 10,
	})
	previewResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(previewResponse, authorizedRequest(t, http.MethodPost, "/replay", previewBody, "pay"))
	if previewResponse.Code != http.StatusOK || !strings.Contains(previewResponse.Body.String(), `"requiresApproval":true`) {
		t.Fatalf("replay preview failed: %d %s", previewResponse.Code, previewResponse.Body.String())
	}
	var previewEnvelope struct {
		Preview datafabric.RedeliveryPreview `json:"preview"`
	}
	if err := json.Unmarshal(previewResponse.Body.Bytes(), &previewEnvelope); err != nil {
		t.Fatal(err)
	}
	if previewEnvelope.Preview.CandidateCount != 1 || previewEnvelope.Preview.Candidates[0].EventID != event.EventID || previewEnvelope.Preview.ScopeHash == "" {
		t.Fatalf("replay preview is incomplete: %+v", previewEnvelope.Preview)
	}

	baseExecution := map[string]any{
		"dryRun": false, "idempotencyKey": "idempotency.replay.api.0001",
		"aggregateId": event.AggregateID, "limit": 10,
		"reason":     "operator-approved redelivery after verified broker outage",
		"approvalId": "approval.replay.api.0001", "approvalStatus": "approved", "confirm": true,
		"auditId": "audit.replay.api.0001",
	}
	unapprovedExecution := cloneAnyMap(baseExecution)
	unapprovedExecution["previewHash"] = previewEnvelope.Preview.ScopeHash
	unapprovedExecution["approvalStatus"] = "pending"
	unapprovedExecution["confirm"] = false
	unapprovedBody, _ := json.Marshal(unapprovedExecution)
	unapprovedResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(unapprovedResponse, authorizedRequest(t, http.MethodPost, "/replay", unapprovedBody, "pay"))
	if unapprovedResponse.Code != http.StatusBadRequest || !strings.Contains(unapprovedResponse.Body.String(), "DF_REDELIVERY_APPROVAL_INVALID_V1") {
		t.Fatalf("unapproved replay was accepted: %d %s", unapprovedResponse.Code, unapprovedResponse.Body.String())
	}

	staleExecution := cloneAnyMap(baseExecution)
	staleExecution["previewHash"] = strings.Repeat("0", 64)
	staleBody, _ := json.Marshal(staleExecution)
	staleResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(staleResponse, authorizedRequest(t, http.MethodPost, "/replay", staleBody, "pay"))
	if staleResponse.Code != http.StatusConflict || !strings.Contains(staleResponse.Body.String(), string(datafabric.CodeRedeliveryPreviewStale)) {
		t.Fatalf("stale replay preview was accepted: %d %s", staleResponse.Code, staleResponse.Body.String())
	}

	baseExecution["previewHash"] = previewEnvelope.Preview.ScopeHash
	executionBody, _ := json.Marshal(baseExecution)
	executionResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(executionResponse, authorizedRequest(t, http.MethodPost, "/replay", executionBody, "pay"))
	body := executionResponse.Body.String()
	if executionResponse.Code != http.StatusCreated || !strings.Contains(body, `"businessCompletion":"pending-consumer-effects"`) || !strings.Contains(body, `"exactlyOnceClaim":"idempotent-effect-not-broker-delivery"`) {
		t.Fatalf("replay execution truth is invalid: %d %s", executionResponse.Code, body)
	}
	var executionEnvelope struct {
		Run datafabric.RedeliveryRun `json:"run"`
	}
	if err := json.Unmarshal(executionResponse.Body.Bytes(), &executionEnvelope); err != nil {
		t.Fatal(err)
	}
	if executionEnvelope.Run.EnqueuedCount != 1 || executionEnvelope.Run.Status != "completed" || len(store.PendingOutbox(time.Now().UTC().Add(time.Minute), 10)) != 1 {
		t.Fatalf("replay did not requeue the canonical Outbox record: %+v", executionEnvelope.Run)
	}

	retryResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(retryResponse, authorizedRequest(t, http.MethodPost, "/v1/replay", executionBody, "pay"))
	if retryResponse.Code != http.StatusCreated || !strings.Contains(retryResponse.Body.String(), executionEnvelope.Run.RunID) || len(store.RedeliveryRuns()) != 1 {
		t.Fatalf("idempotent replay retry created a second run: %d %s", retryResponse.Code, retryResponse.Body.String())
	}
}

func TestBackfillAPISkipsExistingPendingOutbox(t *testing.T) {
	server, store := newTestServer(t, fakeAuthorizer{})
	event := apiEvent(t)
	if err := store.Append(event, apiTestKey); err != nil {
		t.Fatal(err)
	}
	previewBody, _ := json.Marshal(map[string]any{"dryRun": true, "eventType": event.EventType, "limit": 10})
	previewResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(previewResponse, authorizedRequest(t, http.MethodPost, "/backfill", previewBody, "pay"))
	var previewEnvelope struct {
		Preview datafabric.RedeliveryPreview `json:"preview"`
	}
	if previewResponse.Code != http.StatusOK || json.Unmarshal(previewResponse.Body.Bytes(), &previewEnvelope) != nil || previewEnvelope.Preview.CandidateCount != 1 || previewEnvelope.Preview.Candidates[0].DeliveryStatus != "pending" {
		t.Fatalf("pending backfill preview failed: %d %s", previewResponse.Code, previewResponse.Body.String())
	}
	executionBody, _ := json.Marshal(map[string]any{
		"dryRun": false, "idempotencyKey": "idempotency.backfill.api.0001", "eventType": event.EventType, "limit": 10,
		"previewHash": previewEnvelope.Preview.ScopeHash, "reason": "approved historical consumer backfill",
		"approvalId": "approval.backfill.api.0001", "approvalStatus": "approved", "confirm": true,
		"auditId": "audit.backfill.api.0001",
	})
	executionResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(executionResponse, authorizedRequest(t, http.MethodPost, "/v1/backfill", executionBody, "pay"))
	if executionResponse.Code != http.StatusCreated || !strings.Contains(executionResponse.Body.String(), `"skippedPending":1`) || !strings.Contains(executionResponse.Body.String(), `"enqueuedCount":0`) || len(store.PendingOutbox(time.Now().UTC().Add(time.Minute), 10)) != 1 {
		t.Fatalf("backfill duplicated an existing pending Outbox record: %d %s", executionResponse.Code, executionResponse.Body.String())
	}
}

func cloneAnyMap(input map[string]any) map[string]any {
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}
