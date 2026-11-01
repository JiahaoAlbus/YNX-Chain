package commerce

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestNativeShopPayOriginalArchiveOnlyGetExactOriginalAndNoAuthority(t *testing.T) {
	merchant, invoice, hash := "0x"+strings.Repeat("a", 40), "original_invoice", "0x"+strings.Repeat("b", 64)
	calls, checks := 0, 0
	raw := `{"version":"ynx.pay.native.originals/v1","authority":"untrusted-public-DATA","verified":{"finalized":true,"nativeGrant":false}}`
	c := nativeIntentObservationClient(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != "GET" || r.URL.Path != "/v5/pay/invoices/"+merchant+"/"+invoice+"/originals/"+hash || r.URL.RawQuery != "" || r.GetBody != nil || r.ContentLength != 0 {
			t.Fatal("archive read changed into another operation", r.Method, r.URL)
		}
		return nativeShopPayResponse(200, raw), nil
	})
	out, err := c.ReadOriginalArchiveDATA(t.Context(), merchant, invoice, hash, func() error { checks++; return nil })
	if err != nil || out.Uncertain || out.Method != "GET" || out.Status != 200 || string(out.Response) != raw || len(out.Request) != 0 || calls != 1 || checks != 2 {
		t.Fatal(out.Status, err, calls, checks)
	}
	// Deliberately untrusted JSON is opaque DATA, never a financial proof. This
	// client has no Store or receipt-claim method and cannot apply finalized.
	for _, bad := range []string{"0x" + strings.Repeat("B", 64), strings.Repeat("b", 64), hash + "?alias=1"} {
		if _, err := c.ReadOriginalArchiveDATA(t.Context(), merchant, invoice, bad, func() error { return nil }); err == nil {
			t.Fatal("non-original hash accepted")
		}
	}
	if calls != 1 {
		t.Fatal("invalid original reached transport", calls)
	}
}

func TestNativeShopPayOriginalArchivePreservesMissingAndLateOriginal(t *testing.T) {
	merchant, invoice, hash := "0x"+strings.Repeat("a", 40), "original_invoice", "0x"+strings.Repeat("b", 64)
	calls, checks := 0, 0
	late := errors.New("PUBLIC_ORIGINAL_CURRENT_REVOKED")
	c := nativeIntentObservationClient(t, func(*http.Request) (*http.Response, error) {
		calls++
		return nativeShopPayResponse(409, `{"code":"NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE"}`), nil
	})
	out, err := c.ReadOriginalArchiveDATA(t.Context(), merchant, invoice, hash, func() error { return nil })
	if !errors.Is(err, ErrNativeShopPayOriginalArchiveUnavailable) || out.Status != 409 || len(out.Response) == 0 || calls != 1 {
		t.Fatal("old missing archive replaced", out.Status, err, calls)
	}
	c = nativeIntentObservationClient(t, func(*http.Request) (*http.Response, error) {
		calls++
		return nativeShopPayResponse(200, `{"original":"retained-public-bytes"}`), nil
	})
	out, err = c.ReadOriginalArchiveDATA(t.Context(), merchant, invoice, hash, func() error {
		checks++
		if checks > 1 {
			return late
		}
		return nil
	})
	if !errors.Is(err, late) || !bytes.Equal(out.Response, []byte(`{"original":"retained-public-bytes"}`)) || out.Uncertain || calls != 2 {
		t.Fatal("late failure discarded or replayed original", err, calls)
	}
	if _, err = c.ReadOriginalArchiveDATA(t.Context(), merchant, invoice, hash, func() error { return late }); !errors.Is(err, late) || calls != 2 {
		t.Fatal("revoked read reached transport", err, calls)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err = c.ReadOriginalArchiveDATA(ctx, merchant, invoice, hash, func() error { return nil }); !errors.Is(err, context.Canceled) || calls != 2 {
		t.Fatal("canceled read reached transport", err, calls)
	}
}

func TestNativeShopPayOriginalArchiveBoundDoesNotWidenOtherResponses(t *testing.T) {
	merchant, invoice, hash := "0x"+strings.Repeat("a", 40), "original_invoice", "0x"+strings.Repeat("b", 64)
	raw := `{"publicHistoricalProof":"` + strings.Repeat("x", nativePayProductLimit+1024) + `"}`
	c := nativeIntentObservationClient(t, func(*http.Request) (*http.Response, error) { return nativeShopPayResponse(200, raw), nil })
	if out, err := c.ReadOriginalArchiveDATA(t.Context(), merchant, invoice, hash, func() error { return nil }); err != nil || string(out.Response) != raw {
		t.Fatal("valid bounded archive kept legacy2MiB limit", err)
	}
	if out, err := c.Read(t.Context(), merchant, invoice); err == nil || len(out.Response) != 0 {
		t.Fatal("archive limit widened ordinary financial DATA read", err)
	}
	reads := 0
	c = nativeIntentObservationClient(t, func(*http.Request) (*http.Response, error) {
		r := nativeShopPayResponse(200, `{}`)
		r.ContentLength = nativePayOriginalArchiveLimit + 1
		r.Body = io.NopCloser(archiveBodyReadCounter{&reads})
		return r, nil
	})
	if _, err := c.ReadOriginalArchiveDATA(t.Context(), merchant, invoice, hash, func() error { return nil }); err == nil || reads != 0 {
		t.Fatal("oversize declared proof read/accepted", err, reads)
	}
}

type archiveBodyReadCounter struct{ reads *int }

func (r archiveBodyReadCounter) Read([]byte) (int, error) { *r.reads++; return 0, io.EOF }
