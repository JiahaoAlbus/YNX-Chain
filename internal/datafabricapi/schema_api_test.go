package datafabricapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

func TestSchemaRegistryAPIIsProductScopedAndAuthoritative(t *testing.T) {
	server, _ := newTestServer(t, fakeAuthorizer{})

	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodGet, "/v1/schemas", nil, "pay"))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"registryVersion":"2.0"`) || !strings.Contains(response.Body.String(), `"eventType":"pay.invoice.created"`) || !strings.Contains(response.Body.String(), `"version":"2.0"`) || strings.Contains(response.Body.String(), `"eventType":"shop.order.created"`) {
		t.Fatalf("product-scoped schema registry response is invalid: %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodGet, "/v1/schemas/pay.invoice.created/1.0", nil, "pay"))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"owner":"ynx-pay"`) {
		t.Fatalf("registered schema could not be resolved: %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodGet, "/v1/schemas/shop.order.created/1.0", nil, "pay"))
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), string(datafabric.CodeSchemaProductMismatch)) {
		t.Fatalf("cross-product schema read was accepted: %d %s", response.Code, response.Body.String())
	}
}

func TestSchemaCompatibilityAPIAndUnknownEventFailClosed(t *testing.T) {
	server, store := newTestServer(t, fakeAuthorizer{})
	requestBody, _ := json.Marshal(map[string]string{"eventType": "pay.invoice.created", "fromVersion": "1.0", "toVersion": "1.0"})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/schemas/compatibility", requestBody, "pay"))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"compatible":true`) {
		t.Fatalf("schema compatibility response is invalid: %d %s", response.Code, response.Body.String())
	}

	event := apiEvent(t)
	event.EventType = "pay.invoice.unregistered"
	if err := event.Sign("key.datafabric.0001", apiTestKey); err != nil {
		t.Fatal(err)
	}
	eventBody, _ := json.Marshal(event)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/events", eventBody, "pay"))
	if response.Code != http.StatusUnprocessableEntity || !strings.Contains(response.Body.String(), string(datafabric.CodeUnknownEventType)) || len(store.Events()) != 0 {
		t.Fatalf("unregistered event reached the Outbox: %d %s", response.Code, response.Body.String())
	}
}
