//go:build pay_pq && pay_cloud

package payproduct

import (
	"context"
	"encoding/hex"
	"net/http/httptest"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

func TestCloudNativeInvoiceProducerActualInterfacePrivateHTTPAndStableBill(t *testing.T) {
	f := newNativeServiceFixture(t)
	request := cloud.IDEUsageInvoiceRequest{BillID: "order-100", RequestID: "deployment-request", InstanceID: "instance-original", Period: "2026-10-30", ScheduleID: "registered-price", ScheduleRevision: "1", RegistrationRef: "registered-original-merchant", ApprovalRef: "original-period-approval", Merchant: f.merchant, Recipient: f.merchant, Asset: cloud.IDEUsageAsset{Genesis: hex.EncodeToString(f.network), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1"}, Atoms: "100", SampleBinding: cloud.ObjectBinding{Bytes: 12, SHA3512: "original-sample-sha3", SHA512: "original-sample-sha512"}}
	input, err := cloudNativeIntent(request)
	if err != nil {
		t.Fatal(err)
	}
	source, reader := nativeIntentTestSource(t, f.service.parent, input, f.terms)
	server, _, err := NewPrivateNativePayServer(f.service.parent, f.service.cfg, source, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := httptest.NewServer(server.Handler())
	defer endpoint.Close()
	client, err := NewNativeInvoiceIntentClient(endpoint.URL, endpoint.Client())
	if err != nil {
		t.Fatal(err)
	}
	concrete, err := NewCloudNativeInvoiceProducer(client)
	if err != nil {
		t.Fatal(err)
	}
	var normal cloud.IDEUsageInvoiceProducer = concrete
	ctx := context.Background()
	prepared, err := normal.CreateUsageInvoice(ctx, request, func() error { return nil })
	if err != nil || prepared.Request != request || prepared.State != "PREPARED" || prepared.InvoiceID != f.terms.InvoiceID || f.writes != 0 {
		t.Fatal("actual Cloud interface bypassed original merchant approval", err, prepared)
	}
	generic, err := client.LookupInvoiceIntent(ctx, input)
	if err != nil || generic.OriginalOperation != prepared.OriginalOperation {
		t.Fatal("Cloud bridge invented a second key", err)
	}
	reader.snapshot.Caller = f.merchant
	review, err := client.MerchantTermsReview(ctx, generic.IntentID)
	if err != nil || review.Owner != f.merchant || review.FeeAtoms != "1" {
		t.Fatal("original merchant review unavailable", err)
	}
	f.loss = true
	if _, err = client.SubmitMerchantTerms(ctx, generic.IntentID, f.sign(t, ynxauth.ActionInvoiceTerms, f.terms, 2)); err == nil {
		t.Fatal("unknown Core response became issued")
	}
	cold, err := OpenStore(f.service.parent.store.path, f.service.parent.key)
	if err != nil {
		t.Fatal(err)
	}
	f.service.parent.store = cold
	reader.snapshot.Caller = "cloud-private-fixture"
	f.source.grant.Principal = "cloud-private-fixture"
	f.source.grant.BoundInvoiceRead = true
	f.source.grant.LedgerNonce++
	recovered, err := normal.LookupUsageInvoice(ctx, request)
	if err != nil || recovered.Request != request || recovered.OriginalOperation != prepared.OriginalOperation || recovered.InvoiceID != prepared.InvoiceID || recovered.State != "PREPARED" || f.writes != 1 {
		t.Fatal("Cloud cold original bill lookup replanned/rebroadcast or invented BFT", err, recovered)
	}
	changed := request
	changed.SampleBinding.Bytes++
	if _, err = normal.LookupUsageInvoice(ctx, changed); err == nil {
		t.Fatal("same bill changed original usage sample")
	}
	reader.denied = true
	if _, err = normal.LookupUsageInvoice(ctx, request); err == nil {
		t.Fatal("retired Source read original Cloud bill")
	}
}
