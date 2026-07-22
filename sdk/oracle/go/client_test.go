package oracleclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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

func TestMachineReadableConsumerVectors(t *testing.T) {
	data, err := os.ReadFile("../../../integration/oracle/v1/consumer-test-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		ConsumerPolicy struct {
			RequestedMarket      string    `json:"requestedMarket"`
			RequestedType        string    `json:"requestedType"`
			Now                  time.Time `json:"now"`
			MaximumAgeSeconds    int       `json:"maximumAgeSeconds"`
			MinimumConfidencePPM int64     `json:"minimumConfidencePpm"`
			MinimumCoveragePPM   int64     `json:"minimumCoveragePpm"`
		} `json:"consumerPolicy"`
		Base  map[string]any `json:"base"`
		Cases []struct {
			ID      string `json:"id"`
			Accept  bool   `json:"accept"`
			Changes []struct {
				Path  string `json:"path"`
				Value any    `json:"value"`
			} `json:"changes"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, test := range vectors.Cases {
		t.Run(test.ID, func(t *testing.T) {
			encoded, _ := json.Marshal(vectors.Base)
			var candidate map[string]any
			if err := json.Unmarshal(encoded, &candidate); err != nil {
				t.Fatal(err)
			}
			for _, change := range test.Changes {
				applyFixtureChange(t, candidate, change.Path, change.Value)
			}
			encoded, _ = json.Marshal(candidate)
			var price Price
			decoder := json.NewDecoder(strings.NewReader(string(encoded)))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&price); err != nil {
				t.Fatal(err)
			}
			err := price.ValidateFor(vectors.ConsumerPolicy.RequestedMarket, vectors.ConsumerPolicy.RequestedType, "weighted-median-mad-v1", vectors.ConsumerPolicy.Now, time.Duration(vectors.ConsumerPolicy.MaximumAgeSeconds)*time.Second, vectors.ConsumerPolicy.MinimumConfidencePPM, vectors.ConsumerPolicy.MinimumCoveragePPM)
			if (err == nil) != test.Accept {
				t.Fatalf("accept=%v err=%v", test.Accept, err)
			}
		})
	}
}

func applyFixtureChange(t *testing.T, target map[string]any, pointer string, value any) {
	t.Helper()
	parts := strings.Split(strings.TrimPrefix(pointer, "/"), "/")
	current := target
	for _, part := range parts[:len(parts)-1] {
		next, ok := current[part].(map[string]any)
		if !ok {
			t.Fatalf("invalid fixture pointer %q", pointer)
		}
		current = next
	}
	current[parts[len(parts)-1]] = value
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
