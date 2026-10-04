package finance

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPortfolioPayAmountsRetainExactIntegerEvidence(t *testing.T) {
	for _, value := range []struct {
		wire string
		want int64
	}{
		{"9007199254740993", 9007199254740993},
		{"9223372036854775807", 9223372036854775807},
		{"-9223372036854775808", -9223372036854775808},
		{`"9007199254740993"`, 9007199254740993},
		{"0", 0},
	} {
		t.Run(value.wire, func(t *testing.T) {
			u := amountUpstream(t, fmt.Sprintf(`{"id":"original","payer":%q,"amountYnxt":%s}`, testAccount, value.wire))
			portfolio := u.Portfolio(context.Background(), testAccount, nil)
			if !portfolio.PayStatus.Available || len(portfolio.PayReceipts) != 1 || portfolio.PayReceipts[0].AmountYNXT != value.want {
				t.Fatalf("status=%+v receipts=%+v", portfolio.PayStatus, portfolio.PayReceipts)
			}
		})
	}
}

func TestPortfolioRejectsInvalidOwnedAmountsWithoutInventingZero(t *testing.T) {
	for _, wire := range []string{"1.5", "9223372036854775808", "null", `"not-integer"`, "true", "1e3"} {
		t.Run(wire, func(t *testing.T) {
			// A valid unrelated/remaining receipt must remain independently usable;
			// corrupt evidence may not overwrite it or become a fabricated zero.
			u := amountUpstream(t, fmt.Sprintf(`{"id":"invalid","payer":%q,"amountYnxt":%s,"amount":7},{"id":"valid","payer":%q,"amount":12}`, testAccount, wire, testAccount))
			portfolio := u.Portfolio(context.Background(), testAccount, nil)
			if portfolio.PayStatus.Available || portfolio.PayStatus.SyncStatus != "partial-invalid-records" || len(portfolio.PayReceipts) != 1 || portfolio.PayReceipts[0].ID != "valid" || portfolio.PayReceipts[0].AmountYNXT != 12 {
				t.Fatalf("status=%+v receipts=%+v", portfolio.PayStatus, portfolio.PayReceipts)
			}
		})
	}
	u := amountUpstream(t, fmt.Sprintf(`{"id":"missing","payer":%q}`, testAccount))
	portfolio := u.Portfolio(context.Background(), testAccount, nil)
	if portfolio.PayStatus.Available || len(portfolio.PayReceipts) != 0 {
		t.Fatal("missing amount became zero")
	}
}

func amountUpstream(t *testing.T, events string) *Upstreams {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/pay/events" {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"events":[%s]}`, events)
			return
		}
		http.Error(w, "isolated unavailable Explorer", http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)
	u, err := NewUpstreams(server.URL, server.URL, "isolated-test-key", "")
	if err != nil {
		t.Fatal(err)
	}
	return u
}
