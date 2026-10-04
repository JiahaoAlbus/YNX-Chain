//go:build commerce_v2

package commerce

import (
	"context"
	"crypto/ed25519"
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"net/http"
	"strings"
)

// These are separately registered original Android/macOS Buyer carriers.
// Their source guard must bind the exact private role/platform, not a Web grant.
type OriginalNativeBuyerFiles struct {
	BackendKeyID, BackendKeyFile string
	Current                      ShopRuntimeCurrent
	Actor                        CommerceV2ActorBinder
	Transport                    http.RoundTripper
}
type OriginalNativeBuyerFilesPair struct{ Android, MacOS OriginalNativeBuyerFiles }
type preparedNativeBuyer struct {
	keyID     string
	key       ed25519.PrivateKey
	current   ShopRuntimeCurrent
	actor     CommerceV2ActorBinder
	transport http.RoundTripper
}
type PreparedOriginalNativeBuyers struct{ android, macos preparedNativeBuyer }

func LoadOriginalNativeBuyers(ctx context.Context, files OriginalNativeBuyerFilesPair) (*PreparedOriginalNativeBuyers, error) {
	// Validate both exact entries and both independent provenance before file I/O.
	for _, f := range []OriginalNativeBuyerFiles{files.Android, files.MacOS} {
		if f.BackendKeyID == "" || strings.TrimSpace(f.BackendKeyID) != f.BackendKeyID || f.BackendKeyFile == "" || f.Actor == nil {
			return nil, ErrOriginalShopCompositionUnavailable
		}
		if err := shopCurrent(ctx, f.Current); err != nil {
			return nil, err
		}
	}
	result := &PreparedOriginalNativeBuyers{}
	failed := true
	defer func() {
		if failed {
			clear(result.android.key)
			clear(result.macos.key)
		}
	}()
	for i, f := range []OriginalNativeBuyerFiles{files.Android, files.MacOS} {
		key, err := v2.LoadBackendEd25519PrivateKey(f.BackendKeyFile)
		if err != nil {
			return nil, err
		}
		entry := preparedNativeBuyer{keyID: f.BackendKeyID, key: key, current: f.Current, actor: f.Actor, transport: f.Transport}
		if i == 0 {
			result.android = entry
		} else {
			result.macos = entry
		}
		if err := shopCurrent(ctx, f.Current); err != nil {
			return nil, err
		}
	}
	if err := result.assertCurrent(ctx); err != nil {
		return nil, err
	}
	failed = false
	return result, nil
}
func (p *PreparedOriginalNativeBuyers) assertCurrent(ctx context.Context) error {
	if p == nil {
		return ErrOriginalShopCompositionUnavailable
	}
	if err := shopCurrent(ctx, p.android.current); err != nil {
		return err
	}
	return shopCurrent(ctx, p.macos.current)
}
func (p preparedNativeBuyer) bindCurrent(ctx context.Context, s v2.Session) (func() error, error) {
	if p.actor == nil {
		return nil, ErrOriginalShopCompositionUnavailable
	}
	if err := shopCurrent(ctx, p.current); err != nil {
		return nil, err
	}
	fence, err := p.actor(ctx, s)
	if err != nil {
		return nil, err
	}
	if fence == nil {
		return nil, ErrOriginalShopCompositionUnavailable
	}
	if err := shopCurrent(ctx, p.current); err != nil {
		return nil, err
	}
	return func() error {
		if err := shopCurrent(ctx, p.current); err != nil {
			return err
		}
		if err := fence(); err != nil {
			return err
		}
		return shopCurrent(ctx, p.current)
	}, nil
}

// AttachOriginalBuyer combines only router-fixed original factory consumers.
// All retain the same original Store; hint selection is not authentication.
func (p *PreparedOriginalNativeBuyers) AttachOriginalBuyer(ctx context.Context, buyer *Server, cfg ServerConfig) error {
	if buyer == nil || buyer.store == nil {
		return ErrOriginalShopCompositionUnavailable
	}
	if err := p.assertCurrent(ctx); err != nil {
		return err
	}
	web, ok := buyer.cfg.businessV2.(*commerceV2Verifier)
	if !ok || web.browser == nil || web.bindBrowser == nil || len(web.consumers) != 1 || web.bind != nil {
		return ErrOriginalShopCompositionUnavailable
	}
	consumers := append([]commerceV2Consumer(nil), web.consumers...)
	for i, n := range []preparedNativeBuyer{p.android, p.macos} {
		platform := "android"
		if i == 1 {
			platform = "macos"
		}
		server, err := NewCommerceNativeBuyerV2Server(buyer.store, cfg, platform, n.keyID, n.key, n.transport, n.bindCurrent)
		if err != nil {
			return err
		}
		native, ok := server.cfg.businessV2.(*commerceV2Verifier)
		if !ok || len(native.consumers) != 1 {
			return ErrOriginalShopCompositionUnavailable
		}
		consumers = append(consumers, native.consumers[0])
		if err := p.assertCurrent(ctx); err != nil {
			return err
		}
	}
	// Original Authorize verifies selected exact policy/session before binder.
	bind := func(live context.Context, s v2.Session) (func() error, error) {
		switch s.Platform {
		case "android":
			return p.android.bindCurrent(live, s)
		case "macos":
			return p.macos.bindCurrent(live, s)
		default:
			return nil, ErrOriginalShopCompositionUnavailable
		}
	}
	if err := p.assertCurrent(ctx); err != nil {
		return err
	}
	merged := *web
	merged.consumers = consumers
	merged.bind = bind
	priorCurrent := web.currentPolicy
	merged.currentPolicy = func(live context.Context, platform string) error {
		if priorCurrent != nil {
			if err := priorCurrent(live, platform); err != nil {
				return err
			}
		}
		switch platform {
		case "android":
			return shopCurrent(live, p.android.current)
		case "macos":
			return shopCurrent(live, p.macos.current)
		case "web":
			return live.Err()
		default:
			return ErrOriginalShopCompositionUnavailable
		}
	}
	buyer.cfg.businessV2 = &merged
	return nil
}
