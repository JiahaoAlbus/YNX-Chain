//go:build cloud_auth_v2 && cloud_http_v5

package cloud

import (
	"context"
	"io"
	"net/http"
)

func borrowAuthIDEDeploymentV2Body(ctx context.Context, a *AuthIDEDeploymentV2Authority, r *http.Request) (io.ReadCloser, error) {
	if a == nil || a.source == nil {
		return nil, ErrDenied
	}
	// Preserve a nonnil original partial even with an error. The handler owns
	// it before status and never rewrites Body, clones req or reopens the file.
	borrowed, err := a.source.BorrowOriginalBinaryHTTPRequestV5(ctx, r)
	if borrowed == nil {
		return nil, err
	}
	return borrowed, err
}
