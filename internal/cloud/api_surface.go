package cloud

import (
	"context"
	"net/http"
	"path"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type apiSurfaceKey struct{}
type apiSurface uint8

const (
	apiSurfaceRootV2 apiSurface = iota + 1
	apiSurfaceLegacy
)

// MountAPISurfaces mounts one handler (and therefore one Service/state writer)
// behind distinct trusted routes. The proxy MUST preserve the legacy aliases:
// /cloud/api/* and /docs-app/api/* must not be rewritten to /api/* upstream.
// Origin selects a v2 product policy, never the authentication protocol.
// Social machine-capability routes may be mounted separately at a longer prefix.
func MountAPISurfaces(mux *http.ServeMux, api http.Handler) {
	mux.Handle("/api/", apiSurfaceHandler(api, apiSurfaceRootV2))
	for _, prefix := range []string{"/cloud", "/docs-app"} {
		mux.Handle(prefix+"/api/", http.StripPrefix(prefix, apiSurfaceHandler(api, apiSurfaceLegacy)))
	}
}

func apiSurfaceHandler(next http.Handler, surface apiSurface) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		canonical := path.Clean(r.URL.Path)
		issuance := r.Method == http.MethodPost && (canonical == "/api/v1/session" || canonical == "/api/v1/session/challenge")
		if issuance && (surface == apiSurfaceRootV2 || len(r.Header.Values(productsessionv2.ProofHeader)) != 0) {
			productReadFailure(w, http.StatusForbidden, "LEGACY_SESSION_ROUTE_DISABLED")
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), apiSurfaceKey{}, surface))
		// Preserve the old public health alias without proxy-side path rewriting.
		if surface == apiSurfaceLegacy && r.URL.Path == "/api/health" {
			cloned := *r.URL
			cloned.Path = "/health"
			cloned.RawPath = ""
			r.URL = &cloned
		}
		next.ServeHTTP(w, r)
	})
}
