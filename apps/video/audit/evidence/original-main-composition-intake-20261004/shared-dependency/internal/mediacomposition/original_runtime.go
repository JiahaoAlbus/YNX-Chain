//go:build ynx_canonical_media && ynx_media_combined_authority

package mediacomposition

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/music"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"github.com/JiahaoAlbus/YNX-Chain/internal/video"
	"net/http"
)

var ErrOriginalMediaRuntimeUnavailable = errors.New("original protected Media runtime source/actor unavailable")

// Inputs are supplied ONLY by the original protected launcher. These are
// existing immutable registered readers, sealed browser roots and enrolled
// actor binders, not factories for roles, credentials or source provenance.
type VideoInputs struct {
	VideoWeb, CreatorWeb, VideoNative, CreatorNative *productsessionv2.RegisteredClientSet
	VideoBrowser, CreatorBrowser                     *productsessionv2.BrowserSSO
	BindWeb                                          video.BindVideoCombinedCurrentActor
	BindNative                                       video.BindVideoCurrentActor
}
type MusicInputs struct {
	Registered *productsessionv2.RegisteredClientSet
	Bind       music.BindMusicCurrentActor
}
type PreparedVideo struct {
	authority video.VideoBusinessAuthority
	current   func() error
}
type PreparedMusic struct {
	authority music.MusicBusinessAuthority
	current   func() error
}

func (p *PreparedVideo) Authority() video.VideoBusinessAuthority {
	if p == nil {
		return nil
	}
	return p.authority
}
func (p *PreparedMusic) Authority() music.MusicBusinessAuthority {
	if p == nil {
		return nil
	}
	return p.authority
}
func (p *PreparedVideo) AssertCurrent() error {
	if p == nil || p.current == nil {
		return ErrOriginalMediaRuntimeUnavailable
	}
	return p.current()
}
func (p *PreparedMusic) AssertCurrent() error {
	if p == nil || p.current == nil {
		return ErrOriginalMediaRuntimeUnavailable
	}
	return p.current()
}
func sourceCheck(sets ...*productsessionv2.RegisteredClientSet) func() error {
	captured := append([]*productsessionv2.RegisteredClientSet(nil), sets...)
	return func() error {
		for _, set := range captured {
			if set == nil {
				return ErrOriginalMediaRuntimeUnavailable
			}
			if err := set.AssertOriginalSourceCurrent(); err != nil {
				return err
			}
		}
		return nil
	}
}
func actorGuard(ctx context.Context, current func() error, actor func(context.Context) error) error {
	if ctx == nil || actor == nil {
		return ErrOriginalMediaRuntimeUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := current(); err != nil {
		return err
	}
	if err := actor(ctx); err != nil {
		return err
	}
	if err := current(); err != nil {
		return err
	}
	return ctx.Err()
}
func PrepareOriginalVideo(ctx context.Context, inputs *VideoInputs) (*PreparedVideo, error) {
	if ctx == nil {
		return nil, ErrOriginalMediaRuntimeUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if inputs == nil {
		return nil, nil
	}
	in := *inputs
	if in.VideoBrowser == nil || in.CreatorBrowser == nil || in.BindWeb == nil || in.BindNative == nil {
		return nil, ErrOriginalMediaRuntimeUnavailable
	}
	current := sourceCheck(in.VideoWeb, in.CreatorWeb, in.VideoNative, in.CreatorNative)
	if err := current(); err != nil {
		return nil, err
	}
	bindWeb := func(c context.Context, r *http.Request, session productsessionv2.Session, grant productsessionv2.BrowserGrant) (func(context.Context) error, error) {
		if c == nil {
			return nil, ErrOriginalMediaRuntimeUnavailable
		}
		if err := c.Err(); err != nil {
			return nil, err
		}
		if err := current(); err != nil {
			return nil, err
		}
		actor, err := in.BindWeb(c, r, session, grant)
		if err != nil {
			return nil, err
		}
		if err = actorGuard(c, current, actor); err != nil {
			return nil, err
		}
		return func(effect context.Context) error { return actorGuard(effect, current, actor) }, nil
	}
	bindNative := func(c context.Context, r *http.Request, session productsessionv2.Session) (func(context.Context) error, error) {
		if c == nil {
			return nil, ErrOriginalMediaRuntimeUnavailable
		}
		if err := c.Err(); err != nil {
			return nil, err
		}
		if err := current(); err != nil {
			return nil, err
		}
		actor, err := in.BindNative(c, r, session)
		if err != nil {
			return nil, err
		}
		if err = actorGuard(c, current, actor); err != nil {
			return nil, err
		}
		return func(effect context.Context) error { return actorGuard(effect, current, actor) }, nil
	}
	web, err := video.NewVideoCombinedSDKAuthority(in.VideoWeb, in.CreatorWeb, in.VideoBrowser, in.CreatorBrowser, bindWeb)
	if err != nil {
		return nil, err
	}
	native, err := video.NewVideoSDKAuthority(in.VideoNative, in.CreatorNative, bindNative)
	if err != nil {
		return nil, err
	}
	authority, err := video.NewVideoPlatformSDKAuthority(web, native)
	if err != nil {
		return nil, err
	}
	if err = current(); err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	return &PreparedVideo{authority, current}, nil
}
func PrepareOriginalMusic(ctx context.Context, inputs *MusicInputs) (*PreparedMusic, error) {
	if ctx == nil {
		return nil, ErrOriginalMediaRuntimeUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if inputs == nil {
		return nil, nil
	}
	in := *inputs
	if in.Bind == nil {
		return nil, ErrOriginalMediaRuntimeUnavailable
	}
	current := sourceCheck(in.Registered)
	if err := current(); err != nil {
		return nil, err
	}
	bind := func(c context.Context, r *http.Request, session productsessionv2.Session) (func(context.Context) error, error) {
		if c == nil {
			return nil, ErrOriginalMediaRuntimeUnavailable
		}
		if err := c.Err(); err != nil {
			return nil, err
		}
		if err := current(); err != nil {
			return nil, err
		}
		actor, err := in.Bind(c, r, session)
		if err != nil {
			return nil, err
		}
		if err = actorGuard(c, current, actor); err != nil {
			return nil, err
		}
		return func(effect context.Context) error { return actorGuard(effect, current, actor) }, nil
	}
	authority, err := music.NewMusicSDKAuthority(in.Registered, bind)
	if err != nil {
		return nil, err
	}
	if err = current(); err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	return &PreparedMusic{authority, current}, nil
}
