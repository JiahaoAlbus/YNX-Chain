package commerce

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTrustDisputeContractMinimizesEvidenceAndPreservesTruth(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/actions" || r.Header.Get("Authorization") != "Bearer trust-service-key" || r.Header.Get("X-YNX-Role") != "user" {
			http.Error(w, "bad contract", http.StatusBadRequest)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			http.Error(w, "bad json", 400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"case":{"ID":"case_shop_1","Status":"submitted","CreatedAt":"2026-07-16T00:00:00Z"}}`))
	}))
	defer server.Close()
	order := Order{ID: "order_1", Buyer: "ynx1buyer", StoreID: "store_1", Status: "disputed", Resolution: &Resolution{Reason: "not as described", Explanation: "sealed evidence available"}, UpdatedAt: time.Now()}
	g := HTTPTrustGateway{BaseURL: server.URL, APIKey: "trust-service-key", PublicBaseURL: "https://trust.ynxweb4.com", Client: server.Client()}
	evidence, err := g.SubmitDispute(context.Background(), order, "dispute-key-1")
	if err != nil {
		t.Fatal(err)
	}
	if evidence.CaseID != "case_shop_1" || evidence.Source != "ynx-trust-center-api" || !strings.HasSuffix(evidence.AppealURL, "/appeal") {
		t.Fatalf("bad evidence: %+v", evidence)
	}
	body, _ := json.Marshal(received)
	for _, private := range []string{"sealed evidence available", "ynx1buyer"} {
		if strings.Contains(string(body), private) {
			t.Fatalf("private/raw evidence crossed Trust boundary: %s", body)
		}
	}
	if !strings.Contains(string(body), "private address and payment history are excluded") {
		t.Fatalf("privacy boundary missing: %s", body)
	}
	if !strings.Contains(string(body), "sha256:") {
		t.Fatalf("no auditable evidence digest: %s", body)
	}
}
