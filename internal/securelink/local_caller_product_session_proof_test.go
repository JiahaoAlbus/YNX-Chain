package securelink

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestOriginalLocalCallerShopProofV2Carrier(t *testing.T) {
	for _, value := range []string{"Aa", "AZaz09_-", strings.Repeat("A", MaxProductSessionProofV2HeaderBytes)} {
		if err := validateProductSessionProofV2Carrier(value); err != nil {
			t.Fatalf("bounded opaque carrier rejected at length %d: %v", len(value), err)
		}
	}
	for _, value := range []string{"", "A", "AA\rBB", "AA\nBB", "AA\x00BB", "AA\tBB", "AA\x1fBB", "AA\x7fBB", "AA,BB", "AA=", "AA/BB", "AA+BB", " AA", "AA ", "AAé"} {
		if err := validateProductSessionProofV2Carrier(value); !errors.Is(err, ErrDenied) {
			t.Fatalf("unsafe HTTP carrier accepted at length %d", len(value))
		}
	}
	if err := validateProductSessionProofV2Carrier(strings.Repeat("A", MaxProductSessionProofV2HeaderBytes+1)); !errors.Is(err, ErrBounds) {
		t.Fatal("carrier cap+1 was not bounded")
	}
	// Presence is private request binding DATA; absence remains a real state.
	for _, header := range []http.Header{{}, {ProductSessionProofV2Header: {"Aa"}}} {
		original, err := captureLocalCallerProductSessionProofV2(header)
		if err != nil || !original.matches(header) {
			t.Fatal("original header capture", err)
		}
		header["x-ynx-product-session-proof-v2"] = []string{"Bb"}
		if original.matches(header) {
			t.Fatal("post-capture header addition/change or case duplicate accepted")
		}
	}
}
