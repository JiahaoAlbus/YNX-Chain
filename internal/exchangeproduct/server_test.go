package exchangeproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

type streamingRecorder struct {
	header http.Header
	mu     sync.Mutex
	status int
	body   bytes.Buffer
	wrote  chan struct{}
	once   sync.Once
}

func newStreamingRecorder() *streamingRecorder {
	return &streamingRecorder{header: make(http.Header), wrote: make(chan struct{})}
}

func (w *streamingRecorder) Header() http.Header    { return w.header }
func (w *streamingRecorder) WriteHeader(status int) { w.status = status }
func (w *streamingRecorder) Write(value []byte) (int, error) {
	w.mu.Lock()
	n, err := w.body.Write(value)
	w.mu.Unlock()
	w.once.Do(func() { close(w.wrote) })
	return n, err
}
func (w *streamingRecorder) Flush() {}
func (w *streamingRecorder) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.body.String()
}

func TestHealthDisclosesFileSnapshotIsNotMultiInstance(t *testing.T) {
	service, _, _ := newTestService(t)
	server := NewServer(service)
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		StateBackend  string `json:"stateBackend"`
		MultiInstance bool   `json:"multiInstance"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.StateBackend != "file_snapshot" || body.MultiInstance {
		t.Fatalf("storage readiness overclaimed multi-instance support: %+v", body)
	}
}

func TestReadyRejectsFileSnapshotForDeployableVenue(t *testing.T) {
	service, _, _ := newTestService(t)
	server := NewServer(service)
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Status        string `json:"status"`
		StateBackend  string `json:"stateBackend"`
		MultiInstance bool   `json:"multiInstance"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "not_ready" || body.StateBackend != "file_snapshot" || body.MultiInstance {
		t.Fatalf("file snapshot readiness overclaimed deployability: %+v", body)
	}
}

func TestReadyAcceptsMultiInstanceDurableStore(t *testing.T) {
	service := &Service{store: conflictStateStore{}, state: newState()}
	server := NewServer(service)
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Status        string `json:"status"`
		StateBackend  string `json:"stateBackend"`
		MultiInstance bool   `json:"multiInstance"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "ready" || body.StateBackend != "postgresql" || !body.MultiInstance {
		t.Fatalf("durable backend readiness was not reported: %+v", body)
	}
}

func TestPublicReadsDiscloseSourceCoverageAndFileBackendDegradation(t *testing.T) {
	service, _, _ := newTestService(t)
	server := NewServer(service)
	for _, path := range []string{"/v1/markets", "/v1/orderbook", "/v1/market-data/trades"} {
		response := httptest.NewRecorder()
		server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("path=%s status=%d body=%s", path, response.Code, response.Body.String())
		}
		var body struct {
			SourceMetadata SourceMetadata `json:"sourceMetadata"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.SourceMetadata.Authority != "YNX-owned deterministic order state" || body.SourceMetadata.Classification != "testnet" || body.SourceMetadata.Status != "degraded_single_host" || body.SourceMetadata.MultiInstance || body.SourceMetadata.Coverage == "" || body.SourceMetadata.AsOf.IsZero() {
			t.Fatalf("path=%s invalid source metadata: %+v", path, body.SourceMetadata)
		}
	}
}

func TestMarketDataStreamEmitsReadOnlyDurableSnapshotAndClosesOnDisconnect(t *testing.T) {
	service, _, _ := newTestService(t)
	server := NewServer(service)
	previousInterval := marketDataStreamPollInterval
	marketDataStreamPollInterval = 5 * time.Millisecond
	defer func() { marketDataStreamPollInterval = previousInterval }()
	ctx, cancel := context.WithCancel(context.Background())
	response := newStreamingRecorder()
	done := make(chan struct{})
	go func() {
		server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/market-data/stream", nil).WithContext(ctx))
		close(done)
	}()
	select {
	case <-response.wrote:
	case <-time.After(time.Second):
		t.Fatal("stream did not emit an initial snapshot")
	}
	if _, err := service.CreditTestQuote(adminKey, alice, AmountScale, "stream-reconcile-credit"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for !bytes.Contains([]byte(response.String()), []byte("event: reconciled\n")) && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if body := response.String(); !bytes.Contains([]byte(body), []byte("event: reconciled\n")) {
		t.Fatalf("stream did not reconcile durable state revision: %q", body)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("stream did not close after subscriber disconnect")
	}
	if got := response.Header().Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("content-type=%q", got)
	}
	var event struct {
		Revision       int64          `json:"revision"`
		Market         string         `json:"market"`
		SourceMetadata SourceMetadata `json:"sourceMetadata"`
	}
	body := []byte(response.String())
	if !bytes.Contains(body, []byte("event: snapshot\n")) || !bytes.Contains(body, []byte("id: state-")) {
		t.Fatalf("missing SSE snapshot framing: %q", body)
	}
	dataPrefix := []byte("event: snapshot\ndata: ")
	start := bytes.Index(body, dataPrefix)
	if start < 0 {
		t.Fatalf("missing SSE data: %q", body)
	}
	data := body[start+len(dataPrefix):]
	data = bytes.Split(data, []byte("\n\n"))[0]
	if err := json.Unmarshal(data, &event); err != nil {
		t.Fatal(err)
	}
	if event.Market != DefaultMarket || event.SourceMetadata.Coverage != "stream-orderbook-matched-trades" || event.SourceMetadata.Status != "degraded_single_host" {
		t.Fatalf("stream snapshot overclaimed or malformed: %+v", event)
	}
}
