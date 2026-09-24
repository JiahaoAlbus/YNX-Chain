package finance

import (
	"crypto/hmac"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type DrainSnapshot struct {
	State          string     `json:"state"`
	Draining       bool       `json:"draining"`
	ActiveRequests int64      `json:"activeRequests"`
	StartedAt      *time.Time `json:"startedAt,omitempty"`
}

type drainController struct {
	mu       sync.Mutex
	draining bool
	active   int64
	started  time.Time
}

func (d *drainController) begin(now time.Time) DrainSnapshot {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.draining {
		d.draining = true
		d.started = now.UTC()
	}
	return d.snapshotLocked()
}

func (d *drainController) admit() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.draining {
		return false
	}
	d.active++
	return true
}

func (d *drainController) finish() {
	d.mu.Lock()
	if d.active > 0 {
		d.active--
	}
	d.mu.Unlock()
}

func (d *drainController) snapshot() DrainSnapshot {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.snapshotLocked()
}

func (d *drainController) snapshotLocked() DrainSnapshot {
	state := "ready"
	if d.draining {
		state = "draining"
	}
	var startedAt *time.Time
	if d.draining {
		value := d.started
		startedAt = &value
	}
	return DrainSnapshot{State: state, Draining: d.draining, ActiveRequests: d.active, StartedAt: startedAt}
}

func (s *Server) BeginDrain() DrainSnapshot { return s.drain.begin(s.now()) }

func (s *Server) DrainSnapshot() DrainSnapshot { return s.drain.snapshot() }

func (s *Server) drainAdmission(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if drainExempt(r) {
			next.ServeHTTP(w, r)
			return
		}
		if !s.drain.admit() {
			w.Header().Set("Retry-After", "5")
			writeError(w, http.StatusServiceUnavailable, "service_draining", "Finance is draining and is not accepting new requests")
			return
		}
		defer s.drain.finish()
		next.ServeHTTP(w, r)
	})
}

func drainExempt(r *http.Request) bool {
	switch r.URL.Path {
	case "/health", "/ready", "/version", "/metrics", "/internal/drain":
		return true
	case "/", "/auth/callback", "/app.js", "/finance-locale.js", "/read-sources.js", "/product-catalog.js", "/styles.css", "/manifest.webmanifest", "/ynx-logo.png", "/wallet-auth/callback", "/wallet-auth.js", "/order-wallet.js", "/evm-read-session.js", "/evm-subject.js", "/build-identity.json":
		return r.Method == http.MethodGet
	default:
		return false
	}
}

func (s *Server) beginDrainEndpoint(w http.ResponseWriter, r *http.Request) {
	if !loopbackRemote(r.RemoteAddr) {
		writeError(w, http.StatusForbidden, "drain_control_rejected", "Drain control is available only from loopback")
		return
	}
	provided := strings.TrimSpace(r.Header.Get(operationsKeyHeader))
	if provided == "" || !hmac.Equal([]byte(provided), []byte(s.cfg.OperationsKey)) {
		writeError(w, http.StatusUnauthorized, "operations_auth_rejected", "Operational drain authentication failed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusAccepted, s.BeginDrain())
}

func loopbackRemote(value string) bool {
	host, _, err := net.SplitHostPort(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
