package payproduct

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestInvoiceAcceptsAuthoritativePreExpirySettlementAfterCallbackDelay(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant = merchant.ID
	pay.invoice.PayoutAddress = merchant.PayoutAddress
	pay.invoice.Amount = 17
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 17, ExpiresInMinutes: 1, IdempotencyKey: "pre-expiry-race-01"})
	if err != nil {
		t.Fatal(err)
	}
	pay.settlement = validSettlementFor(invoice, merchant, invoice.ExpiresAt.Add(-time.Second))
	now = invoice.ExpiresAt.Add(time.Minute)

	got, err := service.Invoice(context.Background(), invoice.ID)
	if err != nil || got.Status != "committed" || got.Settlement == nil || !got.Settlement.CommittedAt.Equal(pay.settlement.CreatedAt) {
		t.Fatalf("pre-expiry payment was lost after delayed reconciliation: %+v %v", got, err)
	}
}

func TestInvoiceRejectsAuthoritativePostExpirySettlement(t *testing.T) {
	now := time.Date(2026, 8, 1, 13, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant = merchant.ID
	pay.invoice.PayoutAddress = merchant.PayoutAddress
	pay.invoice.Amount = 19
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 19, ExpiresInMinutes: 1, IdempotencyKey: "post-expiry-race-01"})
	if err != nil {
		t.Fatal(err)
	}
	pay.settlement = validSettlementFor(invoice, merchant, invoice.ExpiresAt.Add(time.Second))
	now = invoice.ExpiresAt.Add(time.Minute)

	got, err := service.Invoice(context.Background(), invoice.ID)
	if err != nil || got.Status != "expired" || got.Settlement != nil {
		t.Fatalf("post-expiry settlement was not rejected: %+v %v", got, err)
	}
}

func validSettlementFor(invoice Invoice, merchant Merchant, createdAt time.Time) chain.PaySettlement {
	return chain.PaySettlement{
		ID: "fedcba9876543210fedcba98", IntentID: invoice.IntentID, InvoiceID: invoice.CentralID,
		Merchant: merchant.CentralMerchantID, PayoutAddress: invoice.PayoutAddress, Payer: merchant.PayoutAddress,
		Amount: invoice.Amount, Currency: NativeAsset, TransactionHash: "0x" + strings.Repeat("a", 64),
		BlockNumber: 101, Status: "paid", IdempotencyKey: "review-settlement-01",
		AuditHash: strings.Repeat("b", 64), CreatedAt: createdAt,
	}
}

func TestSlowWebhookDoesNotBlockOtherMutationsAndCannotDoubleDeliver(t *testing.T) {
	now := time.Date(2026, 8, 1, 14, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	merchant.WebhookURL = "https://hooks.example.test/events"
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	service.client = secureWebhookClient(&http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		once.Do(func() { close(entered) })
		<-release
		return &http.Response{StatusCode: http.StatusNoContent, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
	})})
	if err := service.queueWebhook(merchant, "invoice.committed", "inv_concurrency_review"); err != nil {
		t.Fatal(err)
	}
	var deliveryID string
	_ = service.store.View(func(data Snapshot) error {
		for id := range data.Deliveries {
			deliveryID = id
		}
		return nil
	})
	done := make(chan error, 1)
	go func() {
		_, err := service.Deliver(context.Background(), deliveryID)
		done <- err
	}()
	<-entered
	if _, err := service.Deliver(context.Background(), deliveryID); err == nil || !strings.Contains(err.Error(), "in progress") {
		t.Fatalf("duplicate delivery was not rejected: %v", err)
	}

	mutationDone := make(chan error, 1)
	go func() {
		_, err := service.CreateCatalog(merchant, CatalogInput{Name: "Concurrent item", Amount: 3, IdempotencyKey: "concurrent-item-01"})
		mutationDone <- err
	}()
	select {
	case err := <-mutationDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(250 * time.Millisecond):
		t.Fatal("slow webhook held the global mutation lock")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestWebhookDestinationRejectsInternalTargetsAndRedirects(t *testing.T) {
	blocked := []string{
		"https://localhost/hook", "https://api.internal/hook", "https://127.0.0.1/hook",
		"https://10.0.0.1/hook", "https://169.254.169.254/latest/meta-data", "https://[::1]/hook",
		"https://100.64.0.1/hook", "https://192.0.2.1/hook",
	}
	for _, endpoint := range blocked {
		if _, err := validWebhookURL(endpoint); err == nil {
			t.Errorf("unsafe webhook endpoint accepted: %s", endpoint)
		}
	}
	if _, err := validWebhookURL("https://hooks.example.com/events"); err != nil {
		t.Fatalf("public webhook endpoint rejected: %v", err)
	}
	if publicWebhookIP(net.ParseIP("127.0.0.1")) || publicWebhookIP(net.ParseIP("169.254.169.254")) || !publicWebhookIP(net.ParseIP("1.1.1.1")) {
		t.Fatal("webhook IP classification is unsafe")
	}

	client := secureWebhookClient(&http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusFound,
			Header:     http.Header{"Location": []string{"https://127.0.0.1/admin"}},
			Body:       io.NopCloser(strings.NewReader("redirect")),
			Request:    req,
		}, nil
	})})
	req, _ := http.NewRequest(http.MethodPost, "https://hooks.example.com/events", nil)
	if _, err := client.Do(req); err == nil || !errors.Is(err, http.ErrUseLastResponse) && !strings.Contains(err.Error(), "redirects are disabled") {
		t.Fatalf("webhook redirect was followed or not rejected: %v", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }
