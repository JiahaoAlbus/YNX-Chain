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
	"reflect"
	"strings"
	"testing"
)

type nativeInvoiceDATAFixture func(context.Context, ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error)

func (f nativeInvoiceDATAFixture) ReadOriginalShopInvoiceDATA(c context.Context, s ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error) {
	return f(c, s)
}
func publicNativePriceDATA() ShopNativeInvoicePriceDATA {
	return ShopNativeInvoicePriceDATA{Merchant: "0x" + strings.Repeat("3", 40), Recipient: "0x" + strings.Repeat("4", 40), Genesis: strings.Repeat("ab", 32), NativeChainID: "6423", AssetID: "YNXT", UnitVersion: "1", AmountAtoms: "18446744073709551615", PriceApprovalRef: "PUBLIC-original-approved-price"}
}
func publicNativeInvoiceResponse(request NativeShopInvoiceRequestDATA) string {
	raw, _ := json.Marshal(map[string]any{"intentId": "npi_" + strings.Repeat("ab", 24), "originalOperation": "npi_" + strings.Repeat("ab", 24), "request": request, "merchant": request.Merchant, "state": "PREPARED", "phase": "awaiting_merchant_approval", "terms": map[string]string{"invoiceId": "core_original", "sessionId": "core_original_session", "recipient": request.Recipient, "payer": request.Merchant, "assetId": request.AssetID, "unitVersion": request.UnitVersion, "amountAtoms": request.AmountAtoms, "feeRule": "native-transfer-fee-one/v1", "maxFeeAtoms": "1", "keyEpoch": "1", "revision": "1", "expiresAtHeight": "100"}})
	return string(raw)
}

func TestNativeInvoiceCreateOriginalThenColdLookupWithoutRepriceOrResend(t *testing.T) {
	s, buyer, order := effectOrderFixture(t, filepath.Join(t.TempDir(), "state.json"))
	beforeStock := s.s.Products
	quotes := 0
	creates := 0
	lookups := 0
	lost := true
	var originalRequest []byte
	provider := nativeInvoiceDATAFixture(func(_ context.Context, selected ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error) {
		quotes++
		if selected.Order.ID != order.ID || selected.WalletAccount != buyer {
			t.Fatal("wrong selected checkout")
		}
		selected.Order.Lines[0].Title = "mutated PUBLIC callback copy"
		selected.FrozenBill[0] = '!'
		return publicNativePriceDATA(), nil
	})
	client := nativeIntentObservationClient(t, func(r *http.Request) (*http.Response, error) {
		raw, _ := io.ReadAll(r.Body)
		var selected NativeShopInvoiceRequestDATA
		if json.Unmarshal(raw, &selected) != nil {
			t.Fatal("bad original request")
		}
		switch r.URL.Path {
		case "/v5/pay/invoice-intents":
			creates++
			originalRequest = bytes.Clone(raw)
			if lost {
				return nil, errors.New("PUBLIC lost prepared response")
			}
		case "/v5/pay/invoice-intents/lookup":
			lookups++
			if !bytes.Equal(raw, originalRequest) {
				t.Fatal("cold recovery reconstructed or repriced original bill")
			}
		default:
			t.Fatal("unexpected dispatch", r.Method, r.URL.Path)
		}
		return nativeShopPayResponse(200, publicNativeInvoiceResponse(selected)), nil
	})
	cfg := ServerConfig{NativeInvoiceOnly: true, NativePay: client, NativeInvoiceDATA: provider, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}}
	path := "/api/orders/" + order.ID + "/native-pay-intent"
	body := `{"IdempotencyKey":"original-native-intent"}`
	w := businessHTTPRequest(NewServer(s, cfg), "POST", path, strings.Repeat("a", 43), body)
	if w.Code != 409 || creates != 1 || quotes != 1 || hasInvoiceBinding(s.s.Orders[order.ID]) {
		t.Fatal(w.Code, w.Body.String(), creates, quotes)
	}
	reopened, e := Open(s.path)
	if e != nil {
		t.Fatal(e)
	}
	// A fresh create click cannot turn lost acknowledgement into another POST.
	w = businessHTTPRequest(NewServer(reopened, cfg), "POST", path, strings.Repeat("b", 43), body)
	if w.Code != 409 || creates != 1 || quotes != 1 {
		t.Fatal("unknown replay or reprice", w.Code, creates, quotes)
	}
	lost = false
	cfg.NativeInvoiceDATA = nil
	w = businessHTTPRequest(NewServer(reopened, cfg), "POST", path+"-lookup", strings.Repeat("c", 43), body)
	if w.Code != 200 || creates != 1 || lookups != 1 || quotes != 1 || !bytes.Contains(w.Body.Bytes(), []byte(`"queryOnly":true`)) || bytes.Contains(w.Body.Bytes(), []byte("deepLink")) {
		t.Fatal(w.Code, w.Body.String(), creates, lookups, quotes)
	}
	got := reopened.s.Orders[order.ID]
	if got.PayIntentID != "npi_"+strings.Repeat("ab", 24) || got.InvoiceID != "core_original" || got.Status != "payment_pending" || got.Settlement != nil || !reflect.DeepEqual(beforeStock, reopened.s.Products) {
		t.Fatal("reference recovery changed funds or inventory")
	}
	for _, r := range reopened.s.BusinessEffects {
		if r.Kind == "pay.native-create" && (r.Phase != "completed" || len(r.Steps) != 1 || r.Steps[0].Phase != "unknown") {
			t.Fatal("original first-cause dispatch evidence discarded")
		}
	}
	if _, e := Open(s.path); e != nil {
		t.Fatal("new read-only lookup journal is not cold-readable", e)
	}
	// Main's Source-owned product DATA port reads the captured payload. It does
	// not grant Source and cannot expose another buyer's original request.
	data, e := reopened.ReadOriginalShopNativeInvoiceRequestDATA(buyer, "buyer", order.ID)
	if e != nil {
		t.Fatal(e)
	}
	encoded, _ := json.Marshal(data)
	if !bytes.Equal(encoded, originalRequest) {
		t.Fatal("Source DATA reader rebuilt original")
	}
	data.DomainData[0] = '!'
	again, e := reopened.ReadOriginalShopNativeInvoiceRequestDATA(buyer, "buyer", order.ID)
	if e != nil || again.DomainData[0] == '!' {
		t.Fatal("Source DATA aliases durable original")
	}
	_, foreign := actor(t, 245)
	if _, e := reopened.ReadOriginalShopNativeInvoiceRequestDATA(foreign, "buyer", order.ID); e == nil {
		t.Fatal("foreign Source DATA read")
	}
}

