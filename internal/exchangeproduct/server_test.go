package exchangeproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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

type readyTestRepository struct{ state persistentState }

func (r readyTestRepository) Load() (persistentState, bool, error) { return r.state, true, nil }
func (readyTestRepository) Save(string, *persistentState) error    { return nil }
func (readyTestRepository) Mode() string                           { return "postgres-cas-multi-instance" }

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

func TestHealthDoesNotClaimExecutionWithoutStrategyVaultEvidence(t *testing.T) {
	service, _, _ := newTestService(t)
	server := NewServer(service)
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		RoutingAvailable  bool `json:"routingAvailable"`
		ProductionCustody bool `json:"productionCustody"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.RoutingAvailable || body.ProductionCustody {
		t.Fatalf("health overclaimed execution or custody: %+v", body)
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
		Status             string `json:"status"`
		StateStore         string `json:"stateStore"`
		MultiInstanceState bool   `json:"multiInstanceState"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "degraded_single_host" || body.StateStore != "file-cas-single-host" || body.MultiInstanceState {
		t.Fatalf("file snapshot readiness overclaimed deployability: %+v", body)
	}
}

func TestReadyAcceptsMultiInstanceDurableStore(t *testing.T) {
	state := newState()
	state.IntegrityHash, _ = stateIntegrity(state)
	service := &Service{stateRepository: readyTestRepository{state: state}, state: state}
	server := NewServer(service)
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Status             string `json:"status"`
		StateStore         string `json:"stateStore"`
		MultiInstanceState bool   `json:"multiInstanceState"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "ready_local_engine" || body.StateStore != "postgres-cas-multi-instance" || !body.MultiInstanceState {
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

func TestMissingDurableStateCannotPromoteCachedPublicMarketAndRecoversExactly(t *testing.T) {
	service, _, path := newTestService(t)
	if _, err := service.CreditTestQuote(adminKey, alice, AmountScale, "missing-state-fixture"); err != nil {
		t.Fatal(err)
	}
	before := cloneState(service.state)
	server := httptest.NewServer(NewServer(service))
	defer server.Close()
	retained := path + ".retained"
	if err := os.Rename(path, retained); err != nil {
		t.Fatal(err)
	}
	for _, route := range []string{"/v1/markets", "/v1/orderbook", "/v1/market-data/snapshot", "/v1/market-data/stream"} {
		response, err := http.Get(server.URL + route)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		err = json.NewDecoder(response.Body).Decode(&body)
		response.Body.Close()
		if err != nil || response.StatusCode != http.StatusServiceUnavailable || body["code"] != "state_refresh_failed" {
			t.Fatalf("route=%s status=%d body=%v error=%v", route, response.StatusCode, body, err)
		}
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("failed read recreated missing authority: %v", err)
		}
	}
	if service.state.IntegrityHash != before.IntegrityHash || service.state.Sequence != before.Sequence {
		t.Fatal("failed reads replaced retained state")
	}
	if err := os.Rename(retained, path); err != nil {
		t.Fatal(err)
	}
	response, err := http.Get(server.URL + "/v1/market-data/snapshot")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var snapshot MarketDataSnapshot
	if err := json.NewDecoder(response.Body).Decode(&snapshot); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || snapshot.Revision != before.Sequence || snapshot.SourceMetadata.Status != "degraded_single_host" || snapshot.SourceMetadata.MultiInstance || service.state.IntegrityHash != before.IntegrityHash {
		t.Fatalf("recovery changed or promoted state: status=%d snapshot=%+v", response.StatusCode, snapshot)
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

func TestOpenMarketStreamClosesWhenDurableAuthorityDisappears(t *testing.T) {
	service, _, path := newTestService(t)
	previousInterval := marketDataStreamPollInterval
	marketDataStreamPollInterval = 5 * time.Millisecond
	defer func() { marketDataStreamPollInterval = previousInterval }()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	response := newStreamingRecorder()
	done := make(chan struct{})
	go func() {
		NewServer(service).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/market-data/stream", nil).WithContext(ctx))
		close(done)
	}()
	select {
	case <-response.wrote:
	case <-time.After(time.Second):
		t.Fatal("stream did not emit the initial durable snapshot")
	}
	if err := os.Rename(path, path+".retained"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("missing authority did not close the stream")
	}
	body := response.String()
	if !bytes.Contains([]byte(body), []byte("event: source-unavailable\n")) || bytes.Contains([]byte(body), []byte("event: reconciled\n")) {
		t.Fatalf("missing authority promoted or hid source failure: %s", body)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("stream recreated missing durable state: %v", err)
	}
}
