//go:build commerce_v2

package commerce

import (
	"context"
	"errors"
	"testing"
)

func TestOriginalShopMissingProfileCannotOpen(t *testing.T) {
	if _, err := PrepareOriginalShop(context.Background(), OriginalShopProfile{}); !errors.Is(err, ErrOriginalShopCompositionUnavailable) {
		t.Fatal(err)
	}
}
func TestOriginalShopNilPreparedCannotOpen(t *testing.T) {
	called := 0
	var p *PreparedOriginalShop
	_, _, err := p.OpenOriginal(context.Background(), func() (*Store, error) { called++; return nil, nil }, ServerConfig{})
	if !errors.Is(err, ErrOriginalShopCompositionUnavailable) || called != 0 {
		t.Fatalf("err %v opens %d", err, called)
	}
}
func TestOriginalShopCancellationAfterCurrentStopsOriginalStore(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	called := 0
	p := &PreparedOriginalShop{current: func(context.Context) error { cancel(); return nil }}
	_, _, err := p.OpenOriginal(ctx, func() (*Store, error) { called++; return nil, nil }, ServerConfig{})
	if !errors.Is(err, context.Canceled) || called != 0 {
		t.Fatalf("err %v opens %d", err, called)
	}
}
