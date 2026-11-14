//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type nativeIntentSourceFixture struct {
	snapshot NativeInvoiceSourceSnapshot
	denied   bool
}

func (f *nativeIntentSourceFixture) ReadInvoiceIntentSource(context.Context, NativeInvoiceIntentAccess) (NativeInvoiceSourceSnapshot, error) {
	if f.denied {
		return f.snapshot, ErrNativePayUnavailable
	}
	return f.snapshot, nil
}
func nativeIntentTestRequest(f *nativeServiceFixture) NativeInvoiceProductIntent {
	return NativeInvoiceProductIntent{ProductID: "cloud.ide-usage", SourceOrder: "order-100", Merchant: f.merchant, Recipient: f.merchant, Genesis: hex.EncodeToString(f.network), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1", AmountAtoms: "100", DomainData: json.RawMessage(`{"billId":"order-100","approvalRef":"actual-temporary-price-approval","scheduleRevision":"1","instance":"original-instance","sampleSeq":"3"}`)}
}
func nativeIntentTestSource(t *testing.T, parent *Service, request NativeInvoiceProductIntent, terms ynxauth.InvoiceTermsPayload) (NativeInvoiceIntentSource, *nativeIntentSourceFixture) {
	t.Helper()
	payout, err := accountaddress.Encode(request.Recipient)
	if err != nil {
		t.Fatal(err)
	}
	registered, err := parent.Onboard(OnboardInput{DisplayName: "Native intent fixture merchant", PayoutAddress: payout, IdempotencyKey: "native-intent-fixture-merchant"})
	if err != nil {
		t.Fatal(err)
	}
	reader := &nativeIntentSourceFixture{snapshot: NativeInvoiceSourceSnapshot{Caller: "cloud-private-fixture", Intent: request, ProductMerchantID: registered.Merchant.ID, MerchantAccount: request.Merchant, StoreID: request.StoreID, Terms: terms, AllowedOperations: []string{"create", "read", "lookup", "merchant_review", "submit_merchant_member", "reconcile"}, Until: parent.now().Add(time.Hour), Current: func() error { return nil }}}
	source, err := NewRegisteredNativeInvoiceIntentSource(parent, reader)
	if err != nil {
		t.Fatal(err)
	}
	return source, reader
}
func TestNativeInvoiceIntentPrivateHTTPMerchantMemberUnknownAndColdLookup(t *testing.T) {
	f := newNativeServiceFixture(t)
	request := nativeIntentTestRequest(f)
	source, reader := nativeIntentTestSource(t, f.service.parent, request, f.terms)
	server, intents, err := NewPrivateNativePayServer(f.service.parent, f.service.cfg, source, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := httptest.NewServer(server.Handler())
	defer endpoint.Close()
	client, err := NewNativeInvoiceIntentClient(endpoint.URL, endpoint.Client())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	current := func() error { return nil }
	view, err := client.CreateInvoiceIntent(ctx, request, current)
	if err != nil || view.State != "PREPARED" || view.Terms.InvoiceID != f.terms.InvoiceID || view.OriginalOperation != view.IntentID || f.writes != 0 {
		t.Fatal("normal product intent did not stop at original merchant approval", err, view)
	}
	if _, err = client.MerchantTermsReview(ctx, view.IntentID); err == nil {
		t.Fatal("Cloud caller impersonated merchant reviewer")
	}
	reader.snapshot.Caller = f.merchant
	review, err := client.MerchantTermsReview(ctx, view.IntentID)
	if err != nil {
		t.Fatal(err)
	}
	member := f.sign(t, ynxauth.ActionInvoiceTerms, f.terms, 2)
	_, action, err := nativePayHTTPMember(member)
	if err != nil || !bytes.Equal(mustActionBytes(action), review.Message) || nativeIntentMessageHash(review.Message) != view.SigningMessageHash {
		t.Fatal("normal merchant signing bytes differ from actual CORE original", err)
	}
	bad, _ := ynxbatch.DecodeMember(member)
	bad.Certificate.SigmaA[0] ^= 1
	damaged, _ := ynxbatch.EncodeMember(bad)
	if _, err = client.SubmitMerchantTerms(ctx, view.IntentID, damaged); err == nil || f.writes != 0 {
		t.Fatal("damaged merchant branch poisoned intent or reached Core", err)
	}
	f.loss = true
	if _, err = client.SubmitMerchantTerms(ctx, view.IntentID, member); err == nil {
		t.Fatal("lost Core response reported known submission")
	}
	if f.writes != 1 {
		t.Fatal("original broadcast was not singular", f.writes)
	}
	cold, err := OpenStore(f.service.parent.store.path, f.service.parent.key)
	if err != nil {
		t.Fatal(err)
	}
	f.service.parent.store = cold
	reader.snapshot.Caller = "cloud-private-fixture"
	f.source.grant.Principal = "cloud-private-fixture"
	f.source.grant.BoundInvoiceRead = true
	f.source.grant.LedgerNonce = 2
	restored, err := client.LookupInvoiceIntent(ctx, request)
	if err != nil || restored.IntentID != view.IntentID || restored.TermsNativeHash == "" || restored.State != "PREPARED" || restored.Invoice["paidAtoms"] != "0" {
		t.Fatal("cold normal bill lookup lost original hash or invented payment", err, restored)
	}
	if _, err = client.CreateInvoiceIntent(ctx, request, current); err != nil || f.writes != 1 {
		t.Fatal("same product key replanned or resubmitted unknown", err, f.writes)
	}
	if _, err = intents.ReconcileInvoiceIntent(ctx, view.IntentID); !errors.Is(err, ErrNativePayUnavailable) || f.writes != 1 {
		t.Fatal("lookup lacked proof but changed original submission", err)
	}
	reader.snapshot.Caller = f.merchant
	f.source.grant.Principal = f.merchant
	if _, err = client.SubmitMerchantTerms(ctx, view.IntentID, member); err != nil || f.writes != 1 {
		t.Fatal("merchant original replay required consumed nonce or re-sent", err)
	}
	replacement := f.sign(t, ynxauth.ActionInvoiceTerms, f.terms, 2)
	if !bytes.Equal(replacement, member) {
		if _, err = client.SubmitMerchantTerms(ctx, view.IntentID, replacement); err == nil {
			t.Fatal("replacement signature overwrote original unknown Member")
		}
	}
	reader.denied = true
	if _, err = client.LookupInvoiceIntent(ctx, request); err == nil {
		t.Fatal("retired private source read original bill")
	}
}
func TestNativeInvoiceIntentSourceAliasesAndApprovedMoneyAreNotRequestAuthority(t *testing.T) {
	f := newNativeServiceFixture(t)
	request := nativeIntentTestRequest(f)
	source, reader := nativeIntentTestSource(t, f.service.parent, request, f.terms)
	intents, err := NewNativeInvoiceIntents(f.service, source)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err = intents.CreateInvoiceIntent(ctx, request, nil); err == nil {
		t.Fatal("absent original bill current fence accepted")
	}
	current := func() error { return nil }
	view, err := intents.CreateInvoiceIntent(ctx, request, current)
	if err != nil {
		t.Fatal(err)
	}
	changed := request
	changed.AmountAtoms = "1"
	if _, err = intents.CreateInvoiceIntent(ctx, changed, current); err == nil {
		t.Fatal("raw amount1 replaced approved bill100")
	}
	changed = request
	changed.SourceOrder = "another-bill"
	reader.snapshot.Intent = changed
	if _, err = intents.CreateInvoiceIntent(ctx, changed, current); err == nil {
		t.Fatal("one signed session aliased second bill")
	}
	reader.snapshot.Intent = request
	reader.snapshot.Caller = f.merchant
	f.source.grant.LedgerNonce++
	if _, err = intents.MerchantTermsReview(ctx, view.IntentID); err == nil {
		t.Fatal("original intent silently replanned at later nonce")
	}
	f.source.grant.LedgerNonce--
	account, _ := accountaddress.Encode(f.merchant)
	if err = f.service.parent.store.Update(func(data *Snapshot) error {
		key := reader.snapshot.ProductMerchantID + ":" + account
		m := data.MerchantMembers[key]
		m.Status = "inactive"
		data.MerchantMembers[key] = m
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = intents.MerchantTermsReview(ctx, view.IntentID); err == nil {
		t.Fatal("Source scope bypassed original retired merchant membership")
	}
	reader.snapshot.StoreID = "unregistered-store"
	if _, err = intents.ReadInvoiceIntent(ctx, view.IntentID); err == nil {
		t.Fatal("changed original product/store mapping accepted")
	}
	reader.snapshot.StoreID = ""
	reader.snapshot.AllowedOperations = []string{"create"}
	if _, err = intents.ReadInvoiceIntent(ctx, view.IntentID); err == nil {
		t.Fatal("Source create scope became private read scope")
	}
	if f.writes != 0 {
		t.Fatal("approval preparation moved funds or submitted terms")
	}
}
func TestNativeInvoiceIntentCrashBeforeAndAfterOriginalRegisterRemainsLookupOnly(t *testing.T) {
	f := newNativeServiceFixture(t)
	request := nativeIntentTestRequest(f)
	source, reader := nativeIntentTestSource(t, f.service.parent, request, f.terms)
	intents, _ := NewNativeInvoiceIntents(f.service, source)
	ctx := context.Background()
	view, err := intents.CreateInvoiceIntent(ctx, request, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	wire := f.sign(t, ynxauth.ActionInvoiceTerms, f.terms, 2)
	// Unit crash injection: retain real AND Member at the actual pre-Register
	// journal boundary. This does not seed a chain effect or a paid status.
	err = f.service.parent.store.Update(func(data *Snapshot) error {
		r, _, err := intents.load(*data, view.IntentID)
		if err != nil {
			return err
		}
		r.Member = wire
		r.Phase = "signed_not_submitted"
		return intents.save(data, r)
	})
	if err != nil {
		t.Fatal(err)
	}
	restored, err := intents.LookupInvoiceIntent(ctx, request)
	if err != nil || restored.Phase != "signed_not_submitted" || f.writes != 0 {
		t.Fatal("lookup broadcast a pre-send cold original", err, f.writes)
	}
	reader.snapshot.Caller = f.merchant
	op, err := f.service.RegisterTerms(ctx, request.SourceOrder, wire)
	if err != nil {
		t.Fatal(err)
	}
	// Original Register is durable but outer intent hash archival was lost.
	if _, err = intents.ReconcileInvoiceIntent(ctx, view.IntentID); !errors.Is(err, ErrNativePayUnavailable) {
		t.Fatal("missing trusted proof accepted", err)
	}
	restored, err = intents.LookupInvoiceIntent(ctx, request)
	if err != nil || restored.TermsNativeHash != op.NativeHash || f.writes != 1 {
		t.Fatal("post-Register crash did not recover exact original", err, restored)
	}
}
func TestNativeInvoiceIntentPrivateConstructorDoesNotFabricateSource(t *testing.T) {
	f := newNativeServiceFixture(t)
	if _, _, err := NewPrivateNativePayServer(f.service.parent, f.service.cfg, nil, buildinfo.Info{}, nil); err == nil {
		t.Fatal("missing real intent Source mounted")
	}
	if _, err := NewRegisteredNativeInvoiceIntentSource(f.service.parent, nil); err == nil {
		t.Fatal("missing original joint reader became static grant")
	}
	request := nativeIntentTestRequest(f)
	request.DomainData = json.RawMessage(`{"bill":"first","bill":"second"}`)
	source, _ := nativeIntentTestSource(t, f.service.parent, request, f.terms)
	intents, _ := NewNativeInvoiceIntents(f.service, source)
	if _, err := intents.CreateInvoiceIntent(context.Background(), request, func() error { return nil }); err == nil {
		t.Fatal("ambiguous original bill data accepted")
	}
}

func TestNativeInvoiceIntentConcurrentCreateHasOneOriginalNoSigning(t *testing.T) {
	f := newNativeServiceFixture(t)
	request := nativeIntentTestRequest(f)
	source, _ := nativeIntentTestSource(t, f.service.parent, request, f.terms)
	intents, _ := NewNativeInvoiceIntents(f.service, source)
	var group sync.WaitGroup
	type result struct {
		view NativeInvoiceIntentView
		err  error
	}
	results := make(chan result, 8)
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			v, e := intents.CreateInvoiceIntent(context.Background(), request, func() error { return nil })
			results <- result{v, e}
		}()
	}
	group.Wait()
	close(results)
	var original string
	for row := range results {
		if row.err != nil {
			t.Fatal(row.err)
		}
		if original == "" {
			original = row.view.IntentID
		}
		if row.view.IntentID != original || row.view.Phase != "awaiting_merchant_approval" {
			t.Fatal("concurrent create changed original intent")
		}
	}
	count := 0
	if err := f.service.parent.store.View(func(data Snapshot) error {
		for _, r := range data.BusinessDispatches {
			if r.Operation == "native.invoice.intent" {
				count++
			}
		}
		return nil
	}); err != nil || count != 1 || f.writes != 0 {
		t.Fatal("concurrent reservation produced additional original or external effect", err, count, f.writes)
	}
}

// A Source may retire after the initial read but before durable crash repair.
// The Current callback is pure; the lock check only injects that exact boundary.
type nativeIntentResolveFunc func(context.Context, NativeInvoiceIntentAccess) (NativeInvoiceIntentBinding, error)

func (f nativeIntentResolveFunc) ResolveInvoiceIntent(ctx context.Context, access NativeInvoiceIntentAccess) (NativeInvoiceIntentBinding, error) {
	return f(ctx, access)
}

func TestNativeInvoiceIntentCrashRepairFencesBeforeDurableMutation(t *testing.T) {
	f := newNativeServiceFixture(t)
	request := nativeIntentTestRequest(f)
	source, reader := nativeIntentTestSource(t, f.service.parent, request, f.terms)
	intents, _ := NewNativeInvoiceIntents(f.service, source)
	ctx := context.Background()
	view, err := intents.CreateInvoiceIntent(ctx, request, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	wire := f.sign(t, ynxauth.ActionInvoiceTerms, f.terms, 2)
	if err = f.service.parent.store.Update(func(data *Snapshot) error {
		record, _, e := intents.load(*data, view.IntentID)
		if e != nil {
			return e
		}
		record.Member, record.Phase = wire, "signed_not_submitted"
		return intents.save(data, record)
	}); err != nil {
		t.Fatal(err)
	}
	reader.snapshot.Caller = f.merchant
	if _, err = f.service.RegisterTerms(ctx, request.SourceOrder, wire); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(f.service.parent.store.path)
	if err != nil {
		t.Fatal(err)
	}
	var deniedAtWrite bool
	intents.source = nativeIntentResolveFunc(func(ctx context.Context, access NativeInvoiceIntentAccess) (NativeInvoiceIntentBinding, error) {
		grant, e := source.ResolveInvoiceIntent(ctx, access)
		if e != nil {
			return grant, e
		}
		original := grant.Current
		grant.Current = func() error {
			if !f.service.parent.store.mu.TryRLock() {
				deniedAtWrite = true
				return ErrNativePayUnavailable
			}
			f.service.parent.store.mu.RUnlock()
			return original()
		}
		return grant, nil
	})
	if _, err = intents.ReconcileInvoiceIntent(ctx, view.IntentID); !errors.Is(err, ErrNativePayUnavailable) {
		t.Fatal("retired Source repaired original metadata", err)
	}
	after, err := os.ReadFile(f.service.parent.store.path)
	if err != nil {
		t.Fatal(err)
	}
	if !deniedAtWrite || !bytes.Equal(before, after) || f.writes != 1 {
		t.Fatal("late retirement failed to preserve exact original disk/Member", deniedAtWrite, f.writes)
	}
}
