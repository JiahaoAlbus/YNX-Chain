package quantlab

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestExchangeAuthorizationNeverFollowsRedirects(t *testing.T) {
	for _, status := range []int{301, 302, 303, 307, 308} {
		for _, sameOrigin := range []bool{false, true} {
			t.Run(strconv.Itoa(status)+"/same="+strconv.FormatBool(sameOrigin), func(t *testing.T) {
				var forwarded, authorized, suppliedPolicy atomic.Int64
				target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					forwarded.Add(1)
					w.WriteHeader(http.StatusOK)
				}))
				defer target.Close()
				venue := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/redirect-target" {
						forwarded.Add(1)
						return
					}
					authorized.Add(1)
					location := target.URL
					if sameOrigin {
						location = "/redirect-target"
					}
					w.Header().Set("Location", location)
					w.WriteHeader(status)
				}))
				defer venue.Close()
				client := venue.Client()
				client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { suppliedPolicy.Add(1); return nil }
				adapter := HTTPExchangeAdapter{BaseURL: venue.URL, Client: client}
				mandate := validMandate(time.Now(), strings.Repeat("a", 64))
				if err := adapter.VerifyMandate(context.Background(), mandate, "request-scoped-proof"); !errors.Is(err, ErrUnavailable) {
					t.Fatalf("mandate error: %v", err)
				}
				_, err := adapter.SubmitTestnet(context.Background(), mandate, TestnetOrder{Market: mandate.Market, Side: "buy", Price: 1, Amount: 1, IdempotencyKey: "redirect-order", WalletSignature: "independent-signature"}, "request-scoped-proof")
				if !errors.Is(err, ErrUnavailable) {
					t.Fatalf("order error: %v", err)
				}
				data, code, err := adapter.CompleteWalletSession(context.Background(), []byte(`{"walletApproval":"signed-body"}`))
				if !errors.Is(err, ErrUnavailable) || code != 0 || data != nil {
					t.Fatalf("completion code=%d err=%v", code, err)
				}
				if authorized.Load() != 3 || forwarded.Load() != 0 || suppliedPolicy.Load() != 0 {
					t.Fatalf("authorized=%d forwarded=%d policy=%d", authorized.Load(), forwarded.Load(), suppliedPolicy.Load())
				}
				// Cloning must not alter the original consumer's policy.
				_ = client.CheckRedirect(nil, nil)
				if suppliedPolicy.Load() != 1 {
					t.Fatal("supplied client policy changed")
				}
			})
		}
	}
}
