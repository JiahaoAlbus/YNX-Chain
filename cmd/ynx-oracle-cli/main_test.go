package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	oracleclient "github.com/JiahaoAlbus/YNX-Chain/sdk/oracle/go"
)

type stubClient struct {
	price oracleclient.Price
	err   error
}

func (client stubClient) Price(context.Context, string, string) (oracleclient.Price, error) {
	return client.price, client.err
}

func validCLIPrice(now time.Time) oracleclient.Price {
	return oracleclient.Price{
		Schema:     oracleclient.SchemaVersion,
		Market:     "YNXT/YUSD_TEST",
		Type:       "spot_price",
		Value:      1_000_000,
		Scale:      1_000_000,
		Source:     "YNX Oracle aggregated provider observations",
		Version:    "weighted-median-mad-v1",
		AsOf:       now.Add(-time.Second),
		ProducedAt: now,
		Quality: oracleclient.Quality{
			Status: "good", SourceCount: 3, RequiredSourceCount: 3,
			ConfidencePPM: 999_000, CoveragePPM: 1_000_000,
		},
		ObservationIDs:  []string{"a", "b", "c"},
		ObservationHash: []string{strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64)},
		LineageHash:     strings.Repeat("d", 64),
	}
}

func TestRunPrintsOnlyValidatedPrice(t *testing.T) {
	now := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	factory := func(baseURL string, client *http.Client) (priceClient, error) {
		if baseURL != "https://oracle.example" {
			t.Fatalf("baseURL=%q", baseURL)
		}
		if client.Timeout != 2*time.Second {
			t.Fatalf("timeout=%s", client.Timeout)
		}
		return stubClient{price: validCLIPrice(now)}, nil
	}
	var output bytes.Buffer
	err := run([]string{
		"--url", "https://oracle.example",
		"--market", "YNXT/YUSD_TEST",
		"--timeout", "2s",
		"--max-age", "30s",
		"--pretty",
	}, &output, factory, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	var price oracleclient.Price
	if err := json.Unmarshal(output.Bytes(), &price); err != nil {
		t.Fatal(err)
	}
	if price.Market != "YNXT/YUSD_TEST" || price.Value != 1_000_000 {
		t.Fatalf("price=%+v", price)
	}
}

func TestRunRejectsUnsafePriceBeforeOutput(t *testing.T) {
	now := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	price := validCLIPrice(now)
	price.Quality.SourceCount = 2
	factory := func(string, *http.Client) (priceClient, error) {
		return stubClient{price: price}, nil
	}
	var output bytes.Buffer
	err := run([]string{"--url", "https://oracle.example", "--market", "YNXT/YUSD_TEST"}, &output, factory, func() time.Time { return now })
	if err == nil || !strings.Contains(err.Error(), "reject unsafe Oracle response") {
		t.Fatalf("err=%v", err)
	}
	if output.Len() != 0 {
		t.Fatalf("unsafe response was printed: %q", output.String())
	}
}

func TestRunRejectsInvalidCLIInputs(t *testing.T) {
	factory := func(string, *http.Client) (priceClient, error) {
		t.Fatal("factory should not be called")
		return nil, nil
	}
	tests := [][]string{
		{},
		{"--url", "https://oracle.example"},
		{"--url", "https://oracle.example", "--market", "YNXT/YUSD_TEST", "--timeout", "0s"},
		{"--url", "https://oracle.example", "--market", "YNXT/YUSD_TEST", "extra"},
	}
	for _, args := range tests {
		if err := run(args, &bytes.Buffer{}, factory, time.Now); err == nil {
			t.Fatalf("args=%v accepted", args)
		}
	}
}

func TestRealFactoryRejectsRemotePlainHTTP(t *testing.T) {
	_, err := newOracleClient("http://192.0.2.1", &http.Client{Timeout: time.Second})
	if err == nil || !strings.Contains(err.Error(), "plain HTTP") {
		t.Fatalf("err=%v", err)
	}
}
