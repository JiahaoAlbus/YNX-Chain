//go:build cloud_auth_v2 && !cloud_http_v5

package cloud

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
	"io"
	"net/http"
)

func borrowAuthIDEDeploymentV2Body(context.Context, *AuthIDEDeploymentV2Authority, *http.Request) (io.ReadCloser, error) {
	return nil, developerauthority.ErrDeploymentV2OriginalRequestUnavailable
}
