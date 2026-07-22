package resourceproduct

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/resourcemarket"
)

func (s *Service) Handler(assets http.Handler) http.Handler {
	mux := http.NewServeMux()
	s.registerAuthorityRoutes(mux)
	s.registerMarketRoutes(mux)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		authMode := "session-registry"
		if s.cfg.AllowHeaderAuth {
			authMode = "development-trusted-header"
		}
		writeJSON(w, 200, map[string]any{"ok": true, "status": "ready", "service": "ynx-resource-market", "checks": map[string]string{"process": "pass", "marketEngineInitialized": "pass", "persistencePathConfigured": "pass"}, "coverage": "local process initialization only", "authMode": authMode, "centralGatewayConfigured": s.cfg.CentralGatewayURL != "", "aiProviderConfigured": s.cfg.AIURL != "" && s.cfg.AIKey != "", "truthBoundary": "Sponsorship moves bounded resource capacity only and never user assets."})
	})
	mux.HandleFunc("GET /metrics", s.handleMetrics)
	mux.HandleFunc("GET /status", s.handleOperationalStatus)
	mux.HandleFunc("GET /version", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"service": "ynx-resource-market", "version": "0.3.0-candidate", "marketSchemaVersion": resourcemarket.SchemaVersion, "releaseClass": "unreleased-local-candidate"})
	})
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.View(s.actorFrom(r))
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, 200, v)
	})
	mux.HandleFunc("POST /api/actions", func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var in Action
		if err := decodeActionBody(r, &in); err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
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
	return securityHeaders(s.observe(s.productSessionProofs(mux)))
}

func decodeActionBody(r *http.Request, out any) error {
	b, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil || len(b) > maxBody {
		return errors.New("bounded JSON body required")
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return errors.New("invalid or unknown JSON field")
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("exactly one JSON object is required")
	}
	return nil
}
func (s *Service) actorFrom(r *http.Request) Actor {
	if verified, ok := productSessionFrom(r); ok {
		return verified.Actor
	}
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if actor, ok := s.sessions[token]; ok && token != "" {
		return actor
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
	errorID := "err_" + newTraceID()
	w.Header().Set("X-Error-ID", errorID)
	writeJSON(w, status, map[string]string{"error": err.Error(), "errorId": errorID, "requestId": w.Header().Get("X-Request-ID"), "traceId": w.Header().Get("X-Trace-ID")})
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
