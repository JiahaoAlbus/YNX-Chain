//go:build !securelink_openssl || !cgo

package native

// ServerIdentity cannot supply native server DATA without the pinned runtime.
func (*Context) ServerIdentity() (ServerIdentity, error) {
	return ServerIdentity{}, ErrUnavailable
}

func NewServerContextFromFDs(int, int, int, string, string) (*Context, error) {
	return nil, ErrUnavailable
}
