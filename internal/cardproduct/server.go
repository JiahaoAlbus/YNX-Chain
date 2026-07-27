package cardproduct

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type Server struct {
	service *Service
	mux     *http.ServeMux
	build   buildinfo.Info
}

func NewServer(service *Service, build buildinfo.Info) *Server {
	s := &Server{service: service, mux: http.NewServeMux(), build: buildinfo.Normalize(build)}
	s.routes()
	return s
}
func (s *Server) Handler() http.Handler { return securityHeaders(s.mux) }
func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("GET /ready", s.ready)
	s.mux.HandleFunc("GET /version", s.version)
	s.mux.HandleFunc("GET /v1/account/state", s.protected(s.state))
	s.mux.HandleFunc("POST /v1/card/applications", s.protected(s.apply))
	s.mux.HandleFunc("POST /v1/cards/{id}/actions", s.protected(s.action))
	s.mux.HandleFunc("PUT /v1/cards/{id}/controls", s.protected(s.controls))
	s.mux.HandleFunc("POST /v1/cards/{id}/disputes", s.protected(s.dispute))
	s.mux.HandleFunc("POST /v1/ai/runs", s.protected(s.aiRun))
	s.mux.HandleFunc("POST /v1/ai/runs/{id}/review", s.protected(s.aiReview))
	s.mux.HandleFunc("POST /v1/provider/events", s.providerEvent)
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	available := s.service.ProviderAvailable(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": map[bool]string{true: "healthy", false: "degraded"}[available], "service": "ynx-card-productd", "productId": ProductID, "clientId": ClientID, "bundleId": BundleID, "network": Network, "issuerProvider": s.service.ProviderName(), "issuerAvailable": available, "cardCapability": map[bool]string{true: "sandbox_testnet_only", false: "provider_unavailable"}[available], "sensitiveData": "provider-hosted-never-persisted", "build": s.build})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	available := s.service.ProviderAvailable(r.Context())
	status := http.StatusOK
	if !available {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{
		"ready":             available,
		"service":           "ynx-card-productd",
		"issuerProvider":    s.service.ProviderName(),
		"issuerAvailable":   available,
		"cardCapability":    map[bool]string{true: "sandbox_testnet_only", false: "provider_unavailable"}[available],
		"failureSemantics":  map[bool]string{true: "none", false: "fail_closed"}[available],
		"sensitiveDataMode": "provider_hosted",
	})
}

func (s *Server) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"service":      "ynx-card-productd",
		"productId":    ProductID,
		"clientId":     ClientID,
		"bundleId":     BundleID,
		"stateVersion": StateVersion,
		"build":        s.build,
	})
}

type protectedHandler func(http.ResponseWriter, *http.Request, GatewayAssertion, []byte)

func (s *Server) protected(next protectedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, ok := readBody(w, r)
		if !ok {
			return
		}
		assertion, err := s.service.gateway.Verify(r, body)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		next(w, r, assertion, body)
	}
}
func (s *Server) state(w http.ResponseWriter, _ *http.Request, a GatewayAssertion, _ []byte) {
	out, err := s.service.State(a.Account)
	respond(w, http.StatusOK, out, err)
}
func (s *Server) apply(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in ApplyInput
	if !decodeBody(w, body, &in) {
		return
	}
	out, err := s.service.Apply(r.Context(), a.Account, in)
	respond(w, http.StatusCreated, out, err)
}
func (s *Server) action(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in struct {
		Action         string `json:"action"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decodeBody(w, body, &in) {
		return
	}
	out, err := s.service.Transition(r.Context(), a.Account, r.PathValue("id"), in.Action, in.IdempotencyKey)
	respond(w, http.StatusOK, out, err)
}
func (s *Server) controls(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in ControlsInput
	if !decodeBody(w, body, &in) {
		return
	}
	out, err := s.service.UpdateControls(r.Context(), a.Account, r.PathValue("id"), in)
	respond(w, http.StatusOK, out, err)
}
func (s *Server) dispute(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in DisputeInput
	if !decodeBody(w, body, &in) {
		return
	}
	out, err := s.service.OpenDispute(a.Account, r.PathValue("id"), in)
	respond(w, http.StatusCreated, out, err)
}
func (s *Server) aiRun(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in AIRunInput
	if !decodeBody(w, body, &in) {
		return
	}
	out, err := s.service.RunAI(r.Context(), a.Account, in)
	respond(w, http.StatusCreated, out, err)
}
func (s *Server) aiReview(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in struct {
		Decision string `json:"decision"`
	}
	if !decodeBody(w, body, &in) {
		return
	}
	out, err := s.service.ReviewAI(a.Account, strings.TrimSpace(r.PathValue("id")), in.Decision)
	respond(w, http.StatusOK, out, err)
}

func (s *Server) providerEvent(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	var in ProviderEventInput
	if !decodeBody(w, body, &in) {
		return
	}
	timestamp, err := time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Provider-Timestamp"))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid provider timestamp")
		return
	}
	out, err := s.service.AcceptProviderEvent(in, timestamp, r.Header.Get("X-YNX-Provider-Signature"))
	respond(w, http.StatusCreated, out, err)
}

func readBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if r.Body == nil {
		return []byte{}, true
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, MaxBodyBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "unable to read request")
		return nil, false
	}
	if len(raw) > MaxBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "request exceeds card product policy")
		return nil, false
	}
	return raw, true
}
func decodeBody(w http.ResponseWriter, raw []byte, out any) bool {
	if len(raw) == 0 {
		writeError(w, http.StatusBadRequest, "one bounded JSON object is required")
		return false
	}
	if err := decodeStrict(raw, out); err != nil {
		writeError(w, http.StatusBadRequest, "request body must be one strict JSON object")
		return false
	}
	return true
}
func respond(w http.ResponseWriter, success int, value any, err error) {
	if err == nil {
		writeJSON(w, success, value)
		return
	}
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, ErrInvalid):
		status = http.StatusBadRequest
	case errors.Is(err, ErrUnauthorized), errors.Is(err, ErrGatewayUnauthorized):
		status = http.StatusUnauthorized
	case errors.Is(err, ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, ErrConflict):
		status = http.StatusConflict
	case errors.Is(err, ErrProviderUnavailable):
		status = http.StatusServiceUnavailable
	}
	writeError(w, status, err.Error())
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
