//go:build linux || darwin

package securelink

import (
	"net/http"
	"strings"
	"time"
)

// NewProductLocalCallerServer retains the original registered Unix peer,
// request capability and server lifecycle. Ordinary paths use the unchanged
// original route validator. The only additional wire spelling accepted here
// is canonical %3A inside the two fixed Product archive GET routes from the
// Auth/P06 transport-contract-r2 grammar. It is not Source authorization.
//
// The normal Pay owner supplies its existing exact deployment routes and
// original handler; requests cannot install routes or select another peer.
func NewProductLocalCallerServer(cfg LocalCallerServerConfig) (*LocalCallerServer, error) {
	if len(cfg.Routes) == 0 || len(cfg.Routes) > 64 {
		return nil, ErrBounds
	}
	routes := make(map[string]LocalCallerRoute, len(cfg.Routes))
	for _, route := range cfg.Routes {
		if strings.Contains(route.Path, "%") || strings.HasPrefix(route.Path, "/v5/pay/products/") {
			if route.Method != http.MethodGet || route.MaxBodyBytes != 0 || route.Timeout <= 0 || route.Timeout > 30*time.Second {
				return nil, ErrDenied
			}
			valid := false
			for _, operation := range []uint32{12, 13} {
				if productPrivateRoute(productPrivateRequest{operation: operation, method: route.Method, path: route.Path}) == nil {
					valid = true
					break
				}
			}
			if !valid {
				return nil, ErrDenied
			}
		} else if _, err := localRoutes([]LocalCallerRoute{route}); err != nil {
			return nil, err
		}
		key := route.Method + " " + route.Path
		if _, exists := routes[key]; exists {
			return nil, ErrDenied
		}
		routes[key] = route
	}
	return newLocalCallerServer(cfg, routes)
}