func TestNativeInvoiceCreateAndLookupBindOnlyExactOriginalBill(t *testing.T) {
	for _, mode := range []string{"success", "wrong-price", "wrong-terms", "source-denied", "late-cancel", "legacy-unresolved", "source-reader-missing"} {
		t.Run(mode, func(t *testing.T) {
			s, buyer, order := effectOrderFixture(t, filepath.Join(t.TempDir(), "state.json"))
			quotes := 0
			calls := 0
			provider := nativeInvoiceDATAFixture(func(_ context.Context, _ ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error) {
				quotes++
				return publicNativePriceDATA(), nil
			})
			client := nativeIntentObservationClient(t, func(r *http.Request) (*http.Response, error) {
				calls++
				raw, _ := io.ReadAll(r.Body)
				var request NativeShopInvoiceRequestDATA
				json.Unmarshal(raw, &request)
				if mode == "source-denied" {
					return nativeShopPayResponse(503, `{"code":"NATIVE_PAY_AUTHORITY_UNAVAILABLE"}`), nil
				}
				if mode == "wrong-price" {
					request.AmountAtoms = "1"
				}
				if mode == "late-cancel" {
					if _, e := s.transition(buyer, "buyer", order.ID, "cancelled", nil, nil, nil); e != nil {
						t.Fatal(e)
					}
				}
				reply := publicNativeInvoiceResponse(request)
				if mode == "wrong-terms" {
					var view map[string]any
					json.Unmarshal([]byte(reply), &view)
					view["terms"].(map[string]any)["amountAtoms"] = "1"
					encoded, _ := json.Marshal(view)
					reply = string(encoded)
				}
				return nativeShopPayResponse(202, reply), nil
			})
			cfg := ServerConfig{NativePay: client, NativeInvoiceDATA: provider, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}}
			if mode == "source-reader-missing" {
				cfg.NativeInvoiceDATA = nil
			}
			if mode == "legacy-unresolved" {
				id := effectDigest("PUBLIC-old-original")
				s.s.BusinessEffects[id] = BusinessEffect{ID: id, Kind: "pay.invoice", Target: order.ID, Actor: buyer, Role: "buyer", Phase: "unknown", RequestHash: effectDigest("PUBLIC-request"), Admission: effectDigest("PUBLIC-admission"), Input: json.RawMessage(`{}`)}
			}
			w := businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+order.ID+"/native-pay-intent", strings.Repeat("d", 43), `{"IdempotencyKey":"new-native-prepare"}`)
			if mode == "success" {
				if w.Code != 200 || !hasInvoiceBinding(s.s.Orders[order.ID]) || !bytes.Contains(w.Body.Bytes(), []byte(`"fundsVerified":false`)) {
					t.Fatal(w.Code, w.Body.String())
				}
			} else if w.Code < 400 || hasInvoiceBinding(s.s.Orders[order.ID]) {
				t.Fatal("unqualified or late result attached", mode, w.Code, w.Body.String())
			}
			if (mode == "source-reader-missing" || mode == "legacy-unresolved") && (calls != 0 || quotes != 0 || len(s.s.BusinessNonces) != 0) {
				t.Fatal("missing source/old UNKNOWN admitted or sent", calls, quotes)
			}
		})
	}
}

