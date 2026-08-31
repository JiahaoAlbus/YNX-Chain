package datafabricapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

type blockingAppendRepository struct {
	Repository
	entered chan struct{}
	release chan struct{}
}

func (r blockingAppendRepository) Append(ctx context.Context, event datafabric.EventEnvelope, key []byte) error {
	r.entered <- struct{}{}
	select {
	case <-r.release:
		return r.Repository.Append(ctx, event, key)
	case <-ctx.Done():
		return ctx.Err()
	}
}

func TestProducerConcurrencyBackpressureDoesNotConsumeRetryNonce(t *testing.T) {
	store, err := datafabric.OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	repository := blockingAppendRepository{Repository: LocalRepository{Store: store}, entered: make(chan struct{}, 2), release: make(chan struct{}, 2)}
	server, err := New(Config{
		Repository: repository, Authorizer: fakeAuthorizer{},
		EventKeys:        map[string][]byte{"key.datafabric.0001": apiTestKey},
		EventKeyProducts: map[string]string{"key.datafabric.0001": "pay"},
		PrivacyKey:       []byte("abcdef0123456789abcdef0123456789"),
		SourceCommit:     "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0",
		ProducerConcurrencyLimit: 1,
	})
	if err != nil {
		t.Fatal(err)
	}

	firstEvent := apiEvent(t)
	firstBody, _ := json.Marshal(firstEvent)
	firstTimestamp := time.Now().UTC().Format(time.RFC3339Nano)
	firstDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, producerRequest(t, firstBody, firstTimestamp, "nonce.producer.backpressure.0001", "key.datafabric.0001", apiTestKey))
		firstDone <- response
	}()
	<-repository.entered

	secondEvent := firstEvent
	secondEvent.EventID = "event.pay.invoice.api.0002"
	secondEvent.AggregateID = "invoice.api.0002"
	secondEvent.CorrelationID = "correlation.api.0002"
	secondEvent.CausationID = "command.api.0002"
	secondEvent.AuditID = "audit.api.0002"
	if err := secondEvent.Sign("key.datafabric.0001", apiTestKey); err != nil {
		t.Fatal(err)
	}
	secondBody, _ := json.Marshal(secondEvent)
	secondTimestamp := time.Now().UTC().Format(time.RFC3339Nano)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, producerRequest(t, secondBody, secondTimestamp, "nonce.producer.backpressure.0002", "key.datafabric.0001", apiTestKey))
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") != "1" || !strings.Contains(response.Body.String(), "producer_backpressure") {
		t.Fatalf("producer saturation did not return bounded backpressure: %d %s", response.Code, response.Body.String())
	}

	repository.release <- struct{}{}
	if first := <-firstDone; first.Code != http.StatusAccepted {
		t.Fatalf("first producer was not committed: %d %s", first.Code, first.Body.String())
	}

	retryDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		retry := httptest.NewRecorder()
		server.Handler().ServeHTTP(retry, producerRequest(t, secondBody, secondTimestamp, "nonce.producer.backpressure.0002", "key.datafabric.0001", apiTestKey))
		retryDone <- retry
	}()
	<-repository.entered
	repository.release <- struct{}{}
	if retry := <-retryDone; retry.Code != http.StatusAccepted || len(store.Events()) != 2 {
		t.Fatalf("backpressured producer could not retry the same signed nonce: %d %s", retry.Code, retry.Body.String())
	}

	metrics := httptest.NewRecorder()
	server.Handler().ServeHTTP(metrics, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	for _, want := range []string{
		"ynx_data_fabric_producer_concurrency_limit 1",
		"ynx_data_fabric_producer_peak_inflight 1",
		"ynx_data_fabric_producer_backpressure_total 1",
		"ynx_data_fabric_producer_inflight 0",
	} {
		if metrics.Code != http.StatusOK || !strings.Contains(metrics.Body.String(), want) {
			t.Fatalf("producer backpressure metric %q is missing: %d %s", want, metrics.Code, metrics.Body.String())
		}
	}
}
