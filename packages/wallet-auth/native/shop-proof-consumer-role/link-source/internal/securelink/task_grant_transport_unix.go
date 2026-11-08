//go:build linux || darwin

package securelink

import "net/http"

// NewDesktopTaskGrantIPCIngress is the separate closed seven-route transport
// for the original desktop TaskGrant authority. It retains the original native
// TLS request/Gate/OS-peer/SCM_RIGHTS checks of AuthorityIPCIngress. Registration
// is operator transport DATA, never a TaskGrant, Source4 or management approval.
// The original Auth normal backend must independently hold its Root-selected
// same caller resource and actual Source before enabling this handler.
// NewAuthorityIPCIngress keeps its original maximum of two registered routes.
func NewDesktopTaskGrantIPCIngress(cfg AuthorityIPCIngressConfig) (*AuthorityIPCIngress, error) {
	if len(cfg.Routes) != 7 {
		return nil, ErrDenied
	}
	for _, route := range cfg.Routes {
		if route.Method != http.MethodPost || route.MaxRequestBytes < 1 || route.MaxRequestBytes > 1<<20 || !desktopTaskGrantPath(route.Path) {
			return nil, ErrDenied
		}
	}
	// Duplicate routes are rejected by the shared private constructor. Seven
	// unique entries from this exact set therefore require the entire set.
	return newAuthorityIPCIngress(cfg, 7)
}

func desktopTaskGrantPath(path string) bool {
	switch path {
	case "/internal/auth/task-grants/issue",
		"/internal/auth/task-grants/effect",
		"/internal/auth/task-grants/query",
		"/internal/auth/task-grants/effect-query",
		"/internal/auth/task-grants/effect-reconcile",
		"/internal/auth/task-grants/revoke",
		"/internal/auth/task-grants/management":
		return true
	default:
		return false
	}
}
