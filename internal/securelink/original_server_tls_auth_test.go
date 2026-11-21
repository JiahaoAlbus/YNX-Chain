//go:build securelink_openssl && cgo && securelink_reviewed_server_tls && (darwin || linux)

package securelink

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/authservertls"
)

// This executes the actual Auth factory. Its independent Source authority
// and credential release sets are empty. Qualification precedes any listener
// or credential acquisition and preserves its original partial failure.
func TestOriginalServerTLSOriginalFactoryEmptyRootCleanup(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	owner, e := OpenOriginalServerTLS(ctx)
	if owner == nil || !errors.Is(e, authservertls.ErrSourceNotSupplied) || !errors.Is(e, authservertls.ErrNotSupplied) {
		t.Fatalf("original Auth empty Root was not the actual nonnil partial cause: owner=%v error=%v", owner != nil, e)
	}
	first := owner.FirstCause()
	if !errors.Is(first, authservertls.ErrSourceNotSupplied) || !errors.Is(first, authservertls.ErrNotSupplied) || owner.Current(ctx) == nil {
		t.Fatal("empty Root minted live transport")
	}
	if _, e = owner.Identity(ctx); e == nil {
		t.Fatal("empty Root returned qualified context DATA")
	}
	owner.Retire()
	if e = owner.Join(ctx); e != nil {
		t.Fatalf("actual empty-Root partial did not drain: %v", e)
	}
	e = owner.Close()
	if !errors.Is(e, authservertls.ErrSourceNotSupplied) || !owner.Lifetime().PhysicalComplete || owner.Lifetime().BorrowHeld || owner.Lifetime().Connections != 0 || owner.Lifetime().IssuerCalls != 0 || owner.FirstCause() != first {
		t.Fatalf("partial cleanup lost original cause/physical distinction: error=%v lifetime=%+v first=%v", e, owner.Lifetime(), owner.FirstCause())
	}
	if e = owner.Close(); !errors.Is(e, authservertls.ErrSourceNotSupplied) || !owner.Lifetime().PhysicalComplete {
		t.Fatal("repeat cleanup changed actual first cause")
	}
}
