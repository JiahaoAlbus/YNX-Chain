//go:build ynx_canonical_media

package video

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// BindVideoCurrentActor captures the current trusted actor/device/generation
// after initial authorization. The returned guard must check that same binding
// after every await. It must not call back into Store: transaction revalidation
// runs under its original mutex. HTTP fields alone cannot establish this guard.
type BindVideoCurrentActor func(context.Context, *http.Request, productsessionv2.Session) (func(context.Context) error, error)

type videoSDKAuthority struct {
	video, creator *productsessionv2.RegisteredClientSet
	bind           BindVideoCurrentActor
}

// NewVideoSDKAuthority composes A's frozen SDK without installing keys, clients,
// Host configuration or a new identity authority. Both registered product sets
// and the host's live actor binding are mandatory; absent configuration fails.
// Build with ynx_canonical_media only in the frozen shared-source composition.
func NewVideoSDKAuthority(video, creator *productsessionv2.RegisteredClientSet, bind BindVideoCurrentActor) (VideoBusinessAuthority, error) {
	if video == nil || creator == nil || bind == nil {
		return nil, ErrUnauthorized
	}
	return &videoSDKAuthority{video: video, creator: creator, bind: bind}, nil
}

func (a *videoSDKAuthority) VerifyVideoBusiness(ctx context.Context, r *http.Request, scope string, body io.Reader, size int64) (VideoBusinessGrant, error) {
	var zero VideoBusinessGrant
	if ctx == nil || r == nil || body == nil || size < 0 || ctx.Err() != nil {
		return zero, ErrUnauthorized
	}
	claimed, routeScope, err := videoBusinessRequestScope(r)
	if err != nil || routeScope != scope {
		return zero, ErrUnauthorized
	}
	set := a.video
	if claimed.ProductID == "creator-studio" {
		set = a.creator
	}
	scopes := []string{routeScope}
	session, err := set.Authorize(ctx, r, scopes)
	if err != nil {
		return zero, err
	}
	if ctx.Err() != nil {
		return zero, ErrUnauthorized
	}
	// Pass an independent copy to the trusted host callback. Preserve the full
	// original verified SDK session, including scopes and native tuple, privately.
	actorSession := session
	actorSession.Scopes = append([]string(nil), session.Scopes...)
	if session.BundleID != nil {
		v := *session.BundleID
		actorSession.BundleID = &v
	}
	if session.PackageID != nil {
		v := *session.PackageID
		actorSession.PackageID = &v
	}
	if session.ServiceConsent != nil {
		v := *session.ServiceConsent
		actorSession.ServiceConsent = &v
	}
	guard, err := a.bind(ctx, r, actorSession)
	if err != nil || guard == nil || guard(ctx) != nil {
		return zero, ErrUnauthorized
	}
	// SDK v2 signs URL.Path only. The router independently allows q only on
	// catalogue search and rejects query strings on all private business routes.
	action, err := set.VerifyHTTPActionStream(ctx, r.Header.Get(videoActionProofHeader), session, r.Method, r.URL.Path, body, size, scopes, time.Now())
	if err != nil {
		return zero, err
	}
	if ctx.Err() != nil || guard(ctx) != nil {
		return zero, ErrUnauthorized
	}
	expires, err := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	if err != nil || action.SessionBinding != session.SessionBinding || action.ExpiresAt.After(expires) {
		return zero, ErrUnauthorized
	}
	revalidate := func(current context.Context) error {
		if current == nil || current.Err() != nil || guard(current) != nil {
			return ErrUnauthorized
		}
		// Never replay Authorize's consumed device proof or reconstruct Session
		// from the reduced grant. SDK checks the same full original session.
		if _, err := set.Revalidate(current, session, scopes); err != nil {
			return ErrUnauthorized
		}
		if current.Err() != nil || guard(current) != nil {
			return ErrUnauthorized
		}
		return nil
	}
	return VideoBusinessGrant{Actor: session.Account, ProductID: session.ProductID, Scope: routeScope, Nonce: action.Nonce, BodyDigest: action.BodyDigest, SessionBinding: session.SessionBinding, SessionExpiresAt: expires, ExpiresAt: action.ExpiresAt, Revalidate: revalidate}, nil
}
