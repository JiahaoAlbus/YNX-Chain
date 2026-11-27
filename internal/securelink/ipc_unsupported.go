//go:build !linux && !darwin

package securelink

import (
	"context"
	"net"
	"net/http"
)

func checkPeerUID(net.Conn, uint32) error                                { return ErrUnavailable }
func ListenPrivate(string, uint32) (net.Listener, error)                 { return nil, ErrUnavailable }
func ListenPrivateWithCloseWitness(string, uint32) (net.Listener, error) { return nil, ErrUnavailable }
func InspectOriginalPrivateListener(net.Listener) (OriginalPrivateListenerStatus, error) {
	return OriginalPrivateListenerStatus{}, ErrUnavailable
}
func DialPrivate(context.Context, string, uint32) (net.Conn, error) { return nil, ErrUnavailable }
func NewIPCBackend(string, uint32) (*http.Transport, error)         { return nil, ErrUnavailable }
