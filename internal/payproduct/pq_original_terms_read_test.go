//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func TestNativeInvoiceReadRetainsOriginalTermsDataOnly(t *testing.T) {
	// PUBLIC source/temporary keys, actual original Store/Member/HTTP code.
	// A lost original submit remains UNKNOWN; reading never sends it again.
	f := newNativeServiceFixture(t)
	f.loss = true
	wire := f.sign(t, ynxauth.ActionInvoiceTerms, f.terms, 2)
	op, err := f.service.RegisterTerms(context.Background(), "order-100", wire)
	if err == nil || op.Status != "unknown" || f.writes != 1 {
		t.Fatal("original UNKNOWN fixture was not retained", err)
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		t.Fatal(err)
	}
	path := "/v5/pay/invoices/" + f.merchant + "/invoice-100"
	response := httptest.NewRecorder()
	f.service.Handler().ServeHTTP(response, httptest.NewRequest("GET", path, nil))
	var view struct {
		TermsMessage []byte `json:"termsMessage"`
		Paid         string `json:"paidAtoms"`
		Status       string `json:"status"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &view) != nil || !bytes.Equal(view.TermsMessage, member.Message) || view.Paid != "0" || view.Status != "awaiting_terms_finality" || f.writes != 1 {
		t.Fatal("original terms read changed bytes/UNKNOWN or claimed money", response.Code, f.writes)
	}
	f.source.denied = true
	denied := httptest.NewRecorder()
	f.service.Handler().ServeHTTP(denied, httptest.NewRequest("GET", path, nil))
	if denied.Code != 503 || bytes.Contains(denied.Body.Bytes(), []byte("termsMessage")) || f.writes != 1 {
		t.Fatal("original source refusal leaked archive or replayed", denied.Code, f.writes)
	}
}
