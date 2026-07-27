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
		writeJSON(w, 200, map[string]any{"ok": true, "service": "ynx-trust-center", "persistent": true, "stateFormatVersion": currentSnapshotVersion, "tamperEvidentPersistence": true, "authMode": authMode, "centralGatewayConfigured": s.cfg.CentralGatewayURL != "", "aiProviderConfigured": s.cfg.AIURL != "" && s.cfg.AIKey != "", "truthBoundary": "Trust explains evidence, process, appeals and corrections; it does not punish or control native YNXT."})
	})
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		actor, err := s.actorFrom(r, scopeEvidenceRead)
		if err != nil {
			writeErr(w, err)
			return
		}
		v, err := s.View(actor)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, 200, v)
	})
	mux.HandleFunc("GET /api/transparency", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.Transparency()) })
	mux.HandleFunc("GET /api/export", func(w http.ResponseWriter, r *http.Request) {
		actor, err := s.actorFrom(r, scopeEvidenceRead)
		if err != nil {
			writeErr(w, err)
			return
		}
		exported, err := s.ExportSubject(actor)
		if err != nil {
			writeErr(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Disposition", `attachment; filename="ynx-trust-subject-export.json"`)
		writeJSON(w, http.StatusOK, exported)
	})
	mux.HandleFunc("POST /api/actions", func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var in Action
		if err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(&in); err != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid JSON"})
			return
		}
		actor, err := s.actorFrom(r, actionScope(in.Type))
		if err != nil {
			writeErr(w, err)
			return
		}
		res, err := s.Do(actor, in)
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

func actionScope(actionType string) string {
	switch actionType {
	case "appeal", "resolve_appeal":
		return scopeAppeal
	case "ai_prepare", "ai_run", "ai_cancel", "ai_review":
		return scopeEvidenceRead
	default:
		return scopeEvidenceWrite
	}
}

func (s *Service) actorFrom(r *http.Request, requiredScopes ...string) (Actor, error) {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if token != "" {
		if actor, ok := s.sessions[token]; ok {
			return actor, nil
		}
		return s.authenticateCentral("Bearer "+token, strings.TrimSpace(r.Header.Get("X-YNX-Device-ID")), requiredScopes...)
	}
	if s.cfg.AllowHeaderAuth {
		actor := Actor{ID: strings.TrimSpace(r.Header.Get("X-YNX-Actor")), Role: strings.TrimSpace(r.Header.Get("X-YNX-Role"))}
		if validActor(actor) {
			return actor, nil
		}
	}
	return Actor{}, apiError{401, "authenticated Trust actor is required"}
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
