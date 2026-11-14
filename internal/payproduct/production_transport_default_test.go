//go:build !pay_securelink

package payproduct

import (
	"strings"
	"testing"
)

func TestProductionPayTransportNeverFallsBack(t *testing.T) {
	for _, base := range []string{"http://127.0.0.1:1", "https://unqualified.invalid"} {
		client, err := NewProductionHTTPPayAPI(base, "synthetic-key", "")
		if client != nil || err == nil || !strings.Contains(err.Error(), "transport unavailable") {
			t.Fatal("production caller substituted ordinary transport")
		}
	}
}
