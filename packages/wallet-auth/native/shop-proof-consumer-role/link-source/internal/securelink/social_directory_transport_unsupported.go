//go:build !linux && !darwin

package securelink

import (
	"context"
	"net/http"
)

type socialDirectoryPeerConnection struct{}

func (*socialDirectoryPeerConnection) current(context.Context) error { return ErrUnavailable }

type SocialDirectoryForwarder struct{}
type SocialDirectoryResponseLoan struct{}

func NewSocialDirectoryForwarderForOriginalBootstrap(SocialDirectoryForwarderConfig) (*SocialDirectoryForwarder, error) {
	return nil, ErrUnavailable
}
func (*SocialDirectoryForwarder) ForwardOriginal(context.Context, *http.Request, SocialDirectoryOperation) (*SocialDirectoryResponseLoan, error) {
	return nil, ErrUnavailable
}
func (*SocialDirectoryForwarder) Retire()                             {}
func (*SocialDirectoryForwarder) Join(context.Context) error          { return ErrUnavailable }
func (*SocialDirectoryForwarder) Close(context.Context) (bool, error) { return false, ErrUnavailable }
func (*SocialDirectoryResponseLoan) Response() SocialDirectoryResponseDATA {
	return SocialDirectoryResponseDATA{}
}
func (*SocialDirectoryResponseLoan) Retire() {}
func (*SocialDirectoryResponseLoan) Lifetime() SocialDirectoryTransportLifetime {
	return SocialDirectoryTransportLifetime{Unknown: true}
}
func (*SocialDirectoryResponseLoan) FirstCause() error { return ErrUnavailable }
func (*SocialDirectoryResponseLoan) Finish(context.Context) (bool, error) {
	return false, ErrUnavailable
}
func (*SocialDirectoryResponseLoan) Join(context.Context) (bool, error) { return false, ErrUnavailable }
func (*SocialDirectoryResponseLoan) Close(context.Context) (bool, error) {
	return false, ErrUnavailable
}
