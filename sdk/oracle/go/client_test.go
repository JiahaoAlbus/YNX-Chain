package oracleclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func validPrice(now time.Time) Price {
	return Price{Schema: SchemaVersion, Market: "YNXT/YUSD_TEST", Type: "spot_price", Value: 1_000_000, Scale: 1_000_000,
		Source: "YNX Oracle aggregated provider observations", Version: "weighted-median-mad-v1", AsOf: now.Add(-time.Second), ProducedAt: now,
		Quality:        Quality{Status: "good", SourceCount: 3, RequiredSourceCount: 3, ConfidencePPM: 990_000, CoveragePPM: 1_000_000},
		ObservationIDs: []string{"a", "b", "c"}, ObservationHash: []string{strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64)}, LineageHash: strings.Repeat("d", 64)}
}

func TestValidateRejectsEveryUnsafeConsumerState(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	tests := map[string]func(*Price){
		"stale":          func(price *Price) { price.Quality.Stale = true },
		"circuit":        func(price *Price) { price.Quality.CircuitBreaker = true },
		"thin":           func(price *Price) { price.Quality.SourceCount = 2 },
		"low confidence": func(price *Price) { price.Quality.ConfidencePPM = 100 },
		"old":            func(price *Price) { price.AsOf = now.Add(-time.Minute) },
		"future":         func(price *Price) { price.AsOf = now.Add(time.Minute) },
		"lineage":        func(price *Price) { price.LineageHash = "invalid" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			price := validPrice(now)
			mutate(&price)
			if err := price.Validate(now, 30*time.Second, 800_000); err == nil {
				t.Fatal("unsafe price accepted")
			}
		})
	}
	if err := validPrice(now).Validate(now, 30*time.Second, 800_000); err != nil {
		t.Fatalf("valid price rejected: %v", err)
	}
}

func TestClientRequiresTimeoutAndRejectsHTTPOffLoopback(t *testing.T) {
	if _, err := New("http://192.0.2.1", &http.Client{Timeout: time.Second}); err == nil {
		t.Fatal("remote plain HTTP accepted")
	}
	if _, err := New("https://oracle.invalid", &http.Client{}); err == nil {
		t.Fatal("client without timeout accepted")
	}
}

func TestClientFetchesStrictBoundedResponse(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/prices" || request.URL.Query().Get("market") != "YNXT/YUSD_TEST" || request.URL.Query().Get("type") != "spot_price" {
			t.Fatalf("request=%s", request.URL.String())
		}
		_ = json.NewEncoder(response).Encode(validPrice(now))
	}))
	defer server.Close()
	client, err := New(server.URL, &http.Client{Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	price, err := client.Price(context.Background(), "YNXT/YUSD_TEST", "spot_price")
	if err != nil || price.Value != 1_000_000 {
		t.Fatalf("price=%+v err=%v", price, err)
	}
}
