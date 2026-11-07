package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func nativePriceOrderFixture(t *testing.T) (*Store, string, string, StoreProfile, Product, Order) {
	t.Helper()
	s, e := Open(filepath.Join(t.TempDir(), "state.json"))
	if e != nil {
		t.Fatal(e)
	}
	_, owner := actor(t, 131)
	_, buyer := actor(t, 132)
	st, p := setupCatalog(t, s, owner, 10)
	st = s.s.Stores[st.ID]
	charges := &NativeChargesDATA{Genesis: strings.Repeat("ab", 32), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1", ShippingAtoms: "3", TaxAtoms: "5"}
	update := StoreUpdate{Name: st.Name, Description: st.Description, Policy: st.Policy, TrustURL: st.TrustURL, SettlementAccount: owner, NativeCharges: charges}
	applied, e := s.UpdateOriginalStoreProfile(owner, st.ID, NativeStoreProfileInput{Expected: st, Update: update, IdempotencyKey: "original-native-profile-price"})
	if e != nil {
		t.Fatal(e)
	}
	st = applied.Store
	in := nativeListingInputFor(p)
	in.IdempotencyKey = "original-native-seller-price"
	in.Variants[0].NativePrice = &NativePriceDATA{Genesis: charges.Genesis, NativeChainID: charges.NativeChainID, AssetID: charges.AssetID, UnitVersion: charges.UnitVersion, AmountAtoms: "7"}
	result, e := s.PublishListing(owner, p.ID, mustNativeListingOriginal(t, in))
	if e != nil {
		t.Fatal(e)
	}
	p = result
	input := orderInput(st, p, "original-native-order-price")
	input.Items[0].Quantity = 2
	order, e := s.CreateOrder(buyer, input)
	if e != nil {
		t.Fatal(e)
	}
	return s, owner, buyer, st, p, order
}
func mustNativeListingOriginal(t *testing.T, in NativeListingInput) PublishListingInput {
	t.Helper()
	v, e := nativeListingOriginal(in)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func TestNativePriceSellerMutationsCheckoutFrozenColdProducer(t *testing.T) {
	s, owner, buyer, st, p, o := nativePriceOrderFixture(t)
	if o.TotalYNXT != 50 || o.NativePrice == nil || o.NativePrice.Price.AmountAtoms != "22" || len(o.Lines) != 1 || o.Lines[0].NativePrice.AmountAtoms != "7" {
		t.Fatal("legacy price was converted or native quote missing", o)
	}
	if o.NativePrice.Price.PriceApprovalRef == "" || o.NativePrice.ChargesApprovalRef != st.NativeChargesApprovalRef || !strings.Contains(o.Lines[0].NativePrice.ApprovalRef, p.ID) {
		t.Fatal("missing existing mutation/version references")
	}
	bill, _ := nativeInvoiceBillDATA(o)
	selection := ShopNativeInvoiceSelectionDATA{Order: o, WalletAccount: buyer, FrozenBill: bill}
	before, _ := os.ReadFile(s.path)
	price, e := s.ReadOriginalShopInvoiceDATA(context.Background(), selection)
	if e != nil || price.AmountAtoms != "22" {
		t.Fatal(price, e)
	}
	after, _ := os.ReadFile(s.path)
	if !bytes.Equal(before, after) {
		t.Fatal("price producer wrote state")
	}
	// Today's approved price/profile changes never replace the checkout snapshot.
	current := s.s.Products[p.ID]
	in := nativeListingInputFor(current)
	in.IdempotencyKey = "later-native-seller-price"
	in.Variants[0].NativePrice = &NativePriceDATA{Genesis: strings.Repeat("ab", 32), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1", AmountAtoms: "999"}
	if _, e = s.PublishListing(owner, p.ID, mustNativeListingOriginal(t, in)); e != nil {
		t.Fatal(e)
	}
	next := s.s.Stores[st.ID]
	if _, e = s.UpdateOriginalStoreProfile(owner, st.ID, NativeStoreProfileInput{Expected: next, Update: StoreUpdate{Name: next.Name, Policy: next.Policy, SettlementAccount: owner, NativeCharges: &NativeChargesDATA{Genesis: strings.Repeat("ab", 32), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1", ShippingAtoms: "0", TaxAtoms: "0"}}, IdempotencyKey: "later-native-profile-price"}); e != nil {
		t.Fatal(e)
	}
	cold, e := Open(s.path)
	if e != nil {
		t.Fatal(e)
	}
	again, e := cold.ReadOriginalShopInvoiceDATA(context.Background(), selection)
	if e != nil || again != price {
		t.Fatal("cold reader repriced original order", again, e)
	}
	foreign := selection
	foreign.WalletAccount = owner
	if _, e = cold.ReadOriginalShopInvoiceDATA(context.Background(), foreign); !errors.Is(e, ErrUnauthorized) {
		t.Fatal("foreign buyer read price", e)
	}
	changed := selection
	changed.FrozenBill = append(bytes.Clone(bill), ' ')
	if _, e = cold.ReadOriginalShopInvoiceDATA(context.Background(), changed); !errors.Is(e, ErrConflict) {
		t.Fatal("changed exact bill read", e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = cold.ReadOriginalShopInvoiceDATA(ctx, selection); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	// Returned copies cannot mutate the Store or original pricing history.
	copy, _ := cold.Order(buyer, "buyer", o.ID)
	copy.NativePrice.Price.AmountAtoms = "1"
	copy.Lines[0].NativePrice.AmountAtoms = "1"
	again, e = cold.ReadOriginalShopInvoiceDATA(context.Background(), selection)
	if e != nil || again != price {
		t.Fatal("caller alias mutated original quote", e)
	}
}
func TestNativePriceMissingConfigurationNeverConvertsLegacy(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 133)
	_, buyer := actor(t, 134)
	st, p := setupCatalog(t, s, owner, 4)
	o, e := s.CreateOrder(buyer, orderInput(st, p, "legacy-only-original-order"))
	if e != nil || o.NativePrice != nil {
		t.Fatal(o, e)
	}
	bill, _ := nativeInvoiceBillDATA(o)
	if _, e = s.ReadOriginalShopInvoiceDATA(context.Background(), ShopNativeInvoiceSelectionDATA{o, buyer, bill}); !errors.Is(e, ErrUnavailable) {
		t.Fatal("legacy amounts manufactured native approval", e)
	}
	if bytes.Contains(bill, []byte(`"NativePrice"`)) {
		t.Fatal("old frozen bill representation changed")
	}
}
func TestNativePriceInputAndUnsignedOverflowRefuseWithoutReplacingPrice(t *testing.T) {
	s, owner, _, _, p, o := nativePriceOrderFixture(t)
	for _, amount := range []string{"0", "01", "-1", "1.0", "18446744073709551616"} {
		current := s.s.Products[p.ID]
		in := nativeListingInputFor(current)
		in.IdempotencyKey = "bad-native-price-" + strconv.Itoa(len(amount)) + amount
		in.Variants[0].NativePrice = &NativePriceDATA{Genesis: strings.Repeat("ab", 32), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1", AmountAtoms: amount}
		before, _ := json.Marshal(s.s)
		if _, e := s.PublishListing(owner, p.ID, mustNativeListingOriginal(t, in)); e == nil {
			t.Fatal("bad native quote accepted", amount)
		}
		after, _ := json.Marshal(s.s)
		if !bytes.Equal(before, after) {
			t.Fatal("bad native quote mutated original", amount)
		}
	}
	copy := cloneOrder(o)
	copy.Lines[0].NativePrice.AmountAtoms = "18446744073709551615"
	if _, e := computeNativeOrderPrice(copy, copy.NativePrice.Charges, copy.NativePrice.ChargesApprovalRef, copy.NativePrice.OrderMutationHash, copy.NativePrice.Price.Merchant, copy.NativePrice.Price.Recipient); !errors.Is(e, ErrConflict) {
		t.Fatal("native multiplication overflow accepted", e)
	}
	snapshot, e := cloneSnapshot(s.s)
	if e != nil {
		t.Fatal(e)
	}
	v := snapshot.Orders[o.ID]
	v.NativePrice.Price.Recipient = "0x" + strings.Repeat("f", 40)
	snapshot.Orders[o.ID] = v
	if e = validateNativeOrderPrices(snapshot); e == nil {
		t.Fatal("frozen merchant/payout mutation accepted")
	}
}

func TestNativePriceNormalV2FirstInvoiceUsesSameFrozenProducer(t *testing.T) {
	s, owner, buyer, st, p, o := nativePriceOrderFixture(t)
	var requests []NativeShopInvoiceRequestDATA
	pay := nativeIntentObservationClient(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v5/pay/invoice-intents" && r.URL.Path != "/v5/pay/invoice-intents/lookup" {
			t.Fatal("unexpected effect", r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		var in NativeShopInvoiceRequestDATA
		if json.Unmarshal(raw, &in) != nil {
			t.Fatal("bad original request")
		}
		requests = append(requests, in)
		reply := strings.Replace(publicNativeInvoiceResponse(in), `"payer":"`+in.Merchant+`"`, `"payer":"`+buyer+`"`, 1)
		return nativeShopPayResponse(200, reply), nil
	})
	cfg := ServerConfig{NativeInvoiceOnly: true, NativePay: pay, NativeInvoiceDATA: s, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}}
	server := NewServer(s, cfg)
	route := "/api/orders/" + o.ID + "/native-pay-intent"
	body := `{"IdempotencyKey":"native-price-original-invoice"}`
	if w := businessHTTPRequest(server, "POST", route, "", body); w.Code != 401 {
		t.Fatal("missing original proof accepted", w.Code)
	}
	w := businessHTTPRequest(server, "POST", route, strings.Repeat("a", 43), body)
	if w.Code != 200 && w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	if len(requests) != 1 || requests[0].AmountAtoms != "22" || requests[0].SourceOrder != o.ID || requests[0].StoreID != st.ID {
		t.Fatal(requests)
	}
	captured, e := s.ReadOriginalShopNativeInvoiceRequestDATA(buyer, "buyer", o.ID)
	if e != nil || !bytes.Equal(captured.DomainData, requests[0].DomainData) {
		t.Fatal(captured, e)
	}
	// First invoice was saved. Removing the producer cannot cause reprice/recreate.
	cfg.NativeInvoiceDATA = nil
	server = NewServer(s, cfg)
	w = businessHTTPRequest(server, "POST", route+"-lookup", strings.Repeat("b", 43), body)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if len(requests) != 2 || requestHash(requests[0]) != requestHash(requests[1]) {
		t.Fatal("recovery changed original price/request")
	}
	// Seller-only native price writes still use original Store permissions.
	listing := nativeListingInputFor(s.s.Products[p.ID])
	listing.IdempotencyKey = "forbidden-buyer-native-price"
	listing.Variants[0].NativePrice = &NativePriceDATA{Genesis: strings.Repeat("ab", 32), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1", AmountAtoms: "9"}
	raw, _ := json.Marshal(listing)
	if w = businessHTTPRequest(server, "POST", "/api/seller/products/"+p.ID+"/native-listing", strings.Repeat("c", 43), string(raw)); w.Code != 403 {
		t.Fatal("Buyer grant edited native price", w.Code, w.Body.String())
	}
	_ = owner
}

func TestNativePriceRevokedCurrentAfterActualReadCannotCreateInvoice(t *testing.T) {
	s, _, buyer, _, _, o := nativePriceOrderFixture(t)
	retired := false
	calls := 0
	pay := nativeIntentObservationClient(t, func(*http.Request) (*http.Response, error) { calls++; return nil, ErrUnavailable })
	cfg := ServerConfig{NativeInvoiceOnly: true, NativePay: pay, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer", fence: func() error {
		if retired {
			return ErrUnauthorized
		}
		return nil
	}}, NativeInvoiceDATA: nativeInvoiceDATAFixture(func(ctx context.Context, selection ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error) {
		v, e := s.ReadOriginalShopInvoiceDATA(ctx, selection)
		retired = true
		return v, e
	})}
	before := transitionDomainSnapshot(t, s)
	w := businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+o.ID+"/native-pay-intent", strings.Repeat("a", 43), `{"IdempotencyKey":"retired-original-native-price"}`)
	if w.Code != 403 || calls != 0 || len(s.s.BusinessEffects) != 0 || len(s.s.BusinessNonces) != 0 {
		t.Fatal("retired price context dispatched", w.Code, w.Body.String(), calls)
	}
	if after := transitionDomainSnapshot(t, s); !bytes.Equal(before, after) {
		t.Fatal("retired price context changed order, stock or originals")
	}
}
func TestNativePriceNormalSellerHTTPOrderDATA(t *testing.T) {
	s, owner, buyer, st, p, _ := nativePriceOrderFixture(t)
	seller := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}})
	listing := nativeListingInputFor(s.s.Products[p.ID])
	listing.IdempotencyKey = "actual-route-native-price"
	listing.Variants[0].NativePrice = &NativePriceDATA{Genesis: strings.Repeat("ab", 32), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1", AmountAtoms: "9"}
	body, _ := json.Marshal(listing)
	if w := businessHTTPRequest(seller, "POST", "/api/seller/products/"+p.ID+"/native-listing", strings.Repeat("a", 43), string(body)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	profile := s.s.Stores[st.ID]
	profileInput := NativeStoreProfileInput{Expected: profile, Update: StoreUpdate{Name: profile.Name, Description: profile.Description, Policy: profile.Policy, TrustURL: profile.TrustURL, SettlementAccount: owner, NativeCharges: &NativeChargesDATA{Genesis: strings.Repeat("ab", 32), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1", ShippingAtoms: "0", TaxAtoms: "0"}}, IdempotencyKey: "actual-route-native-charges"}
	body, _ = json.Marshal(profileInput)
	if w := businessHTTPRequest(seller, "POST", "/api/seller/stores/"+st.ID+"/native-profile", strings.Repeat("b", 43), string(body)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	private := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}})
	input := orderInput(st, s.s.Products[p.ID], "actual-route-native-order")
	body, _ = json.Marshal(input)
	w := businessHTTPRequest(private, "POST", "/api/orders", strings.Repeat("c", 43), string(body))
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var order Order
	if e := json.Unmarshal(w.Body.Bytes(), &order); e != nil {
		t.Fatal(e)
	}
	if order.NativePrice == nil || order.NativePrice.Price.AmountAtoms != "9" || order.TotalYNXT != 25 {
		t.Fatal("normal checkout mixed native/legacy units", order)
	}
	bill, _ := nativeInvoiceBillDATA(order)
	price, e := s.ReadOriginalShopInvoiceDATA(context.Background(), ShopNativeInvoiceSelectionDATA{order, buyer, bill})
	if e != nil {
		t.Fatal(e)
	}
	request, e := nativeInvoiceRequestDATA(order, price)
	if e != nil || request.AmountAtoms != "9" || request.SourceOrder != order.ID || request.ProductID != "shop.order" || request.StoreID != st.ID {
		t.Fatal(request, e)
	}
	if dest := os.Getenv("P07_PUBLIC_NATIVE_PRICE_ORDER_FIXTURE"); dest != "" {
		raw, _ := json.MarshalIndent(order, "", "  ")
		f, e := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = f.Write(append(raw, '\n')); e != nil {
			t.Fatal(e)
		}
		if e = f.Close(); e != nil {
			t.Fatal(e)
		}
	}
}
