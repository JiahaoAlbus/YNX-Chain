//go:build darwin || linux

package kernel

import (
	"context"
	"sync"
)

// Immutable routing DATA attached only by original normal composition. It is
// neither permission to read nor a fallback. Actual local/registered holder
// constructors still independently authenticate their own Source and owners.
const originalMainPairLocalRoute uint32 = 1
const originalMainPairRegisteredRoute uint32 = 2

var originalMainPairRoutes = struct {
	sync.Mutex
	rows map[*socialJointCaptureReference]uint32
}{rows: make(map[*socialJointCaptureReference]uint32)}

func retainOriginalMainPairRoute(r *socialJointCaptureReference, route uint32) error {
	if r == nil || r.id == 0 || (route != originalMainPairLocalRoute && route != originalMainPairRegisteredRoute) {
		return errSocialSessionPrincipalRequired
	}
	originalMainPairRoutes.Lock()
	defer originalMainPairRoutes.Unlock()
	if old := originalMainPairRoutes.rows[r]; old != 0 && old != route {
		return errSocialSessionPrincipalChanged
	}
	originalMainPairRoutes.rows[r] = route
	return nil
}

// The fixed role-provider composition has a separately registered remote Main
// read owner. No caller/IPC/ENV argument chooses this route or registers a row.
// Selection only names that composition: an absent read-purpose Root row still
// denies its actual acquisition before connect. Never retry the local map.
func registerOriginalSocialJointProviderCapture(ctx context.Context, b *originalSocialJointIssuerCaptureBorrow, id [32]byte) (*socialJointCaptureReference, error) {
	r, e := registerOriginalSocialJointCapture(ctx, b, id, originalSocialJointCurrentThread())
	if e == nil {
		e = retainOriginalMainPairRoute(r, originalMainPairRegisteredRoute)
	}
	return r, e
}

func (l *socialJointCaptureNativeLoan) originalMainPairRoute() (uint32, error) {
	if e := l.current(); e != nil {
		return 0, e
	}
	originalMainPairRoutes.Lock()
	route := originalMainPairRoutes.rows[l.parent]
	originalMainPairRoutes.Unlock()
	if route != originalMainPairLocalRoute && route != originalMainPairRegisteredRoute {
		return 0, errSocialSessionPrincipalRequired
	}
	return route, l.current()
}
