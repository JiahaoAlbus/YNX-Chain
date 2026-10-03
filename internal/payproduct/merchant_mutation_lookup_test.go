package payproduct

import (
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"strings"
	"testing"
	"time"
)

func TestMerchantMutationLookupOriginalActorColdStoreAndNoReplacement(t *testing.T) {
	s, m, v, server := merchantBusinessQA(t)
	session := merchantQASession(t, server, m, "")
	raw := `{"amount":8,"name":"Original item","idempotencyKey":"original-catalog-key"}`
	w := merchantQARequest(server, "POST", "/v1/merchant/catalog", raw, session.Token, "")
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body)
	}
	original := w.Body.String()
	store, err := OpenStore(s.store.path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = store
	server = newMerchantBusinessServer(s, v)
	lookup := func(body string) string {
		value, _ := json.Marshal(merchantMutationLookupInput{Method: "POST", Path: "/v1/merchant/catalog", OriginalBody: body})
		return string(value)
	}
	// A new private binding requires a new original carrier. Its fresh authority
	// can read its same account's old result without borrowing the old approval.
	v.binding = strings.Repeat("c", 64)
	session = merchantQASession(t, server, m, "")
	w = merchantQARequest(server, "POST", "/v1/merchant/mutations/lookup", lookup(raw), session.Token, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Original item") {
		t.Fatal(w.Code, w.Body)
	}
	_, _, count := merchantCounts(t, s)
	if count != 1 {
		t.Fatal("replacement", count)
	}
	for _, bad := range []string{strings.Replace(raw, "8", "9", 1), strings.Replace(raw, "original-catalog-key", "missing-catalog-key", 1), strings.Replace(raw, "Original item", "Edited", 1)} {
		w = merchantQARequest(server, "POST", "/v1/merchant/mutations/lookup", lookup(bad), session.Token, "")
		if w.Code != 409 || strings.Contains(w.Body.String(), "Original item") {
			t.Fatal("unbound read", w.Code, w.Body)
		}
	}
	// An old record with no atomic actor binding remains unknown.
	s.store.Update(func(d *Snapshot) error {
		key := "catalog:" + m.ID + ":original-catalog-key"
		rec := d.Idempotency[key]
		rec.OriginalAccount = ""
		d.Idempotency[key] = rec
		return nil
	})
	w = merchantQARequest(server, "POST", "/v1/merchant/mutations/lookup", lookup(raw), session.Token, "")
	if w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
	if !strings.Contains(original, "Original item") {
		t.Fatal("original lost")
	}
}
func TestMerchantMutationLookupRevocationAndActorIsolation(t *testing.T) {
	s, m, v, server := merchantBusinessQA(t)
	session := merchantQASession(t, server, m, "")
	raw := `{"name":"Original item","amount":8,"idempotencyKey":"original-catalog-key"}`
	if w := merchantQARequest(server, "POST", "/v1/merchant/catalog", raw, session.Token, ""); w.Code != 201 {
		t.Fatal(w.Code, w.Body)
	}
	data, _ := json.Marshal(merchantMutationLookupInput{"POST", "/v1/merchant/catalog", raw})
	s.store.Update(func(d *Snapshot) error {
		key := "catalog:" + m.ID + ":original-catalog-key"
		rec := d.Idempotency[key]
		rec.OriginalAccount = "another-account"
		d.Idempotency[key] = rec
		return nil
	})
	if w := merchantQARequest(server, "POST", "/v1/merchant/mutations/lookup", string(data), session.Token, ""); w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
	v.active.Store(false)
	if w := merchantQARequest(server, "POST", "/v1/merchant/mutations/lookup", string(data), session.Token, ""); w.Code != 401 || strings.Contains(w.Body.String(), "Original item") {
		t.Fatal(w.Code, w.Body)
	}
}

func TestMerchantMutationLookupInvoiceDoesNotCallPayAgain(t *testing.T) {
	s, m, v, server := merchantBusinessQA(t)
	s.pay = &fakePay{invoice: chain.Invoice{Merchant: m.CentralMerchantID, PayoutAddress: m.PayoutAddress, Amount: 8}}
	session := merchantQASession(t, server, m, "")
	raw := `{"amount":8,"description":"Original invoice","expiresInMinutes":30,"idempotencyKey":"original-invoice-key"}`
	w := merchantQARequest(server, "POST", "/v1/merchant/invoices", raw, session.Token, "")
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body)
	}
	pay := s.pay.(*fakePay)
	beforeIntent, beforeInvoice := pay.intentCalls, pay.invoiceCalls
	v.binding = strings.Repeat("c", 64)
	session = merchantQASession(t, server, m, "")
	data, _ := json.Marshal(merchantMutationLookupInput{"POST", "/v1/merchant/invoices", raw})
	w = merchantQARequest(server, "POST", "/v1/merchant/mutations/lookup", string(data), session.Token, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Original invoice") {
		t.Fatal(w.Code, w.Body)
	}
	if pay.intentCalls != beforeIntent || pay.invoiceCalls != beforeInvoice {
		t.Fatal("lookup called Pay")
	}
	s.store.Update(func(d *Snapshot) error { delete(d.Idempotency, "invoice:"+m.ID+":original-invoice-key"); return nil })
	w = merchantQARequest(server, "POST", "/v1/merchant/mutations/lookup", string(data), session.Token, "")
	if w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
	if pay.intentCalls != beforeIntent || pay.invoiceCalls != beforeInvoice {
		t.Fatal("missing outcome retried Pay")
	}
}

func TestMerchantMutationLookupRecurringDraftAndCurrentRole(t *testing.T) {
	s, m, v, server := merchantBusinessQA(t)
	session := merchantQASession(t, server, m, "")
	input := RecurringDraftInput{Payer: m.PayoutAddress, Description: "Original draft", Amount: 8, CadenceDays: 30, MaximumOccurrences: 12, StartsAt: s.now().Add(24 * time.Hour), IdempotencyKey: "original-recurring-key"}
	raw, _ := json.Marshal(input)
	w := merchantQARequest(server, "POST", "/v1/merchant/recurring-drafts", string(raw), session.Token, "")
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body)
	}
	lookup, _ := json.Marshal(merchantMutationLookupInput{"POST", "/v1/merchant/recurring-drafts", string(raw)})
	w = merchantQARequest(server, "POST", "/v1/merchant/mutations/lookup", string(lookup), session.Token, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Original draft") {
		t.Fatal(w.Code, w.Body)
	}
	s.store.Update(func(d *Snapshot) error {
		key := m.ID + ":" + v.account
		member := d.MerchantMembers[key]
		member.Role = "viewer"
		d.MerchantMembers[key] = member
		return nil
	})
	v.binding = strings.Repeat("c", 64)
	session = merchantQASession(t, server, m, "")
	w = merchantQARequest(server, "POST", "/v1/merchant/mutations/lookup", string(lookup), session.Token, "")
	if w.Code != 403 || strings.Contains(w.Body.String(), "Original draft") {
		t.Fatal("role downgrade exposed result", w.Code, w.Body)
	}
}
