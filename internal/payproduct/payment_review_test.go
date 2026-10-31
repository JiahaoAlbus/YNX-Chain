package payproduct

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPaymentReviewHTTPShowsSignedTermsButNeverInventsApproval(t *testing.T) {
	s, m, invoice, _ := settlementClaimFixture(t)
	request := httptest.NewRequest(http.MethodGet, "/v1/invoices/"+invoice.ID+"/review", nil)
	response := httptest.NewRecorder()
	NewServer(s).Handler().ServeHTTP(response, request)
	var review PaymentReview
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &review) != nil || review.Principal != 100 || review.Fee != 1 || review.Total != 101 || review.Recipient != m.PayoutAddress || review.ApprovalAvailable || review.UnavailableReason == "" {
		t.Fatal("review lost signed terms or fabricated authority", response.Code, response.Body)
	}
	s.store.Update(func(data *Snapshot) error {
		v := data.Invoices[invoice.ID]
		v.ExpiresAt = s.now().Add(-time.Second)
		data.Invoices[v.ID] = v
		return nil
	})
	if _, err := s.ReviewPayment(context.Background(), invoice.ID); err == nil {
		t.Fatal("expired invoice issued a review")
	}
}
