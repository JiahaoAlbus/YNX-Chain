//go:build pay_pq && pay_cloud && pay_auth_source && pay_securelink && securelink_openssl && cgo

package nativehost

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

// Actual normal Products constructors/worker, original durable Store and TLS
// recipient. Only the queued PUBLIC notification is fixture DATA, not an
// invoice/payment receipt, admitted Source or substitute business sender.
func TestNormalWebhookWorkerColdTimeoutDuplicateAndDeadLetter(t *testing.T) {
	for _, mode := range []string{"timeout-duplicate-ack", "retry-cap"} {
		t.Run(mode, func(t *testing.T) {
			cfg := productsNormalConfig(t)
			cfg.RetryInterval = 100 * time.Millisecond
			var now atomic.Int64
			now.Store(time.Now().UTC().UnixNano())
			cfg.Pay.Now = func() time.Time { return time.Unix(0, now.Load()).UTC() }
			inbox := filepath.Join(t.TempDir(), "PUBLIC-recipient-inbox.json")
			var mu sync.Mutex
			var secret, originalBody, originalID string
			calls, unique := 0, 0
			receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				mu.Lock()
				calls++
				call := calls
				id := r.Header.Get("X-YNX-Event-ID")
				stamp, stampErr := time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Timestamp"))
				sum := sha256.Sum256(body)
				digest := hex.EncodeToString(sum[:])
				mac := hmac.New(sha256.New, []byte(secret))
				_, _ = fmt.Fprintf(mac, "YNX_PAY_WEBHOOK_V1\n%s\n%s\n%s", id, stamp.UTC().Format(time.RFC3339Nano), digest)
				valid := stampErr == nil && r.Method == "POST" && id == originalID && r.Header.Get("X-YNX-Delivery-ID") == id && string(body) == originalBody && r.Header.Get("X-YNX-Payload-SHA256") == digest && hmac.Equal([]byte(r.Header.Get("X-YNX-Signature")), []byte("v1="+hex.EncodeToString(mac.Sum(nil)))) && cfg.Pay.Now().Sub(stamp).Abs() < time.Minute
				if !valid {
					mu.Unlock()
					t.Error("normal worker changed original event/body or signing proof")
					w.WriteHeader(403)
					return
				}
				if mode == "retry-cap" {
					mu.Unlock()
					w.WriteHeader(503)
					return
				}
				// Reopen the recipient inbox for every POST, including the duplicate
				// after producer shutdown/cold boot. ACK is durable before it is sent.
				seen := map[string]string{}
				if raw, err := os.ReadFile(inbox); err == nil {
					if err = json.Unmarshal(raw, &seen); err != nil {
						t.Error(err)
					}
				} else if !os.IsNotExist(err) {
					t.Error(err)
				}
				if prior, ok := seen[id]; ok {
					if prior != digest {
						t.Error("duplicate event body splice")
						mu.Unlock()
						w.WriteHeader(409)
						return
					}
				} else {
					seen[id] = digest
					encoded, _ := json.Marshal(seen)
					if err := os.WriteFile(inbox, encoded, 0600); err != nil {
						t.Error(err)
						mu.Unlock()
						w.WriteHeader(500)
						return
					}
					unique++
				}
				mu.Unlock()
				if call == 1 {
					<-r.Context().Done()
					return
				}
				w.WriteHeader(204)
			}))
			defer receiver.Close()
			cfg.Pay.HTTPClient = receiver.Client()
			cfg.Pay.HTTPClient.Timeout = 300 * time.Millisecond
			var h *Products
			boot := func() *payproduct.Service {
				t.Helper()
				var err error
				h, err = OpenProducts(context.Background(), cfg, buildinfo.Info{}, nil)
				if err != nil {
					t.Fatal(err)
				}
				if h.NativeSourceStatus() != ErrOriginalEngineResourcesNotSupplied {
					t.Fatal("outbox worker fabricated Source admission")
				}
				return h.pay.Service()
			}
			stop := func() {
				t.Helper()
				if h == nil {
					return
				}
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				if err := h.Join(ctx); err != nil {
					t.Error(err)
				}
				if err := h.Close(); err != nil || !h.Closed() {
					t.Error("normal worker/parents did not close", err)
				}
				h = nil
			}
			defer stop()
			parent := boot()
			address, err := accountaddress.Encode("0x" + strings.Repeat("05", 20))
			if err != nil {
				t.Fatal(err)
			}
			onboarded, err := parent.Onboard(payproduct.OnboardInput{DisplayName: "PUBLIC worker recipient", PayoutAddress: address, WebhookURL: receiver.URL, IdempotencyKey: "PUBLIC-webhook-worker"})
			if err != nil {
				t.Fatal(err)
			}
			at := cfg.Pay.Now()
			body, _ := json.Marshal(map[string]any{"event": "invoice.committed", "objectId": "inv_PUBLIC_notification_only", "merchantId": onboarded.Merchant.ID, "occurredAt": at})
			mu.Lock()
			secret, originalBody, originalID = onboarded.WebhookSecret, string(body), "whd_PUBLIC_worker_original"
			mu.Unlock()
			sum := sha256.Sum256(body)
			digest := hex.EncodeToString(sum[:])
			mac := hmac.New(sha256.New, []byte(onboarded.WebhookSecret))
			_, _ = fmt.Fprintf(mac, "YNX_PAY_WEBHOOK_V1\n%s\n%s\n%s", originalID, at.Format(time.RFC3339Nano), digest)
			original := payproduct.WebhookDelivery{ID: originalID, MerchantID: onboarded.Merchant.ID, EventType: "invoice.committed", ObjectID: "inv_PUBLIC_notification_only", Endpoint: receiver.URL, PayloadHash: digest, Signature: hex.EncodeToString(mac.Sum(nil)), SecretVersion: 1, Status: "pending", CreatedAt: at, UpdatedAt: at}
			store, err := parent.BorrowOriginalNativePayStore()
			if err != nil {
				t.Fatal(err)
			}
			if err = store.Update(func(data *payproduct.Snapshot) error { data.Deliveries[original.ID] = original; return nil }); err != nil {
				t.Fatal(err)
			}
			attempts := 2
			if mode == "retry-cap" {
				attempts = 5
			}
			for attempt := 1; attempt <= attempts; attempt++ {
				deadline := time.Now().Add(5 * time.Second)
				var observed payproduct.WebhookDelivery
				for {
					completed := false
					if err = store.View(func(data payproduct.Snapshot) error {
						observed = data.Deliveries[original.ID]
						count := 0
						for _, a := range data.Audit {
							if a.Action == "webhook.deliver" && a.ObjectID == original.ID {
								count++
							}
						}
						completed = count == attempt
						if len(data.Invoices) != 0 || len(data.Refunds) != 0 || len(data.BusinessDispatches) != 0 || len(data.MerchantActions) != 0 {
							t.Error("callback changed business/funds state")
						}
						return nil
					}); err != nil {
						t.Fatal(err)
					}
					if completed {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("normal worker did not consume durable queue", observed)
					}
					time.Sleep(10 * time.Millisecond)
				}
				if observed.Attempt != attempt || observed.PayloadHash != original.PayloadHash || observed.Signature != original.Signature || observed.AttemptSignedAt == nil {
					t.Fatal("normal cold worker replaced event or retry budget", observed)
				}
				stop()
				if attempt < attempts {
					if observed.Status != "retrying" || observed.NextAttemptAt.Sub(observed.UpdatedAt) != time.Duration(1<<attempt)*time.Minute {
						t.Fatal("retry delay missing or changed", observed)
					}
					now.Store(observed.NextAttemptAt.UnixNano())
				} else {
					want := "delivered"
					if mode == "retry-cap" {
						want = "dead_letter"
					}
					if observed.Status != want || !observed.NextAttemptAt.IsZero() {
						t.Fatal("normal worker terminal state missing", observed)
					}
					now.Store(at.Add(24 * time.Hour).UnixNano())
				}
				parent = boot()
				store, err = parent.BorrowOriginalNativePayStore()
				if err != nil {
					t.Fatal(err)
				}
			}
			// Leave the real periodic worker running after a terminal cold boot.
			time.Sleep(350 * time.Millisecond)
			stop()
			mu.Lock()
			defer mu.Unlock()
			if calls != attempts || (mode == "timeout-duplicate-ack" && unique != 1) {
				t.Fatal("cold terminal retry or duplicate business projection", calls, unique)
			}
			t.Logf("NORMAL_PRODUCTS_ACTUAL_TLS mode=%s calls=%d uniqueProjection=%d coldBoots=%d sourceAdmission=0 money=0", mode, calls, unique, attempts+1)
		})
	}
}
