package video

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGatewayAIStreamsBoundedProvenance(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer pay-token" {
			http.Error(w, "unauthorized", 401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			fmt.Fprint(w, `{"Owner":"ynx1owner","State":"committed","amount_ynxt":5}`)
			return
		}
		w.WriteHeader(http.StatusCreated)
		fmt.Fprint(w, `{"ID":"pay_1","State":"awaiting_wallet_confirmation"}`)
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
