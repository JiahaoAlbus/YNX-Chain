package trustproduct

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

func (s *Service) Handler(assets http.Handler) http.Handler {
	mux := http.NewServeMux()
	s.registerAuthorityRoutes(mux)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		authMode := "session-registry"
		if s.cfg.AllowHeaderAuth {
			authMode = "development-trusted-header"
		}
		writeJSON(w, 200, map[string]any{"ok": true, "service": "ynx-trust-center", "persistent": true, "authMode": authMode, "centralGatewayConfigured": s.cfg.CentralGatewayURL != "", "aiProviderConfigured": s.cfg.AIURL != "" && s.cfg.AIKey != "", "truthBoundary": "Trust explains evidence, process, appeals and corrections; it does not punish or control native YNXT."})
	})
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.View(s.actorFrom(r))
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, 200, v)
	})
	mux.HandleFunc("GET /api/transparency", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.Transparency()) })
	mux.HandleFunc("POST /api/actions", func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var in Action
		if err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(&in); err != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid JSON"})
			return
		}
		res, err := s.Do(s.actorFrom(r), in)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, 200, res)
	})
	if assets != nil {
		mux.Handle("/", assets)
	}
	return securityHeaders(mux)
}

func (s *Service) actorFrom(r *http.Request) Actor {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if actor, ok := s.sessions[token]; ok && token != "" {
		return actor
	}
	if token != "" {
		if actor, err := s.authenticateCentral("Bearer "+token, strings.TrimSpace(r.Header.Get("X-YNX-Device-ID"))); err == nil {
			return actor
		}
	}
	if s.cfg.AllowHeaderAuth {
		return Actor{ID: strings.TrimSpace(r.Header.Get("X-YNX-Actor")), Role: strings.TrimSpace(r.Header.Get("X-YNX-Role"))}
	}
	return Actor{}
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, err error) {
	status := 500
	if e, ok := err.(apiError); ok {
		status = e.Status
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}
