package datafabricapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

func TestHealthAndVersionExposeEvidenceBackedRuntimeState(t *testing.T) {
	server, _ := newTestServer(t, fakeAuthorizer{})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
	body := response.Body.String()
	for _, required := range []string{
		`"commit":"719e1018267ed5a53e6fae5211c5fd8a1503c35c"`,
		`"release":"data-fabric-testnet-v0"`, `"schemaVersion":"2.0"`, `"databaseStatus":"verified"`,
		`"brokerStatus":"unobserved"`, `"ledgerStatus":"verified"`, `"consumerLag":0`,
		`"deadLetterCount":0`, `"broker-status-unobserved"`, `"startedAt"`, `"dependencyStatus"`,
	} {
		if response.Code != http.StatusOK || !strings.Contains(body, required) {
			t.Fatalf("health is missing %s: %d %s", required, response.Code, body)
		}
	}

	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/version", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"schemaVersion":"2.0"`) || !strings.Contains(response.Body.String(), `"startedAt"`) || strings.Contains(response.Body.String(), `"version"`) {
		t.Fatalf("version endpoint is not source-bound: %d %s", response.Code, response.Body.String())
	}
}

func TestHealthBrokerProbeFailureIsDegradedWithoutSecretLeak(t *testing.T) {
	store, err := datafabric.OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Config{
		Store: store, Authorizer: fakeAuthorizer{}, EventKeys: map[string][]byte{"key.datafabric.0001": apiTestKey},
		EventKeyProducts: map[string]string{"key.datafabric.0001": "pay"}, PrivacyKey: []byte("abcdef0123456789abcdef0123456789"),
		SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0",
		BrokerKind: "nats-jetstream", BrokerProbe: func(context.Context) error { return errors.New("broker tls endpoint and credential are unavailable") },
	})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
	body := response.Body.String()
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(body, `"brokerStatus":"failed"`) || !strings.Contains(body, `"broker-unavailable"`) || strings.Contains(body, "credential") || strings.Contains(body, "endpoint") {
		t.Fatalf("broker failure health boundary is invalid: %d %s", response.Code, body)
	}
}
