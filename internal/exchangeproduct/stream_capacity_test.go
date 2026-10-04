package exchangeproduct

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOpenStreamsCannotExhaustOrdinaryRequestCapacity(t *testing.T) {
	service, _, _ := newTestService(t)
	server := NewServer(service)
	host := httptest.NewServer(server)
	defer host.Close()
	client := host.Client()
	client.Timeout = 5 * time.Second
	var subscribers []io.ReadCloser
	defer func() {
		for _, body := range subscribers {
			body.Close()
		}
	}()
	rejected := 0
	for i := 0; i < 128; i++ {
		response, err := client.Get(host.URL + "/v1/market-data/stream")
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode == http.StatusOK {
			subscribers = append(subscribers, response.Body)
			continue
		}
		body, readErr := io.ReadAll(response.Body)
		response.Body.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if response.StatusCode != http.StatusServiceUnavailable || response.Header.Get("Retry-After") != "1" || !strings.Contains(string(body), "stream_capacity_exhausted") {
			t.Fatalf("unbounded or wrong rejection: status=%d body=%s", response.StatusCode, body)
		}
		rejected++
	}
	// WebSocket and SSE subscribers share the same bound; switching transport
	// cannot evade it, even before a handshake or private authentication.
	response, err := client.Get(host.URL + "/v1/ws/market")
	if err != nil {
		t.Fatal(err)
	}
	wsBody, readErr := io.ReadAll(response.Body)
	response.Body.Close()
	if readErr != nil {
		t.Fatal(readErr)
	}
	if response.StatusCode != http.StatusServiceUnavailable || !strings.Contains(string(wsBody), "stream_capacity_exhausted") {
		t.Fatalf("WebSocket evaded stream bound: %d %s", response.StatusCode, wsBody)
	}
	for _, path := range []string{"/health", "/v1/market-data/snapshot", "/metrics"} {
		response, err := client.Get(host.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, readErr := io.ReadAll(response.Body)
		response.Body.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if response.StatusCode != http.StatusOK {
			t.Errorf("streams starved %s: status=%d body=%s", path, response.StatusCode, body)
		}
		if path == "/metrics" && (!strings.Contains(string(body), "ynx_exchange_streams_in_flight 64\n") || !strings.Contains(string(body), "ynx_exchange_stream_capacity 64\n")) {
			t.Fatalf("missing active capacity metrics: %s", body)
		}
	}
	if len(subscribers) != 64 || rejected != 64 {
		t.Fatalf("expected bounded streams with ordinary capacity reserved: accepted=%d rejected=%d", len(subscribers), rejected)
	}
	for _, body := range subscribers {
		body.Close()
	}
	deadline := time.Now().Add(time.Second)
	for (len(server.concurrency) != 0 || len(server.streamConcurrency) != 0) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(server.concurrency) != 0 || len(server.streamConcurrency) != 0 {
		t.Fatal("disconnected streams retain request slots")
	}
	// The limit is a live-capacity bound, not a permanent ban on reconnecting.
	response, err = client.Get(host.URL + "/v1/market-data/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("reconnect status=%d", response.StatusCode)
	}
}
