package datafabricapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

func TestChainCoreHTTPCommitmentVerifierConsumesFrozenReadContract(t *testing.T) {
	const commitmentID = "0123456789abcdef0123456789abcdef"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/data/commitments/"+commitmentID {
			t.Fatalf("unexpected Chain Core request: %s %s", r.Method, r.URL.Path)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"schemaVersion": 1, "source": datafabric.ChainCoreDataCommitmentSource,
			"asOf": "2026-08-14T12:00:00Z", "version": datafabric.ChainCoreDataCommitmentVersion,
			"coverage": "exact", "failure": false,
			"commitment": map[string]any{"id": commitmentID, "owner": "ynx1signerderived", "productId": "pay", "contentHash": strings.Repeat("a", 64)},
		})
	}))
	defer upstream.Close()

	verifier := ChainCoreHTTPCommitmentVerifier{Endpoint: upstream.URL}
	if err := verifier.VerifyChainCommitment(context.Background(), datafabric.ChainCommitmentReference{ChainCommitmentID: commitmentID, EventID: "event.pay.chain.0001"}); err != nil {
		t.Fatalf("frozen read contract was rejected: %v", err)
	}

	for name, response := range map[string]map[string]any{
		"wrong-id":  {"schemaVersion": 1, "source": datafabric.ChainCoreDataCommitmentSource, "asOf": "2026-08-14T12:00:00Z", "version": datafabric.ChainCoreDataCommitmentVersion, "coverage": "exact", "failure": false, "commitment": map[string]any{"id": strings.Repeat("f", 32)}},
		"not-exact": {"schemaVersion": 1, "source": datafabric.ChainCoreDataCommitmentSource, "asOf": "2026-08-14T12:00:00Z", "version": datafabric.ChainCoreDataCommitmentVersion, "coverage": "none", "failure": true, "commitment": map[string]any{"id": commitmentID}},
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, response) }))
			defer server.Close()
			err := (ChainCoreHTTPCommitmentVerifier{Endpoint: server.URL}).VerifyChainCommitment(context.Background(), datafabric.ChainCommitmentReference{ChainCommitmentID: commitmentID, EventID: "event.pay.chain.0001"})
			if datafabric.ErrorCodeOf(err) != datafabric.CodeChainCommitmentRejected {
				t.Fatalf("contradictory Chain Core evidence was accepted: %v", err)
			}
		})
	}
}

func TestEventIngressRequiresCommittedChainReference(t *testing.T) {
	const commitmentID = "0123456789abcdef0123456789abcdef"
	event := apiEvent(t)
	if err := event.PromoteToV2(datafabric.V2EnvelopeContext{
		Producer: "producer.pay.0001", AggregateType: "aggregate.invoice",
		TraceID: "trace.pay.chain.0001", RequestID: "request.pay.chain.0001", ResidencyClass: "account-home",
		ChainCommitmentID: commitmentID, IdempotencyKey: "idempotency.pay.chain.0001",
		ReceivedAt: event.Timestamp.Add(time.Second), Metadata: map[string]string{"contract": "chain-core-v1"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := event.Sign("key.datafabric.0001", apiTestKey); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}

	server, store := newTestServer(t, fakeAuthorizer{})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/events", body, "pay"))
	if response.Code != http.StatusServiceUnavailable || len(store.Events()) != 0 || !strings.Contains(response.Body.String(), string(datafabric.CodeChainCommitmentUnavailable)) {
		t.Fatalf("unverified chain reference was stored: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, producerRequest(t, body, time.Now().UTC().Format(time.RFC3339Nano), "nonce.chain.producer.0001", "key.datafabric.0001", apiTestKey))
	if response.Code != http.StatusServiceUnavailable || len(store.Events()) != 0 {
		t.Fatalf("producer ingress bypassed chain verification: %d %s", response.Code, response.Body.String())
	}

	verifier := chainVerifierFunc(func(_ context.Context, reference datafabric.ChainCommitmentReference) error {
		if reference.ChainCommitmentID != commitmentID {
			return fmt.Errorf("wrong commitment")
		}
		return nil
	})
	server, store = newTestServerWithChainVerifier(t, verifier)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/events", body, "pay"))
	if response.Code != http.StatusAccepted || len(store.Events()) != 1 {
		t.Fatalf("verified chain reference was not stored: %d %s", response.Code, response.Body.String())
	}
}

type chainVerifierFunc func(context.Context, datafabric.ChainCommitmentReference) error

func (f chainVerifierFunc) VerifyChainCommitment(ctx context.Context, reference datafabric.ChainCommitmentReference) error {
	return f(ctx, reference)
}

func newTestServerWithChainVerifier(t *testing.T, verifier datafabric.ChainCommitmentVerifier) (*Server, *datafabric.Store) {
	t.Helper()
	store, err := datafabric.OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Config{Store: store, Authorizer: fakeAuthorizer{}, EventKeys: map[string][]byte{"key.datafabric.0001": apiTestKey}, EventKeyProducts: map[string]string{"key.datafabric.0001": "pay"}, PrivacyKey: []byte("abcdef0123456789abcdef0123456789"), SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0", ChainCommitmentVerifier: verifier})
	if err != nil {
		t.Fatal(err)
	}
	return server, store
}
