//go:build ynx_canonical_media

package music

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// BindMusicCurrentActor captures the current trusted actor/device/generation
// after initial authorization. The returned guard must check that same binding
// after every await. This guard must be local and must not call back into Store:
// it runs under the original transaction mutex. Remote SDK reads run outside it.
// HTTP fields alone cannot establish this guard.
type BindMusicCurrentActor func(context.Context, *http.Request, productsessionv2.Session) (func(context.Context) error, error)

func musicSDKError(err error) error {
	if err == nil {
		return nil
	}
	var failure *productsessionv2.Error
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || errors.As(err, &failure) && failure.Status >= 500 {
		return ErrMusicAuthorityUnavailable
	}
	return err
}

type musicSDKAuthority struct {
	music *productsessionv2.RegisteredClientSet
	bind  BindMusicCurrentActor
}

// NewMusicSDKAuthority composes A's frozen SDK without installing keys, clients,
// Host configuration or a new identity authority. The registered Music set
// and the host's live actor binding are mandatory; absent configuration fails.
// Build with ynx_canonical_media only in the frozen shared-source composition.
func NewMusicSDKAuthority(music *productsessionv2.RegisteredClientSet, bind BindMusicCurrentActor) (MusicBusinessAuthority, error) {
	if music == nil || bind == nil {
		return nil, ErrUnauthorized
	}
	return &musicSDKAuthority{music: music, bind: bind}, nil
}

func (a *musicSDKAuthority) VerifyMusicBusiness(ctx context.Context, r *http.Request, scope string, body io.Reader, size int64) (MusicBusinessGrant, error) {
	var zero MusicBusinessGrant
	if ctx == nil || r == nil || body == nil || size < 0 || ctx.Err() != nil {
		return zero, ErrUnauthorized
	}
	if scope != "music.profile" && scope != "music.library" && scope != "music.playback" && scope != "music.creator" {
		return zero, ErrUnauthorized
	}
	if r.URL.RawPath != "" || r.URL.Fragment != "" {
		return zero, ErrUnauthorized
	}
	set := a.music
	scopes := []string{scope}
	session, err := set.Authorize(ctx, r, scopes)
	if err != nil {
		return zero, musicSDKError(err)
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
	action, err := set.VerifyHTTPActionStream(ctx, r.Header.Get("X-YNX-Music-Business-Proof-V2"), session, r.Method, r.URL.Path, body, size, scopes, time.Now())
	if err != nil {
		return zero, musicSDKError(err)
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
			return musicSDKError(err)
		}
		if current.Err() != nil || guard(current) != nil {
			return ErrUnauthorized
		}
		return nil
	}
	return MusicBusinessGrant{Actor: session.Account, Nonce: action.Nonce, BodyDigest: action.BodyDigest, SessionBinding: session.SessionBinding, ExpiresAt: action.ExpiresAt, Revalidate: revalidate, Current: guard}, nil
}
