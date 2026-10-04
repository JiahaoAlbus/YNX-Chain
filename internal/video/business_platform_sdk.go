//go:build ynx_canonical_media && ynx_media_combined_authority

package video

import (
	"context"
	"io"
	"net/http"
)

// NewVideoPlatformSDKAuthority only routes the existing bounded claimed tuple.
// The selected ORIGINAL SDK authority must still verify both proofs, sealed
// browser binding or original enrolled native actor, and exact server scopes.
// No header supplies authority and no failed Web verification falls to Native.
func NewVideoPlatformSDKAuthority(web, native VideoBusinessAuthority) (VideoBusinessAuthority, error) {
	if web == nil || native == nil {
		return nil, ErrVideoAuthorityUnavailable
	}
	return &videoPlatformSDKAuthority{web: web, native: native}, nil
}

type videoPlatformSDKAuthority struct{ web, native VideoBusinessAuthority }

func (a *videoPlatformSDKAuthority) VerifyVideoBusiness(ctx context.Context, r *http.Request, scope string, body io.Reader, size int64) (VideoBusinessGrant, error) {
	if ctx == nil || ctx.Err() != nil || r == nil || r.URL == nil {
		return VideoBusinessGrant{}, ErrVideoAuthorityUnavailable
	}
	claimed, expected, err := videoBusinessRequestScope(r)
	if err != nil || expected != scope {
		return VideoBusinessGrant{}, ErrUnauthorized
	}
	switch claimed.Platform {
	case "web":
		return a.web.VerifyVideoBusiness(ctx, r, scope, body, size)
	case "android", "ios", "macos":
		return a.native.VerifyVideoBusiness(ctx, r, scope, body, size)
	default:
		return VideoBusinessGrant{}, ErrUnauthorized
	}
}
