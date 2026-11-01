//go:build pay_pq

package payproduct

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNativeArchiveFiniteCanonicalWirePaths(t *testing.T) {
	merchant := "0x" + strings.Repeat("a", 40)
	hash := "0x" + strings.Repeat("b", 64)
	base := "/v5/pay/products/shop.order/order%3A001/invoices/" + merchant + "/invoice%3A001"
	for _, path := range []string{base + "/archive-reconciliation", base + "/originals/" + hash + "/receipt", strings.ReplaceAll(base, "%3A", "-") + "/archive-reconciliation", strings.Replace(base, "shop.order", "cloud.ide-usage", 1) + "/archive-reconciliation"} {
		if !IsNativePayOriginalArchiveWireRoute(http.MethodGet, path) {
			t.Fatal("canonical finite read refused", path)
		}
	}
	for _, path := range []string{
		strings.ReplaceAll(base, "%3A", ":"), strings.ReplaceAll(base, "%3A", "%3a"), strings.ReplaceAll(base, "%3A", "%253A"), strings.ReplaceAll(base, "%3A", "%2F"), strings.ReplaceAll(base, "%3A", "%5C"), strings.ReplaceAll(base, "%3A", "%00"), strings.Replace(base, "order%3A001", "..", 1), strings.Replace(base, "shop.order", "wallet.member5", 1), strings.Replace(base, "shop.order", "%73hop.order", 1), strings.Replace(base, merchant, strings.ToUpper(merchant), 1),
	} {
		if IsNativePayOriginalArchiveWireRoute(http.MethodGet, path+"/archive-reconciliation") {
			t.Fatal("archive alias admitted", path)
		}
	}
	for _, path := range []string{base + "/archive-reconciliation?", base + "/archive-reconciliation#x", base + "/archive-reconciliation/", base + "/originals/" + strings.ToUpper(hash) + "/receipt", base + "/originals/" + hash + "/receipt?x=1"} {
		if IsNativePayOriginalArchiveWireRoute(http.MethodGet, path) {
			t.Fatal("non-exact target admitted", path)
		}
	}
	if IsNativePayOriginalArchiveWireRoute(http.MethodPost, base+"/archive-reconciliation") {
		t.Fatal("archive money method admitted")
	}
}

func TestNativeArchiveHandlerRejectsAliasesBeforeSourceCapture(t *testing.T) {
	// Empty service deliberately has no Source. Every invalid wire target must
	// refuse before dereferencing/borrowing one, without ServeMux redirects.
	handler := new(NativeInvoiceIntents).Handler()
	base := "/v5/pay/products/shop.order/order%3A001/invoices/0x" + strings.Repeat("a", 40) + "/invoice%3A001/archive-reconciliation"
	for _, target := range []string{strings.ReplaceAll(base, "%3A", ":"), strings.ReplaceAll(base, "%3A", "%253A"), strings.ReplaceAll(base, "%3A", "%3a"), strings.ReplaceAll(base, "%3A", "%2F"), base + "?", base + "?x=1"} {
		r := httptest.NewRequest(http.MethodGet, target, nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != 409 || w.Header().Get("Location") != "" {
			t.Fatal("alias reached Source or redirected", target, w.Code, w.Body.String())
		}
	}
}
