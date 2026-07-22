package payproduct

import (
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

type staticWebhookResolver struct {
	addresses []net.IPAddr
	err       error
}

func (r staticWebhookResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return r.addresses, r.err
}

type webhookRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn webhookRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestWebhookDestinationRejectsLocalAndReboundAddresses(t *testing.T) {
	for _, endpoint := range []string{
		"http://receiver.example.com/events",
		"https://127.0.0.1/events",
		"https://[::1]/events",
		"https://localhost/events",
		"https://service.internal/events",
		"https://user:secret@receiver.example.com/events",
		"https://receiver.example.com:8443/events",
		"https://receiver.example.com/events#fragment",
	} {
		if _, err := validWebhookURL(endpoint); err == nil {
			t.Fatalf("unsafe webhook syntax was accepted: %s", endpoint)
		}
	}

	for _, ip := range []string{"10.0.0.8", "100.64.0.1", "127.0.0.1", "169.254.169.254", "192.0.2.1", "192.168.1.5", "198.51.100.1", "203.0.113.1", "::1", "fc00::1", "fe80::1", "2001:db8::1"} {
		resolver := staticWebhookResolver{addresses: []net.IPAddr{{IP: net.ParseIP(ip)}}}
		if err := validateWebhookDestination(context.Background(), "https://receiver.example.com/events", resolver); err == nil {
			t.Fatalf("non-public webhook resolution was accepted: %s", ip)
		}
	}

	mixed := staticWebhookResolver{addresses: []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}, {IP: net.ParseIP("10.0.0.8")}}}
	if err := validateWebhookDestination(context.Background(), "https://receiver.example.com/events", mixed); err == nil {
		t.Fatal("mixed public/private DNS response was accepted")
	}
	public := staticWebhookResolver{addresses: []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}, {IP: net.ParseIP("2001:4860:4860::8888")}}}
	if err := validateWebhookDestination(context.Background(), "https://receiver.example.com/events", public); err != nil {
		t.Fatalf("public webhook destination was rejected: %v", err)
	}
}

func TestWebhookClientNeverFollowsRedirects(t *testing.T) {
	calls := 0
	provided := &http.Client{Transport: webhookRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": []string{"https://127.0.0.1/metadata"}}, Body: io.NopCloser(strings.NewReader("redirect")), Request: request}, nil
	})}
	client := newWebhookHTTPClient(provided, staticWebhookResolver{})
	request, err := http.NewRequest(http.MethodPost, "https://receiver.example.com/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusFound || calls != 1 {
		t.Fatalf("webhook redirect was followed: status=%d calls=%d", response.StatusCode, calls)
	}
}

func TestWebhookDNSRebindingFaultPersistsFailureWithoutNetworkCall(t *testing.T) {
	service, _ := testService(t, &fakePay{}, time.Now)
	merchant, _ := onboard(t, service)
	merchant.WebhookURL = "https://receiver.example.com/events"
	service.webhookResolver = staticWebhookResolver{addresses: []net.IPAddr{{IP: net.ParseIP("169.254.169.254")}}}
	calls := 0
	service.client = newWebhookHTTPClient(&http.Client{Transport: webhookRoundTripFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return nil, nil
	})}, service.webhookResolver)
	if err := service.queueWebhook(merchant, "invoice.created", "inv_ssrf_guard"); err != nil {
		t.Fatal(err)
	}
	state, err := service.SnapshotForMerchant(merchant.ID)
	if err != nil {
		t.Fatal(err)
	}
	for id := range state.Deliveries {
		delivery, err := service.Deliver(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if delivery.Status != "retrying" || delivery.Attempt != 1 || calls != 0 {
			t.Fatalf("DNS rebinding fault was not contained: delivery=%+v calls=%d", delivery, calls)
		}
	}
}
