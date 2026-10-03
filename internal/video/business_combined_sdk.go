//go:build ynx_canonical_media && ynx_media_combined_authority

package video

import (
	"context"
	"crypto/subtle"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// BindVideoCombinedCurrentActor captures the original trusted private actor and
// original browser identity together. Its guard checks local account, device,
// generation, membership/role and object changes. It runs in the existing Store
// transaction and must never perform remote I/O or recurse into that Store.
// This callback and the configured sealed BrowserSSO belong to the Host owner.
type BindVideoCombinedCurrentActor func(context.Context, *http.Request, productsessionv2.Session, productsessionv2.BrowserGrant) (func(context.Context) error, error)

// NewVideoCombinedSDKAuthority retains the original BrowserSSO cookies and the
// full original SDK private Session. Browser identity is never private permission.
// It requires the complete combined641 foundation plus approved258 roster; the
// separate build tag preserves reproducibility of older private-only freezes.
func NewVideoCombinedSDKAuthority(video, creator *productsessionv2.RegisteredClientSet, videoBrowser, creatorBrowser *productsessionv2.BrowserSSO, bind BindVideoCombinedCurrentActor) (VideoBusinessAuthority, error) {
	if video == nil || creator == nil || videoBrowser == nil || creatorBrowser == nil || bind == nil {
		return nil, ErrUnauthorized
	}
	a := &videoSDKAuthority{video: video, creator: creator}
	a.prepare = func(ctx context.Context, r *http.Request, product string) (BindVideoCurrentActor, videoSDKRead, error) {
		if ctx == nil || ctx.Err() != nil {
			return nil, nil, ErrVideoAuthorityUnavailable
		}
		browser, origin := videoBrowser, "https://video.ynxweb4.com"
		if product == "creator-studio" {
			browser, origin = creatorBrowser, "https://creator.ynxweb4.com"
		} else if product != "video" {
			return nil, nil, ErrUnauthorized
		}
		// Capture the original sealed association BEFORE any authorization await.
		// Never accept a browser grant/token in client JSON or a product selector header.
		sealed, original, err := browser.Binding(r)
		if err != nil || sealed == "" || original.CSRF == "" {
			return nil, nil, ErrUnauthorized
		}
		// Same-origin GETs may omit Origin. All reads still require the original CSRF;
		// writes require the exact original registered Origin, with no duplicate fields.
		if len(r.Header.Values("Origin")) > 1 || r.Header.Get("Origin") != "" && r.Header.Get("Origin") != origin || r.Method != http.MethodGet && r.Header.Get("Origin") != origin || len(r.Header.Values("X-YNX-SSO-CSRF")) != 1 || subtle.ConstantTimeCompare([]byte(original.CSRF), []byte(r.Header.Get("X-YNX-SSO-CSRF"))) != 1 {
			return nil, nil, ErrUnauthorized
		}
		original.Scopes = append([]string(nil), original.Scopes...)
		actorBind := func(current context.Context, request *http.Request, session productsessionv2.Session) (func(context.Context) error, error) {
			if session.Platform != "web" || session.Origin != origin || session.Account != original.Identity.Account {
				return nil, ErrUnauthorized
			}
			actorBrowser := original
			actorBrowser.Scopes = append([]string(nil), original.Scopes...)
			guard, err := bind(current, request, session, actorBrowser)
			if err != nil || guard == nil {
				return nil, ErrUnauthorized
			}
			return func(c context.Context) error {
				if c == nil || c.Err() != nil {
					return ErrVideoAuthorityUnavailable
				}
				now := time.Now()
				if !original.ExpiresAt.After(now) || !original.Identity.ExpiresAt.After(now) {
					return ErrUnauthorized
				}
				// The browser window constrains the original private effect, without changing
				// SessionExpiresAt or copying identity:read into private scopes/member roles.
				return guard(c)
			}, nil
		}
		read := func(c context.Context, set *productsessionv2.RegisteredClientSet, session productsessionv2.Session, scopes []string) error {
			// One confidential SAME-decision read. No independent identity introspect,
			// consumed-proof replay, renewal, rebinding or automatic authorization retry.
			_, _, err := set.RevalidateBrowser(c, session, browser, sealed, scopes)
			return err
		}
		return actorBind, read, nil
	}
	return a, nil
}
