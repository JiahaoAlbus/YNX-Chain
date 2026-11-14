//go:build !cloud_auth_v2

package cloud

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

func isIDEDeploymentV2RequestUnavailable(error) bool { return false }

// A matching original Auth/Core source composition is required. No legacy or
// JSON Source grants replace the genuine constructor in an uncomposed build.
func OpenAuthIDEDeploymentV2Authority(context.Context, *developerauthority.Catalog, developerauthority.OriginalSource) (IDEDeploymentV2Authority, error) {
	return nil, ErrDenied
}
