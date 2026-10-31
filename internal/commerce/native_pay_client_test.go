package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type nativeShopPayTransport func(*http.Request) (*http.Response, error)

func (f nativeShopPayTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func nativeShopPayResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}
}

func TestNativeShopPayOriginalProductContractRoutesAndMoney(t *testing.T) {
	// PUBLIC product-wire fixtures only; not Source, CORE proof or actual funds.
	var paths []string
	client, err := NewOriginalNativeShopPayClient("https://pay.invalid", &http.Client{Transport: nativeShopPayTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "pay.invalid" || r.URL.RawQuery != "" || r.GetBody != nil || r.Header.Get("Accept") != "application/json" {
			t.Fatal("destination or replay semantics changed")
		}
		paths = append(paths, r.Method+" "+r.URL.Path)
		raw, _ := io.ReadAll(r.Body)
		if r.Method == "GET" {
			if len(raw) != 0 {
				t.Fatal("read sent a replacement Member")
			}
		} else if !json.Valid(raw) {
			t.Fatal("product body is not original JSON DATA")
		}
		if r.URL.Path == "/v5/pay/invoice-terms/review" {
			var body struct {
				SourceOrder string             `json:"sourceOrder"`
				Terms       NativeShopPayTerms `json:"terms"`
			}
			if json.Unmarshal(raw, &body) != nil || body.SourceOrder != "order-original" || body.Terms.AmountAtoms != "18446744073709551615" || body.Terms.Payer != "original-payer" {
				t.Fatal("source order/payer/atom precision lost", string(raw))
			}
		}
		if strings.HasSuffix(r.URL.Path, "/refunds") || strings.HasSuffix(r.URL.Path, "/settlements") || r.URL.Path == "/v5/pay/invoices" {
			var body struct{ Member []byte }
			if json.Unmarshal(raw, &body) != nil || !bytes.Equal(body.Member, []byte("PUBLIC-original-Member")) {
				t.Fatal("Member changed")
			}
		}
		return nativeShopPayResponse(202, `{"status":"unknown","nativeHash":"PUBLIC-original"}`), nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	terms := NativeShopPayTerms{Payer: "original-payer", AmountAtoms: "18446744073709551615"}
	member := []byte("PUBLIC-original-Member")
	calls := []func() (NativeShopPayExchange, error){
		func() (NativeShopPayExchange, error) { return client.ReviewTerms(ctx, "order-original", terms) },
		func() (NativeShopPayExchange, error) { return client.RegisterTerms(ctx, "order-original", member) },
		func() (NativeShopPayExchange, error) { return client.Read(ctx, "merchant", "invoice") },
		func() (NativeShopPayExchange, error) { return client.ReviewSettlement(ctx, "merchant", "invoice") },
		func() (NativeShopPayExchange, error) {
			return client.SubmitSettlement(ctx, "merchant", "invoice", member)
		},
		func() (NativeShopPayExchange, error) {
			return client.ReviewRefund(ctx, "merchant", "invoice", "refund-original", "30")
		},
		func() (NativeShopPayExchange, error) { return client.SubmitRefund(ctx, "merchant", "invoice", member) },
		func() (NativeShopPayExchange, error) {
			return client.Reconcile(ctx, "merchant", "invoice", strings.Repeat("a", 64))
		},
	}
	for _, call := range calls {
		out, err := call()
		if err != nil || out.Status != 202 || len(out.Response) == 0 {
			t.Fatal("original product exchange lost", out, err)
		}
	}
	expected := []string{"POST /v5/pay/invoice-terms/review", "POST /v5/pay/invoices", "GET /v5/pay/invoices/merchant/invoice", "POST /v5/pay/invoices/merchant/invoice/review", "POST /v5/pay/invoices/merchant/invoice/settlements", "POST /v5/pay/invoices/merchant/invoice/refund-review", "POST /v5/pay/invoices/merchant/invoice/refunds", "POST /v5/pay/invoices/merchant/invoice/operations/" + strings.Repeat("a", 64) + "/reconcile"}
	if strings.Join(paths, "\n") != strings.Join(expected, "\n") {
		t.Fatal("P06 frozen routes changed", paths)
	}
}

func TestNativeShopPayLostMutationRetainsOriginalAndNeverRetries(t *testing.T) {
	count := 0
	client, _ := NewOriginalNativeShopPayClient("https://pay.invalid", &http.Client{Transport: nativeShopPayTransport(func(r *http.Request) (*http.Response, error) {
		count++
		return nil, errors.New("PUBLIC response lost after original Member dispatch")
	})})
	out, err := client.SubmitRefund(context.Background(), "merchant", "invoice", []byte("PUBLIC-original-Member"))
	var original struct{ Member []byte }
	if err == nil || count != 1 || !out.Uncertain || json.Unmarshal(out.Request, &original) != nil || string(original.Member) != "PUBLIC-original-Member" || !strings.HasSuffix(out.Path, "/refunds") {
		t.Fatal("UNKNOWN lost original request or retried", out, err, count)
	}
}

func TestNativeShopPayRejectsRedirectAndRetainsUnusableResponse(t *testing.T) {
	for _, fault := range []string{"redirect", "invalid-json", "wrong-media", "too-large", "http-reject"} {
		t.Run(fault, func(t *testing.T) {
			count := 0
			client, _ := NewOriginalNativeShopPayClient("https://pay.invalid", &http.Client{Transport: nativeShopPayTransport(func(r *http.Request) (*http.Response, error) {
				count++
				resp := nativeShopPayResponse(202, `{}`)
				switch fault {
				case "redirect":
					resp.StatusCode = 307
					resp.Header.Set("Location", "https://other.invalid/v5/pay/invoices")
				case "invalid-json":
					resp.Body = io.NopCloser(strings.NewReader(`{"incomplete":`))
				case "wrong-media":
					resp.Header.Set("Content-Type", "text/html")
				case "too-large":
					resp.Body = io.NopCloser(strings.NewReader(strings.Repeat(" ", nativePayProductLimit+1)))
				case "http-reject":
					resp.StatusCode = 403
				}
				return resp, nil
			})})
			out, err := client.RegisterTerms(context.Background(), "order-original", []byte("PUBLIC-Member"))
			if err == nil || count != 1 || !out.Uncertain || len(out.Request) == 0 || (fault != "too-large" && len(out.Response) == 0) {
				t.Fatal("failed mutation was replayed or interpreted as success", fault, count, out, err)
			}
		})
	}
}

func TestNativeShopPayMissingTransportAndAlternateLocatorsFailBeforeDispatch(t *testing.T) {
	if _, err := NewOriginalNativeShopPayClient("https://pay.invalid", &http.Client{}); err == nil {
		t.Fatal("default unqualified transport accepted")
	}
	count := 0
	original := &http.Client{Transport: nativeShopPayTransport(func(*http.Request) (*http.Response, error) {
		count++
		return nativeShopPayResponse(200, `{}`), nil
	})}
	for _, origin := range []string{"http://pay.invalid", "https://user@pay.invalid", "https://pay.invalid/", "https://pay.invalid?a=b", "https://pay.invalid/#fragment"} {
		if _, err := NewOriginalNativeShopPayClient(origin, original); err == nil {
			t.Fatal("alternate origin accepted", origin)
		}
	}
	client, _ := NewOriginalNativeShopPayClient("https://pay.invalid", original)
	ctx := context.Background()
	for _, id := range []string{"", "../other", "%2f", "invoice?role=owner", "..", "invoice#other"} {
		if _, err := client.Read(ctx, "merchant", id); err == nil {
			t.Fatal("alternate invoice accepted", id)
		}
	}
	for _, amount := range []string{"0", "01", "-1", "1.0", "18446744073709551616"} {
		if _, err := client.ReviewRefund(ctx, "merchant", "invoice", "refund", amount); err == nil {
			t.Fatal("noncanonical amount accepted", amount)
		}
	}
	if _, err := client.Reconcile(ctx, "merchant", "invoice", strings.Repeat("A", 64)); err == nil {
		t.Fatal("alternate original hash accepted")
	}
	if count != 0 {
		t.Fatal("invalid product data reached transport", count)
	}
}
