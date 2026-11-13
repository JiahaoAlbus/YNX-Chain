//go:build (linux || darwin) && securelink_openssl && cgo && securelink_public_server_tls_test

package securelink_test

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

// External-package compilation is deliberate: consumer tests cannot see the
// private borrow/constructor and do not import or replace Auth's Source owner.
func TestOriginalServerTLSPUBLICConsumerFixture(t *testing.T) {
	f := securelink.NewPUBLICOriginalServerTLSFixture(t)
	owner := f.OriginalServerTLS()
	identity, err := owner.Identity(context.Background())
	if err != nil || identity.SourceID != "PUBLIC_SOURCE" || identity.TargetOrigin != "https://public-cloud.example" || identity.Signature != "mldsa87" {
		t.Fatalf("fixed actual PUBLIC identity: %v %+v", err, identity)
	}
	requestLoan := f.BeginOriginalGET(t, "PUBLIC-carrier-DATA-not-a-proof")
	r := requestLoan.OriginalRequest()
	if r == nil || owner.CurrentOriginalRequest(r) != nil || r.Context().Err() != nil {
		t.Fatal("actual same listener/handler request unavailable")
	}
	if owner.CurrentOriginalRequest(r.Clone(r.Context())) == nil || owner.CurrentOriginalRequest(httptest.NewRequest("GET", identity.TargetOrigin+r.RequestURI, nil)) == nil {
		t.Fatal("PUBLIC fixture exported a request-brand constructor")
	}
	if err := requestLoan.Close(); err != nil {
		t.Fatal(err)
	}
	if owner.CurrentOriginalRequest(r) == nil {
		t.Fatal("completed handler request remained current")
	}
	owner.Retire()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := owner.Join(ctx); err != nil {
		t.Fatal(err)
	}
	if err := owner.Close(); err != nil || !owner.Lifetime().PhysicalComplete || owner.Lifetime().BorrowHeld {
		t.Fatalf("PUBLIC fixture actual context/borrow drain: %v %+v", err, owner.Lifetime())
	}
}
