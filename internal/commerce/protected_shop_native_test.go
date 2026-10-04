//go:build commerce_v2

package commerce

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestOriginalNativePairMissingSourceBeforeCarriers(t *testing.T) {
	f := OriginalNativeBuyerFiles{BackendKeyID: "existing-role-key", BackendKeyFile: "/not-read", Actor: func(context.Context, v2.Session) (func() error, error) { return func() error { return nil }, nil }}
	if _, err := LoadOriginalNativeBuyers(context.Background(), OriginalNativeBuyerFilesPair{f, f}); !errors.Is(err, ErrOriginalShopCompositionUnavailable) {
		t.Fatal(err)
	}
	f.Current = func(context.Context) error { return nil }
	if _, err := LoadOriginalNativeBuyers(context.Background(), OriginalNativeBuyerFilesPair{Android: f}); !errors.Is(err, ErrOriginalShopCompositionUnavailable) {
		t.Fatal("partial carrier read attempted", err)
	}
}
func TestOriginalNativeActorLateSourceStopsCommit(t *testing.T) {
	live := true
	n := preparedNativeBuyer{current: func(context.Context) error {
		if !live {
			return ErrOriginalShopCompositionUnavailable
		}
		return nil
	}, actor: func(context.Context, v2.Session) (func() error, error) {
		return func() error { live = false; return nil }, nil
	}}
	fence, err := n.bindCurrent(context.Background(), v2.Session{Platform: "android"})
	if err != nil {
		t.Fatal(err)
	}
	if !errors.Is(fence(), ErrOriginalShopCompositionUnavailable) {
		t.Fatal("late source accepted")
	}
}
func TestOriginalNativeBuyerSameStoreAndFixedPolicies(t *testing.T) {
	store, err := OpenWithIntegrity(filepath.Join(t.TempDir(), "commerce.json"), bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{2}, 32))
	current := func(context.Context) error { return nil }
	buyer, err := NewCommerceCombinedWebV2Server(store, ServerConfig{}, "original-construction-key", key, bytes.Repeat([]byte{3}, 32), nil, func(*http.Request, v2.Session, v2.BrowserGrant, string) (func() error, error) {
		return func() error { return nil }, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	actor := func(context.Context, v2.Session) (func() error, error) { return func() error { return nil }, nil }
	androidLive := true
	androidCurrent := func(context.Context) error {
		if !androidLive {
			return ErrOriginalShopCompositionUnavailable
		}
		return nil
	}
	p := &PreparedOriginalNativeBuyers{android: preparedNativeBuyer{"android-key", key, androidCurrent, actor, nil}, macos: preparedNativeBuyer{"macos-key", key, current, actor, nil}}
	if err := p.AttachOriginalBuyer(context.Background(), buyer, ServerConfig{}); err != nil {
		t.Fatal(err)
	}
	if buyer.store != store {
		t.Fatal("parallel Store")
	}
	g := buyer.cfg.businessV2.(*commerceV2Verifier)
	if len(g.consumers) != 3 || g.browser == nil || g.bindBrowser == nil || g.bind == nil {
		t.Fatal("lost original composition")
	}
	for i, platform := range []string{"web", "android", "macos"} {
		c := g.consumers[i]
		if c.policy.Platform != platform || len(c.policy.AllowedScopes) != 3 {
			t.Fatal("scope/platform widened")
		}
		if i > 0 && (c.policy.Origin != "app://"+platform+"/com.ynxweb4.shop" || c.policy.Callback != ShopCallback) {
			t.Fatal("native borrowed Web policy")
		}
	}
	// Untrusted hint can only select a fixed consumer; revoked current rejects
	// before any HTTP reader or actor, not a synthetic positive authorization.
	androidLive = false
	hint, _ := json.Marshal(g.consumers[1].policy)
	r := httptest.NewRequest("GET", "/api/profile", nil)
	r.Header.Set(v2.ProofHeader, base64.RawURLEncoding.EncodeToString(hint))
	if _, err := g.verify(r, nil, businessRoutePolicy{}); !errors.Is(err, ErrOriginalShopCompositionUnavailable) {
		t.Fatal("Native request source not checked before reader", err)
	}
	if err := p.AttachOriginalBuyer(context.Background(), buyer, ServerConfig{}); err == nil {
		t.Fatal("duplicate attach accepted")
	}
}
