//go:build !linux && !darwin

package securelink

import (
	"context"
	"net"
	"net/http"
)

type localCallerState struct{ request *http.Request }

type originalV4ResponseLease struct{}

func (*localCallerState) adoptOriginalV4ResponseOwner(*http.Request, OriginalV4ResponseOwner) (*OriginalV4ResponseLease, error) {
	return nil, ErrUnavailable
}
func (*originalV4ResponseLease) status() OriginalV4ResponseStatus {
	return OriginalV4ResponseStatus{FirstError: ErrUnavailable}
}
func (*originalV4ResponseLease) drain(context.Context) error { return ErrUnavailable }

// No supported OS boundary exists on this platform. Keep the public API
// available without manufacturing credentials or a usable caller.
func (*localCallerState) current(context.Context) (LocalCallerMaterial, error) {
	return LocalCallerMaterial{}, ErrUnavailable
}

func (*localCallerState) currentOriginalCaller(*http.Request) error {
	return ErrUnavailable
}

type LocalCallerServer struct{}

func NewLocalCallerServer(LocalCallerServerConfig) (*LocalCallerServer, error) {
	return nil, ErrUnavailable
}
func NewProductSessionProofV4LocalCallerServer(LocalCallerServerConfig) (*LocalCallerServer, error) {
	return nil, ErrUnavailable
}
func NewProductLocalCallerServer(LocalCallerServerConfig) (*LocalCallerServer, error) {
	return nil, ErrUnavailable
}
func (*LocalCallerServer) Serve(net.Listener) error        { return ErrUnavailable }
func (*LocalCallerServer) Close() error                    { return nil }
func (*LocalCallerServer) Retire() error                   { return ErrUnavailable }
func (*LocalCallerServer) Join(context.Context) error      { return ErrUnavailable }
func (*LocalCallerServer) OriginalV4ChildrenDrained() bool { return false }

type LocalCallerClient struct{}

func NewLocalCallerClient(LocalCallerClientConfig) (*LocalCallerClient, error) {
	return nil, ErrUnavailable
}
func (*LocalCallerClient) Call(context.Context, string, string, string, []byte) (LocalCallerResponse, error) {
	return LocalCallerResponse{}, ErrUnavailable
}
