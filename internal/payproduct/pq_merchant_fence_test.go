//go:build pay_pq

package payproduct

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func TestNativeInvoiceIntentBindingChecksOriginalMemberAtFinalStoreCommit(t *testing.T) {
	f := newNativeServiceFixture(t)
	request := nativeIntentTestRequest(f)
	source, reader := nativeIntentTestSource(t, f.service.parent, request, f.terms)
	reader.snapshot.Caller = f.merchant
	intents, err := NewNativeInvoiceIntents(f.service, source)
	if err != nil {
		t.Fatal(err)
	}
	created, err := intents.CreateInvoiceIntent(context.Background(), request, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	binding, err := source.ResolveInvoiceIntent(context.Background(), NativeInvoiceIntentAccess{Operation: "submit_merchant_member", Intent: request})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- f.service.parent.store.Update(func(*Snapshot) error { return binding.Current() }) }()
	select {
	case err = <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("actual intent Current re-entered original Store")
	}
	account, _ := accountaddress.Encode(f.merchant)
	if err = f.service.parent.store.Update(func(data *Snapshot) error {
		key := reader.snapshot.ProductMerchantID + ":" + account
		m := data.MerchantMembers[key]
		m.Status = "revoked"
		data.MerchantMembers[key] = m
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	err = f.service.parent.store.Update(func(data *Snapshot) error {
		if err := binding.Current(); err != nil {
			return err
		}
		data.BusinessDispatches["denied-native-original"] = BusinessDispatchRecord{}
		return nil
	})
	if !errors.Is(err, ErrNativeMerchantFenceUnavailable) {
		t.Fatal("original Source snapshot bypassed late local revoke", err)
	}
	server, _, err := NewPrivateNativePayServer(f.service.parent, f.service.cfg, source, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/v5/pay/invoice-intents/"+created.IntentID+"/merchant-review", strings.NewReader("{}")))
	if response.Code != 503 || !strings.Contains(response.Body.String(), "NATIVE_PAY_AUTHORITY_UNAVAILABLE") {
		t.Fatal("actual private route lost revoked authority refusal", response.Code, response.Body.String())
	}
}
