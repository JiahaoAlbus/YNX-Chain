package paygateway

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestBFTFundsRoutesRejectWithoutBroadcastOrPaymentSuccess(t *testing.T) {
	for _, tc := range []struct {
		name, path, body, capability, firstCause string
	}{
		{"settlement", "/pay/invoices/00112233445566778899aabb/settle", `{"payer":"unused","transactionHash":"0xunused","idempotencyKey":"settle-capability"}`, "invoice_settlement", "invoice settlement is not implemented for candidate BFT Pay mode"},
		{"refund", "/pay/refunds", `{"intentId":"00112233445566778899aabb","amount":30,"reason":"partial refund","idempotencyKey":"refund-capability"}`, "refund_transfer", "refund transfer is not implemented for candidate BFT Pay mode"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var upstreamCalls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				upstreamCalls.Add(1)
				// Even a misleading upstream success cannot supply a missing funds action.
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"status":"paid","refunded":true}`)
			}))
			defer upstream.Close()
			key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 103))
			address, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
			if err != nil {
				t.Fatal(err)
			}
			auditPath := t.TempDir() + "/audit.jsonl"
			service, err := New(Config{ChainURL: upstream.URL, MerchantID: testMerchantID, APIKey: testAPIKey, WebhookSigningKey: testWebhookKey, AuditLog: auditPath, UpstreamMode: UpstreamBFT, SignerKey: fmt.Sprintf("%064x", 103), SignerAddress: address})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			request.Header.Set("Authorization", "Bearer "+testAPIKey)
			response := httptest.NewRecorder()
			NewServer(service).Handler().ServeHTTP(response, request)
			var result map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusNotImplemented || result["code"] != "BFT_FUNDS_CAPABILITY_UNAVAILABLE" || result["capability"] != tc.capability || !strings.Contains(fmt.Sprint(result["error"]), tc.firstCause) {
				t.Fatalf("expected explicit unavailable funds capability, got HTTP %d %s", response.Code, response.Body.String())
			}
			if result["requestId"] == "" || response.Header().Get("X-Request-ID") != result["requestId"] || result["status"] != nil || result["paid"] != nil || result["refunded"] != nil {
				t.Fatalf("unsupported funds response must retain request identity and no payment success: %s", response.Body.String())
			}
			if calls := upstreamCalls.Load(); calls != 0 {
				t.Fatalf("unavailable funds action touched upstream %d times", calls)
			}
			health := service.snapshotHealth(buildinfo.Info{})
			if health.Requests != 1 || health.Successes != 0 || health.Active != 0 {
				t.Fatalf("unavailable funds action counted as success or remained active: %+v", health)
			}
			audit, err := os.ReadFile(auditPath)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(audit), `"outcome":"capability_unavailable"`) || strings.Contains(string(audit), `"outcome":"proxied"`) {
				t.Fatalf("audit must retain funds capability rejection: %s", audit)
			}
		})
	}
}
