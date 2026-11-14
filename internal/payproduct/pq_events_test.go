//go:build pay_pq

package payproduct

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// Projection unit boundary only: the existing original journal's confirmed
// fact is the prerequisite under test, not a new finality or money proof.
// Real H/H+1/100/30/70 evidence is reused from the retained original workflow.
func TestNativeInvoiceEventsOriginalClaimRefsPrivateHTTPAndColdStore(t *testing.T) {
	f := newNativeServiceFixture(t)
	wire := f.sign(t, ynxauth.ActionInvoiceTerms, f.terms, 2)
	op, err := f.service.RegisterTerms(context.Background(), "order-100", wire)
	if err != nil {
		t.Fatal(err)
	}
	effect := consensus.PQInvoiceEffect{Version: consensus.PQInvoiceEffectVersion, Genesis: hex.EncodeToString(f.network), NativeChainID: 6423, Kind: op.Kind, Merchant: f.merchant, InvoiceID: f.terms.InvoiceID, SessionID: f.terms.SessionID, NativeHash: op.NativeHash, ABCIHash: op.ABCIHash, Height: 7}
	if err = f.service.parent.store.Update(func(data *Snapshot) error {
		state, _, e := f.service.load(*data, f.merchant, f.terms.InvoiceID)
		if e != nil {
			return e
		}
		effect.TermsHash = state.TermsHash
		retained := state.Operations[op.NativeHash]
		retained.Status = "confirmed"
		retained.Effect = &effect
		state.Operations[op.NativeHash] = retained
		state.ProductMerchantID = "original-product-merchant"
		data.Deliveries["whd_original"] = WebhookDelivery{ID: "whd_original", MerchantID: state.ProductMerchantID, ObjectID: op.NativeHash, EventType: "native.invoice." + op.Kind}
		data.Deliveries["whd_replay"] = WebhookDelivery{ID: "whd_replay", MerchantID: state.ProductMerchantID, ObjectID: op.NativeHash, EventType: "native.invoice." + op.Kind, ParentDeliveryID: "whd_original"}
		state.Operations["unknown-original"] = NativePayOperation{Status: "unknown"}
		return f.service.save(data, state)
	}); err != nil {
		t.Fatal(err)
	}
	server := NewClosedProductionServerWithLogger(f.service.parent, buildinfo.Info{}, nil)
	if err = server.MountNativePay(f.service); err != nil {
		t.Fatal(err)
	}
	read := func() NativeInvoiceEventFeed {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/v5/pay/invoices/"+f.merchant+"/"+f.terms.InvoiceID+"/events", nil))
		var feed NativeInvoiceEventFeed
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &feed) != nil {
			t.Fatal("original event route unavailable", response.Code, response.Body.String())
		}
		if strings.Contains(response.Body.String(), "paidAtoms") || strings.Contains(response.Body.String(), "signature") || strings.Contains(response.Body.String(), "member\"") {
			t.Fatal("notification feed leaked funds cache/wire/secret")
		}
		return feed
	}
	feed := read()
	if len(feed.Events) != 1 || feed.Events[0].EventID != nativeEventClaim(effect) || feed.Events[0].OriginalWebhookEventID != "whd_original" || feed.Events[0].Height != "7" || feed.Events[0].Member != "0" || feed.Events[0].EffectHash != hashJSON(effect) {
		t.Fatal("event projection changed original claim or manual replay identity", feed)
	}
	cold, err := OpenStore(f.service.parent.store.path, f.service.parent.key)
	if err != nil {
		t.Fatal(err)
	}
	f.service.parent.store = cold
	if got := read(); hashJSON(got) != hashJSON(feed) {
		t.Fatal("cold event references changed")
	}
	f.source.denied = true
	if _, err = f.service.InvoiceEvents(context.Background(), f.merchant, f.terms.InvoiceID); err == nil {
		t.Fatal("retired caller read private original events")
	}
}