func TestNativeInvoiceLookupWhitelistCannotBecomePostMutation(t *testing.T) {
	if !readBusinessEffectStep("pay.native-lookup", "POST", "/v5/pay/invoice-intents/lookup") || readBusinessEffectStep("pay.native-lookup", "POST", "/v5/pay/invoice-intents") || readBusinessEffectStep("pay.native-intent", "POST", "/v5/pay/invoice-intents/lookup") {
		t.Fatal("read-only effect endpoint whitelist widened")
	}
}

func TestNativeInvoicePrivacyDeletionRetainsCancelledOriginalAndUnknown(t *testing.T) {
	for _, mode := range []string{"prepared", "lost-then-lookup", "restored-reference", "unattempted"} {
		t.Run(mode, func(t *testing.T) {
			s, buyer, order := effectOrderFixture(t, filepath.Join(t.TempDir(), "state.json"))
			calls := 0
			client := nativeIntentObservationClient(t, func(r *http.Request) (*http.Response, error) {
				calls++
				if mode == "lost-then-lookup" && calls == 1 {
					return nil, errors.New("PUBLIC original response lost")
				}
				var request NativeShopInvoiceRequestDATA
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Fatal(err)
				}
				return nativeShopPayResponse(200, publicNativeInvoiceResponse(request)), nil
			})
			if mode == "restored-reference" {
				if _, err := s.BindInvoice(buyer, order.ID, PayInvoiceHandoff{InvoiceID: "core_original", IntentID: "npi_" + strings.Repeat("ab", 24), Merchant: publicNativePriceDATA().Merchant, PayoutAddress: publicNativePriceDATA().Recipient}); err != nil {
					t.Fatal(err)
				}
			} else if mode != "unattempted" {
				cfg := ServerConfig{NativeInvoiceOnly: true, NativePay: client, NativeInvoiceDATA: nativeInvoiceDATAFixture(func(context.Context, ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error) {
					return publicNativePriceDATA(), nil
				}), businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}}
				path := "/api/orders/" + order.ID + "/native-pay-intent"
				body := `{"IdempotencyKey":"privacy-original-native"}`
				w := businessHTTPRequest(NewServer(s, cfg), "POST", path, strings.Repeat("a", 43), body)
				if mode == "lost-then-lookup" {
					if w.Code != 409 {
						t.Fatal(w.Code, w.Body.String())
					}
					w = businessHTTPRequest(NewServer(s, cfg), "POST", path+"-lookup", strings.Repeat("b", 43), body)
				}
				if w.Code != 200 {
					t.Fatal(w.Code, w.Body.String())
				}
			}
			if _, err := s.transition(buyer, "buyer", order.ID, "cancelled", nil, nil, nil, "privacy-native-cancel"); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(s.path)
			if err != nil {
				t.Fatal(err)
			}
			beforeMemory, err := cloneSnapshot(s.s)
			if err != nil {
				t.Fatal(err)
			}
			_, err = s.DeleteBuyerDataRequest(buyer, "privacy-native-request", nil)
			if mode == "unattempted" {
				if err != nil || calls != 0 {
					t.Fatal("unattempted order cannot delete", err, calls)
				}
				return
			}
			if !errors.Is(err, ErrInvalidState) {
				t.Fatal("cancelled Shop order erased a still-live Native intent", err)
			}
			if !reflect.DeepEqual(beforeMemory, s.s) {
				t.Fatal("rejected deletion altered original in-memory state")
			}
			after, err := os.ReadFile(s.path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("rejected deletion altered original journal", err)
			}
			reopened, err := Open(s.path)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "restored-reference" {
				if reopened.s.Orders[order.ID].PayIntentID != "npi_"+strings.Repeat("ab", 24) || calls != 0 {
					t.Fatal("restored reference erased or dispatched")
				}
			} else if _, err := reopened.ReadOriginalShopNativeInvoiceRequestDATA(buyer, "buyer", order.ID); err != nil {
				t.Fatal("original is no longer recoverable", err)
			}
			if mode == "lost-then-lookup" {
				found := false
				for _, effect := range reopened.s.BusinessEffects {
					if effect.Kind == "pay.native-create" {
						found = effect.Phase == "completed" && len(effect.Steps) == 1 && effect.Steps[0].Phase == "unknown"
					}
				}
				if !found {
					t.Fatal("original UNKNOWN first cause missing")
				}
			}
		})
	}
}
