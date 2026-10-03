package video

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestGatewayAIStreamsBoundedProvenance(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/video/stream" || r.Header.Get("Authorization") != "Bearer gateway-token" || r.Header.Get("Accept") != "application/x-ndjson" {
			http.Error(w, "bad request", 400)
			return
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		fmt.Fprintln(w, `{"delta":"reviewed ","provider":"provider-a","model":"model-a"}`)
		fmt.Fprintln(w, `{"delta":"summary","units":9,"done":true}`)
	}))
	defer upstream.Close()
	var chunks []string
	result, err := (GatewayAI{Endpoint: upstream.URL, Token: "gateway-token", Client: upstream.Client()}).Stream(context.Background(), AIRequest{Kind: "summary", VideoID: "vid_test"}, func(delta string) error { chunks = append(chunks, delta); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "reviewed summary" || result.Provider != "provider-a" || result.Model != "model-a" || result.Units != 9 || strings.Join(chunks, "") != result.Text {
		t.Fatalf("unexpected stream result: %+v chunks=%v", result, chunks)
	}
}

func TestPayClientRequiresCommittedReceiptAndWalletConfirmation(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer pay-token" {
			http.Error(w, "unauthorized", 401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			fmt.Fprint(w, `{"ID":"settlement_1","IntentID":"intent_1","InvoiceID":"receipt-1","Merchant":"ynx-video","PayoutAddress":"ynx1owner","Payer":"ynx1payer","Currency":"YNXT","TransactionHash":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","Status":"paid","AuditHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","Amount":5,"BlockNumber":9}`)
			return
		}
		w.WriteHeader(http.StatusCreated)
		fmt.Fprint(w, `{"ID":"pay_1","Merchant":"ynx-video","PayoutAddress":"ynx1owner","Status":"created","Currency":"YNXT","Amount":5}`)
	}))
	defer server.Close()
	client := PayClient{Endpoint: server.URL, Token: "pay-token", Client: server.Client()}
	if err := client.VerifyReceipt(context.Background(), "receipt-1", "ynx1owner", 5); err != nil {
		t.Fatal(err)
	}
	id, err := client.CreatePayoutIntent(context.Background(), "ynx1owner", 5, "payout_1")
	if err != nil || id != "pay_1" {
		t.Fatalf("payout intent failed: %s %v", id, err)
	}
}

func TestVideoPayTransportRejectsRedirectTrailingAndOversize(t *testing.T) {
	for _, kind := range []string{"redirect", "trailing", "oversize", "mismatch"} {
		t.Run(kind, func(t *testing.T) {
			var followed atomic.Int32
			destination := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { followed.Add(1) }))
			defer destination.Close()
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch kind {
				case "redirect":
					http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
				case "trailing":
					fmt.Fprint(w, `{"ID":"pay_1","Merchant":"ynx-video","PayoutAddress":"ynx1owner","Status":"created","Currency":"YNXT","Amount":5} {}`)
				case "oversize":
					fmt.Fprint(w, strings.Repeat(" ", (1<<20)+1))
				case "mismatch":
					fmt.Fprint(w, `{"ID":"pay_1","Merchant":"other","PayoutAddress":"ynx1owner","Status":"paid","Currency":"YNXT","Amount":5}`)
				}
			}))
			defer server.Close()
			if _, err := (PayClient{Endpoint: server.URL, Token: "test-server-token", Client: server.Client()}).CreatePayoutIntent(context.Background(), "ynx1owner", 5, "original_intent"); err == nil {
				t.Fatal("unsafe Pay receipt accepted")
			}
			if followed.Load() != 0 {
				t.Fatal("authorization redirected")
			}
		})
	}
}
func TestVideoPayRejectsNonHTTPSBeforeTransport(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer server.Close()
	if _, err := (PayClient{Endpoint: server.URL, Token: "test-token", Client: server.Client()}).CreatePayoutIntent(context.Background(), "ynx1owner", 5, "original_intent"); err == nil || calls.Load() != 0 {
		t.Fatal("HTTP endpoint transported secret or effect")
	}
}

func TestVideoAIStreamRequiresCompleteBoundedEOFWire(t *testing.T) {
	for _, kind := range []string{"missing-done", "after-done", "unknown-field", "trailing", "oversize", "invalid-utf8"} {
		t.Run(kind, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				valid := `{"delta":"retained text","provider":"p","model":"m"}` + "\n"
				switch kind {
				case "missing-done":
					fmt.Fprint(w, valid)
				case "after-done":
					fmt.Fprint(w, valid+`{"done":true}`+"\n"+`{"delta":"late"}`+"\n")
				case "unknown-field":
					fmt.Fprint(w, valid+`{"done":true,"unknown":1}`+"\n")
				case "trailing":
					fmt.Fprint(w, valid+`{"done":true} {}`+"\n")
				case "oversize":
					fmt.Fprint(w, valid+strings.Repeat(" ", (1<<20)+1))
				case "invalid-utf8":
					fmt.Fprint(w, valid)
					w.Write([]byte{'{', '"', 'd', 'e', 'l', 't', 'a', '"', ':', '"', 255, '"', '}', '\n'})
				}
			}))
			defer server.Close()
			if _, err := (GatewayAI{Endpoint: server.URL, Token: "server-test-key", Client: server.Client()}).Stream(context.Background(), AIRequest{Kind: "summary"}, func(string) error { return nil }); err == nil {
				t.Fatal("incomplete or invalid provider stream completed")
			}
		})
	}
}
