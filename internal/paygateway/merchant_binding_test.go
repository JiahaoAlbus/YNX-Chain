package paygateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// Regression: an authenticated merchant must not mutate another merchant's
// objects merely by knowing their IDs. These are real Core objects and events.
func TestMerchantBindingRejectsForeignIntentAndInvoiceWithoutEffects(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	foreign, err := d.CreatePayIntent("other-merchant", 50, "")
	if err != nil {
		t.Fatal(err)
	}
	invoice, err := d.CreateInvoice(foreign.ID, 24)
	if err != nil {
		t.Fatal(err)
	}
	core := httptest.NewServer(api.NewServerWithConfig(d, api.ServerConfig{PayGatewayUpstreamKey: testUpstreamKey}))
	defer core.Close()
	gateway := httptest.NewServer(NewServer(newTestService(t, core.URL, t.TempDir()+"/audit.jsonl", 100)).Handler())
	defer gateway.Close()
	before := len(d.PayEvents(foreign.ID))
	for _, tc := range []struct {
		path string
		body map[string]any
	}{
		{"/pay/invoices", map[string]any{"intentId": foreign.ID, "dueInHours": 24, "idempotencyKey": "foreign-invoice"}},
		{"/pay/refunds", map[string]any{"intentId": foreign.ID, "amount": 50, "idempotencyKey": "foreign-refund"}},
		{"/pay/invoices/" + invoice.ID + "/settle", map[string]any{"transactionHash": "0x" + strings.Repeat("a", 64), "payer": "0x" + strings.Repeat("1", 40), "idempotencyKey": "foreign-settle"}},
	} {
		doPayJSON(t, http.MethodPost, gateway.URL+tc.path, tc.body, http.StatusForbidden, nil)
	}
	if len(d.PayEvents(foreign.ID)) != before {
		t.Fatal("foreign mutation created Core events")
	}
	if _, err := d.CreateRefund(foreign.ID, 50, "owner operation after rejected foreign request"); err != nil {
		t.Fatal("foreign request consumed refund capacity")
	}
	var own map[string]any
	doPayJSON(t, http.MethodPost, gateway.URL+"/pay/intents", map[string]any{"amount": 50, "idempotencyKey": "own-intent"}, http.StatusCreated, &own)
	doPayJSON(t, http.MethodPost, gateway.URL+"/pay/invoices", map[string]any{"intentId": own["id"], "idempotencyKey": "own-invoice"}, http.StatusCreated, nil)
	doPayJSON(t, http.MethodPost, gateway.URL+"/pay/refunds", map[string]any{"intentId": own["id"], "amount": 50, "idempotencyKey": "own-refund"}, http.StatusCreated, nil)
}

func TestMerchantBindingRejectsMissingUntrustedOrUnavailableOriginal(t *testing.T) {
	for _, tc := range []struct {
		name, response string
		status         int
	}{
		{"missing merchant", `{"id":"intent-1"}`, 200},
		{"different merchant", `{"id":"intent-1","merchant":"other"}`, 200},
		{"different ID", `{"id":"intent-2","merchant":"` + testMerchantID + `"}`, 200},
		{"not found", `{}`, 404},
		{"unavailable", `{}`, 503},
		{"invalid JSON", `{`, 200},
		{"trailing JSON", `{"id":"intent-1","merchant":"` + testMerchantID + `"}{}`, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var writes atomic.Int32
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("X-YNX-Pay-Gateway-Upstream-Key") != testUpstreamKey {
					t.Error("original read missing service credential")
				}
				if r.Method == http.MethodPost {
					writes.Add(1)
					w.WriteHeader(http.StatusCreated)
					return
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.response))
			}))
			defer core.Close()
			gateway := httptest.NewServer(NewServer(newTestService(t, core.URL, t.TempDir()+"/audit.jsonl", 100)).Handler())
			defer gateway.Close()
			payload, _ := json.Marshal(map[string]any{"intentId": "intent-1", "merchant": testMerchantID, "amount": 50, "idempotencyKey": "attacker-self-assertion"})
			req, _ := http.NewRequest(http.MethodPost, gateway.URL+"/pay/refunds", strings.NewReader(string(payload)))
			req.Header.Set("X-YNX-Pay-Key", testAPIKey)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			_ = resp.Body.Close()
			if resp.StatusCode < 400 || writes.Load() != 0 {
				t.Fatal("unverified original permitted mutation")
			}
		})
	}
}
