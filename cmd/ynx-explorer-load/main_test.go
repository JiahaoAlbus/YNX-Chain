package main

import (
	"testing"
	"time"
)

func TestValidateOrigin(t *testing.T) {
	for _, raw := range []string{"http://service.invalid", "https://user@service.invalid", "https://service.invalid/path", "https://service.invalid?secret=value"} {
		if _, err := validateOrigin(raw, false); err == nil {
			t.Fatalf("unsafe origin %q was accepted", raw)
		}
	}
	if got, err := validateOrigin("https://explorer.ynx.invalid/", false); err != nil || got != "https://explorer.ynx.invalid" {
		t.Fatalf("safe public origin rejected: got=%q err=%v", got, err)
	}
	if got, err := validateOrigin("http://127.0.0.1:6425", true); err != nil || got != "http://127.0.0.1:6425" {
		t.Fatalf("explicit local origin rejected: got=%q err=%v", got, err)
	}
}

func TestSummarize(t *testing.T) {
	started := time.Unix(0, 0).UTC()
	samples := []sample{
		{Latency: 10 * time.Millisecond, Status: 200},
		{Latency: 20 * time.Millisecond, Status: 200},
		{Latency: 30 * time.Millisecond, Status: 503, Err: "Service Unavailable"},
		{Latency: 40 * time.Millisecond, Status: 429, Err: "Too Many Requests"},
	}
	got := summarize("https://explorer.ynx.invalid", started, started.Add(2*time.Second), 2, 10, 1, samples, 3, 1, 1, 0, started.Add(time.Second).UnixNano(), started.Add(1500*time.Millisecond).UnixNano())
	if got.Requests != 4 || got.Errors != 2 || got.ErrorRate != 0.5 || got.RequestsPerSecond != 2 {
		t.Fatalf("unexpected aggregate: %+v", got)
	}
	if got.TargetRPS != 10 {
		t.Fatalf("target request rate was not recorded: %+v", got)
	}
	if got.Latency.P50Millis != 20 || got.Latency.P95Millis != 30 || got.Latency.P99Millis != 30 || got.Latency.MaxMillis != 40 {
		t.Fatalf("unexpected latency percentiles: %+v", got.Latency)
	}
	if got.StatusCodes[200] != 2 || got.StatusCodes[503] != 1 || got.StatusCodes[429] != 1 {
		t.Fatalf("unexpected status counts: %+v", got.StatusCodes)
	}
	if got.SSERecoveries != 1 || got.SSERecoveryMillis != 500 {
		t.Fatalf("unexpected recovery aggregate: %+v", got)
	}
}

func TestEvaluateReportExpectedOutage(t *testing.T) {
	recovered := report{Requests: 12, SSEClients: 2, SSEReconnects: 4, SSERecoveries: 2, SSERecoveryMillis: 325, Errors: 3, SSEErrors: 4}
	if err := evaluateReport(recovered, true); err != nil {
		t.Fatalf("expected outage recovery was rejected: %v", err)
	}
	missingRecovery := recovered
	missingRecovery.SSERecoveries = 1
	if err := evaluateReport(missingRecovery, true); err == nil {
		t.Fatal("partial SSE recovery was accepted")
	}
	if err := evaluateReport(recovered, false); err == nil {
		t.Fatal("transient errors were accepted outside an expected outage drill")
	}
}
