package commerce

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestHealthReportsExactRuntimeAndDependencyBoundaries(t *testing.T) {
	store, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(store, ServerConfig{}).Handler())
	defer server.Close()
	response, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("health status=%d", response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	for _, expected := range []string{`"status":"healthy"`, `"version":"0.3.0-testnet-preview"`, `"commit":"development"`, `"startedAt":`, `"integrityProtected":false`, `"walletGateway":"unavailable"`, `"pay":"unavailable"`, `"trust":"unavailable"`, `"ai":"unavailable"`} {
		if !strings.Contains(text, expected) {
			t.Fatalf("health missing %q in %s", expected, text)
		}
	}
}

func TestPrometheusMetricsExposeBoundedRuntimeAndState(t *testing.T) {
	store, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(store, ServerConfig{}).Handler())
	defer server.Close()
	for _, endpoint := range []string{"/health", "/api/products", "/missing"} {
		response, requestErr := http.Get(server.URL + endpoint)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
	}
	response, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("metrics status=%d", response.StatusCode)
	}
	if got := response.Header.Get("Content-Type"); got != "text/plain; version=0.0.4; charset=utf-8" {
		t.Fatalf("metrics content type=%q", got)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	for _, expected := range []string{
		`ynx_shop_build_info{version="0.3.0-testnet-preview",commit="development"} 1`,
		`ynx_shop_http_requests_total{method="GET",route_group="health",status_class="2xx"} 1`,
		`ynx_shop_http_requests_total{method="GET",route_group="api_products",status_class="2xx"} 1`,
		`ynx_shop_http_requests_total{method="GET",route_group="not_found",status_class="4xx"} 1`,
		`ynx_shop_http_request_duration_seconds_count{route_group="health"} 1`,
		`ynx_shop_persistence_schema_version 2`,
		`ynx_shop_state_products 0`,
		`ynx_shop_state_reserved_units 0`,
		`ynx_shop_provider_available{provider="wallet_gateway"} 0`,
		`ynx_shop_provider_available{provider="pay"} 0`,
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("metrics missing %q in:\n%s", expected, text)
		}
	}
	if strings.Contains(text, server.URL) || strings.Contains(text, "Authorization") {
		t.Fatalf("metrics leaked request-specific data:\n%s", text)
	}
}

func TestObservePreservesFlushCapability(t *testing.T) {
	store, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store, ServerConfig{})
	handler := server.observe(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("observability wrapper removed http.Flusher")
		}
		w.WriteHeader(http.StatusAccepted)
		flusher.Flush()
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/ai/jobs/job/stream", nil))
	if recorder.Code != http.StatusAccepted || !recorder.Flushed {
		t.Fatalf("status=%d flushed=%v", recorder.Code, recorder.Flushed)
	}
}

func TestShopConcurrentReadLoadBaseline(t *testing.T) {
	if testing.Short() {
		t.Skip("capacity baseline skipped in short mode")
	}
	store, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, seller := actor(t, 91)
	merchant, err := store.CreateStore(seller, CreateStoreInput{
		Name:           "Capacity Field Store",
		Description:    "Local capacity fixture with bounded public catalog data.",
		Policy:         "Returns require order evidence.",
		TrustURL:       "https://trust.ynxweb4.com/cases",
		IdempotencyKey: "capacity-store-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.ActivateStore(seller, merchant.ID); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 24; index++ {
		product, createErr := store.CreateProduct(seller, CreateProductInput{
			StoreID:        merchant.ID,
			Title:          fmt.Sprintf("Capacity field kit %02d", index),
			Description:    "Published catalog item used only for deterministic local capacity measurement.",
			Category:       "field-kits",
			IdempotencyKey: fmt.Sprintf("capacity-product-%02d", index),
			Media: []MediaAsset{{
				URL:     fmt.Sprintf("https://media.ynxweb4.com/capacity/field-kit-%02d.jpg", index),
				AltText: fmt.Sprintf("Capacity field kit %02d", index),
				Kind:    "image",
			}},
			Variants: []Variant{
				{Name: "Standard", SKU: fmt.Sprintf("CAP-%02d-STD", index), PriceYNXT: int64(20 + index), Inventory: 500},
				{Name: "Extended", SKU: fmt.Sprintf("CAP-%02d-EXT", index), PriceYNXT: int64(30 + index), Inventory: 250},
			},
		})
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, publishErr := store.PublishProduct(seller, product.ID); publishErr != nil {
			t.Fatal(publishErr)
		}
	}

	server := httptest.NewServer(NewServer(store, ServerConfig{}).Handler())
	defer server.Close()
	transport := &http.Transport{MaxIdleConns: 64, MaxIdleConnsPerHost: 64, MaxConnsPerHost: 64}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	const totalRequests = 3000
	const concurrency = 32
	jobs := make(chan int)
	durations := make([]time.Duration, totalRequests)
	var failures atomic.Int64
	var workers sync.WaitGroup
	started := time.Now()
	for worker := 0; worker < concurrency; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				requestStarted := time.Now()
				response, requestErr := client.Get(server.URL + "/api/products?q=field")
				if requestErr != nil {
					failures.Add(1)
					durations[index] = time.Since(requestStarted)
					continue
				}
				_, copyErr := io.Copy(io.Discard, response.Body)
				closeErr := response.Body.Close()
				if response.StatusCode != http.StatusOK || copyErr != nil || closeErr != nil {
					failures.Add(1)
				}
				durations[index] = time.Since(requestStarted)
			}
		}()
	}
	for index := 0; index < totalRequests; index++ {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	elapsed := time.Since(started)
	if failures.Load() != 0 {
		t.Fatalf("load failures=%d", failures.Load())
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	percentile := func(p float64) time.Duration {
		index := int(p * float64(len(durations)-1))
		return durations[index]
	}
	throughput := float64(totalRequests) / elapsed.Seconds()
	t.Logf("shop_read_capacity requests=%d concurrency=%d products=24 variants=48 p50=%s p95=%s p99=%s throughput=%.2f_req_per_second elapsed=%s", totalRequests, concurrency, percentile(0.50), percentile(0.95), percentile(0.99), throughput, elapsed)
	metricsResponse, err := client.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	metricsBody, readErr := io.ReadAll(metricsResponse.Body)
	_ = metricsResponse.Body.Close()
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !strings.Contains(string(metricsBody), `ynx_shop_http_requests_total{method="GET",route_group="api_products",status_class="2xx"} 3000`) {
		t.Fatalf("metrics did not reconcile load request count:\n%s", metricsBody)
	}
}

func BenchmarkShopProductsRead(b *testing.B) {
	store, err := Open("")
	if err != nil {
		b.Fatal(err)
	}
	handler := NewServer(store, ServerConfig{}).Handler()
	request := httptest.NewRequest(http.MethodGet, "/api/products", nil)
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request.Clone(request.Context()))
		if recorder.Code != http.StatusOK {
			b.Fatalf("status=%d", recorder.Code)
		}
	}
}
