//go:build !linux && !darwin

package securelink

import (
	"context"
	"net/http"
)

type AuthorityIPCIngress struct{}

func NewAuthorityIPCIngress(AuthorityIPCIngressConfig) (*AuthorityIPCIngress, error) {
	return nil, ErrUnavailable
}
func (*AuthorityIPCIngress) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "authority transport unavailable", http.StatusServiceUnavailable)
}
func (*AuthorityIPCIngress) Retire() error              { return ErrUnavailable }
func (*AuthorityIPCIngress) Join(context.Context) error { return ErrUnavailable }
func (*AuthorityIPCIngress) Close() error               { return ErrUnavailable }
