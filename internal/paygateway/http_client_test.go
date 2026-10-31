package paygateway

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type payRoundTripFunc func(*http.Request) (*http.Response, error)

func (f payRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGatewayHTTPClientInjectionPreservesWireAndDefault(t *testing.T) {
	const body = `{"intentId":"00112233445566778899aabb","dueInHours":1,"idempotencyKey":"injected-invoice"}`
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.RequestURI() {
		case "GET /status":
			_, _ = io.WriteString(w, `{"chainId":6423,"height":12,"network":"fixture","nativeCurrencySymbol":"YNXT"}`)
		case "GET /pay/intents/00112233445566778899aabb":
			if r.Header.Get("X-YNX-Pay-Gateway-Upstream-Key") != testUpstreamKey {
				t.Error("original ownership read lost credential")
			}
			io.WriteString(w, `{"id":"00112233445566778899aabb","merchant":"`+testMerchantID+`"}`)
		case "POST /pay/invoices":
			raw, err := io.ReadAll(r.Body)
			if err != nil || string(raw) != body || r.Header.Get("X-YNX-Pay-Gateway-Upstream-Key") != testUpstreamKey || r.Header.Get("X-Request-ID") != "injected-request" || r.Header.Get("Content-Type") != "application/json" {
				t.Errorf("original authoritative invoice wire changed")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"status":"issued"}`)
		default:
			t.Errorf("unexpected upstream wire %s %s", r.Method, r.URL.RequestURI())
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()
	client := &http.Client{Timeout: 7 * time.Second, Transport: payRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return http.DefaultTransport.RoundTrip(r)
	})}
	config := Config{ChainURL: upstream.URL, MerchantID: testMerchantID, APIKey: testAPIKey, UpstreamKey: testUpstreamKey, WebhookSigningKey: testWebhookKey, HTTPClient: client}
	service, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	if service.httpClient == client || service.httpClient.Timeout != client.Timeout {
		t.Fatal("injected client must be copied with its timeout intact")
	}
	if health := service.Health(context.Background(), buildinfo.Info{}); !health.OK || health.Height != 12 {
		t.Fatalf("injected transport did not carry original status request: %+v", health)
	}
	response, err := service.Proxy(context.Background(), http.MethodPost, "/pay/invoices", "", []byte(body), "injected-request")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated || calls.Load() != 3 {
		t.Fatalf("injected client did not carry status, original ownership and mutation requests: HTTP %d, calls %d", response.StatusCode, calls.Load())
	}
	config.HTTPClient = nil
	defaults, err := New(config)
	if err != nil || defaults.httpClient.Timeout != 30*time.Second || defaults.httpClient.CheckRedirect == nil {
		t.Fatalf("default bounded client unavailable: %v", err)
	}
	if err = defaults.httpClient.CheckRedirect(nil, nil); !errors.Is(err, http.ErrUseLastResponse) {
		t.Fatal("default client must leave redirects unresolved")
	}
}

func TestGatewayHTTPClientCannotRedirectCredentialsToAnotherTarget(t *testing.T) {
	var destinationCalls, callerRedirects atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		destinationCalls.Add(1)
		_, _ = io.WriteString(w, `{"status":"issued"}`)
	}))
	defer destination.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/pay/intents/intent-original" {
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"id":"intent-original","merchant":"`+testMerchantID+`"}`)
			return
		}
		w.Header().Set("Location", destination.URL+"/collect")
		w.WriteHeader(http.StatusTemporaryRedirect)
	}))
	defer upstream.Close()
	client := &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
		callerRedirects.Add(1)
		return nil
	}}
	service, err := New(Config{ChainURL: upstream.URL, MerchantID: testMerchantID, APIKey: testAPIKey, UpstreamKey: testUpstreamKey, WebhookSigningKey: testWebhookKey, HTTPClient: client})
	if err != nil {
		t.Fatal(err)
	}
	response, err := service.Proxy(context.Background(), http.MethodPost, "/pay/invoices", "", []byte(`{"intentId":"intent-original","idempotencyKey":"redirect-invoice"}`), "redirect-request")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusTemporaryRedirect || destinationCalls.Load() != 0 || callerRedirects.Load() != 0 {
		t.Fatalf("gateway followed a target change: HTTP %d destination %d redirects %d", response.StatusCode, destinationCalls.Load(), callerRedirects.Load())
	}
	if err := client.CheckRedirect(httptest.NewRequest("GET", "http://caller.example", strings.NewReader("")), nil); err != nil || callerRedirects.Load() != 1 {
		t.Fatal("gateway mutated the supplied client's redirect policy")
	}
}
