//go:build darwin && !cgo

package securelink

import "context"

type originalLocalCallerPeerPlatform struct{}

func (*originalLocalCallerPeer) preparePlatform(context.Context) error   { return ErrUnavailable }
func (*originalLocalCallerPeer) bindPlatform(context.Context, int) error { return ErrUnavailable }
func (*originalLocalCallerPeer) peerPlatform(int, bool) (bool, error)    { return false, ErrUnavailable }
func (*originalLocalCallerPeer) processPlatform(context.Context) error   { return ErrUnavailable }
