package main

import (
	"io"
	"net/http"
	"strings"
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
		{Latency: 10 * time.Millisecond, Status: 200, Route: "summary"},
		{Latency: 20 * time.Millisecond, Status: 200, Route: "search"},
		{Latency: 30 * time.Millisecond, Status: 503, Err: "Service Unavailable", Route: "summary"},
		{Latency: 40 * time.Millisecond, Status: 429, Err: "Too Many Requests", Route: "search"},
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
	if got.Routes["summary"].Requests != 2 || got.Routes["summary"].Errors != 1 || got.Routes["summary"].StatusCodes[503] != 1 || got.Routes["search"].Requests != 2 || got.Routes["search"].Errors != 1 {
		t.Fatalf("unexpected bounded route aggregates: %+v", got.Routes)
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

func TestPublicFailureCodeIsBoundedAndDoesNotEchoMessages(t *testing.T) {
	if got := publicFailureCode(502, []byte(`{"code":"dependency_unavailable","message":"dial 127.0.0.1:6426 /private/path"}`)); got != "dependency_unavailable" {
		t.Fatalf("expected bounded public code, got %q", got)
	}
	for _, payload := range [][]byte{[]byte(`{"code":"../../private/path"}`), []byte(`{"message":"dial 127.0.0.1:6426"}`), []byte("not-json")} {
		if got := publicFailureCode(502, payload); got != "bad_gateway" {
			t.Fatalf("unsafe failure payload was reflected: %q", got)
		}
	}
}

func TestConsumeResponseMeasuresCompletedBody(t *testing.T) {
	delay := 30 * time.Millisecond
	response := &http.Response{Body: &delayedReadCloser{delay: delay, Reader: strings.NewReader(`{"ok":true}`)}}
	payload, latency, err := consumeResponse(response, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != `{"ok":true}` || latency < delay {
		t.Fatalf("response completion was not measured: payload=%q latency=%s", payload, latency)
	}
}

func TestConsumeResponseRejectsBodyAboveCap(t *testing.T) {
	response := &http.Response{Body: io.NopCloser(strings.NewReader(strings.Repeat("x", maxResponseBodyBytes+1)))}
	payload, _, err := consumeResponse(response, time.Now())
	if err == nil || err.Error() != "response_body_too_large" {
		t.Fatalf("oversized response was accepted: bytes=%d err=%v", len(payload), err)
	}
	if len(payload) != maxResponseBodyBytes {
		t.Fatalf("oversized response was not bounded in memory: %d", len(payload))
	}
}

type delayedReadCloser struct {
	io.Reader
	delay time.Duration
	read  bool
}

func (r *delayedReadCloser) Read(payload []byte) (int, error) {
	if !r.read {
		r.read = true
		time.Sleep(r.delay)
	}
	return r.Reader.Read(payload)
}

func (*delayedReadCloser) Close() error { return nil }
