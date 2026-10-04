//go:build commerce_v2

package commerce

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net/http"
	"strings"
)

var ErrOriginalShopCompositionUnavailable = errors.New("SHOP_ORIGINAL_PROTECTED_COMPOSITION_UNAVAILABLE")

// ShopRuntimeCurrent is the existing protected deployment/source-custody guard.
// It must be supplied by its real runtime producer, never an ENV boolean,
// identity cookie or a software fixture standing in for enrollment.
type ShopRuntimeCurrent func(context.Context) error

// OriginalShopProfile holds already-loaded original protected key/seal inputs.
// This does not register their backend role, identify an account or grant scopes.
type OriginalShopProfile struct {
	BackendKeyID string
	BackendKey   ed25519.PrivateKey
	BrowserSeal  []byte
	Current      ShopRuntimeCurrent
	BuyerActor   CommerceBrowserActorBinder
	SellerActor  CommerceBrowserActorBinder
	Transport    http.RoundTripper
}

type PreparedOriginalShop struct {
	keyID         string
	key           ed25519.PrivateKey
	seal          []byte
	current       ShopRuntimeCurrent
	buyer, seller CommerceBrowserActorBinder
	transport     http.RoundTripper
}

func shopCurrent(ctx context.Context, current ShopRuntimeCurrent) error {
	if ctx == nil || current == nil {
		return ErrOriginalShopCompositionUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := current(ctx); err != nil {
		return err
	}
	return ctx.Err()
}

// PrepareOriginalShop must run before opening the original Store. It snapshots
// mutable key/seal inputs before any callback and constructs no parallel state.
func PrepareOriginalShop(ctx context.Context, p OriginalShopProfile) (*PreparedOriginalShop, error) {
	key := append(ed25519.PrivateKey(nil), p.BackendKey...)
	seal := append([]byte(nil), p.BrowserSeal...)
	failed := true
	defer func() {
		if failed {
			clear(key)
			clear(seal)
		}
	}()
	if p.BackendKeyID == "" || strings.TrimSpace(p.BackendKeyID) != p.BackendKeyID || len(key) != ed25519.PrivateKeySize || len(seal) != 32 || p.BuyerActor == nil || p.SellerActor == nil {
		return nil, ErrOriginalShopCompositionUnavailable
	}
	if err := shopCurrent(ctx, p.Current); err != nil {
		return nil, err
	}
	// Existing private role and BrowserGrant are revalidated at each request by
	// the original factories; successful preparation is not their enrollment.
	failed = false
	return &PreparedOriginalShop{keyID: p.BackendKeyID, key: key, seal: seal, current: p.Current, buyer: p.BuyerActor, seller: p.SellerActor, transport: p.Transport}, nil
}

// OpenOriginal invokes the original caller-owned Store opener only after the
// complete profile/current fence. Its original IDs, recovery and records stay
// authoritative. Partial pair never escapes on cancellation or source change.
func (p *PreparedOriginalShop) OpenOriginal(ctx context.Context, open func() (*Store, error), cfg ServerConfig) (*Server, *Server, error) {
	if p == nil || open == nil {
		return nil, nil, ErrOriginalShopCompositionUnavailable
	}
	if err := shopCurrent(ctx, p.current); err != nil {
		return nil, nil, err
	}
	store, err := open()
	if err != nil {
		return nil, nil, err
	}
	if err := shopCurrent(ctx, p.current); err != nil {
		return nil, nil, err
	}
	buyer, err := NewCommerceCombinedWebV2Server(store, cfg, p.keyID, p.key, p.seal, p.transport, p.bindCurrent(p.buyer))
	if err != nil {
		return nil, nil, err
	}
	if err := shopCurrent(ctx, p.current); err != nil {
		return nil, nil, err
	}
	seller, err := NewCommerceCombinedSellerWebV2Server(store, cfg, p.keyID, p.key, p.seal, p.transport, p.bindCurrent(p.seller))
	if err != nil {
		return nil, nil, err
	}
	if err := shopCurrent(ctx, p.current); err != nil {
		return nil, nil, err
	}
	return buyer, seller, nil
}
