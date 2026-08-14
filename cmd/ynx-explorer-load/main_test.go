package main

import (
	"testing"
	"time"
)

func TestValidateOrigin(t *testing.T) {
	for _, raw := range []string{"http://example.com", "https://user@example.com", "https://example.com/path", "https://example.com?secret=value"} {
		if _, err := validateOrigin(raw, false); err == nil {
			t.Fatalf("unsafe origin %q was accepted", raw)
		}
	}
	if got, err := validateOrigin("https://explorer.example/", false); err != nil || got != "https://explorer.example" {
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
	got := summarize("https://explorer.example", started, started.Add(2*time.Second), 2, 1, samples, 3, 1, 0)
	if got.Requests != 4 || got.Errors != 2 || got.ErrorRate != 0.5 || got.RequestsPerSecond != 2 {
		t.Fatalf("unexpected aggregate: %+v", got)
	}
	if got.Latency.P50Millis != 20 || got.Latency.P95Millis != 30 || got.Latency.P99Millis != 30 || got.Latency.MaxMillis != 40 {
		t.Fatalf("unexpected latency percentiles: %+v", got.Latency)
	}
	if got.StatusCodes[200] != 2 || got.StatusCodes[503] != 1 || got.StatusCodes[429] != 1 {
		t.Fatalf("unexpected status counts: %+v", got.StatusCodes)
	}
}
