//go:build !securelink_openssl || !cgo || !securelink_reviewed_server_tls || (!darwin && !linux)

package securelink

import "context"

// The ordinary build has no reviewed Auth issuer linked. There is no fallback
// to Go/Apple TLS, a caller config, a received certificate or a self-derived pin.
func OpenOriginalServerTLS(context.Context) (*OriginalServerTLS, error) { return nil, ErrUnavailable }
