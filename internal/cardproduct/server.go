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
	service       *Service
	mux           *http.ServeMux
	build         buildinfo.Info
	observability *observability
}

func NewServer(service *Service, build buildinfo.Info) *Server {
	return NewServerWithObservability(service, build, ObservabilityConfig{})
}

func NewServerWithObservability(service *Service, build buildinfo.Info, config ObservabilityConfig) *Server {
	s := &Server{service: service, mux: http.NewServeMux(), build: buildinfo.Normalize(build), observability: newObservability(config)}
	s.routes()
	return s
}
func (s *Server) Handler() http.Handler { return securityHeaders(s.observability.middleware(s.mux)) }
func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("GET /ready", s.ready)
	s.mux.HandleFunc("GET /version", s.version)
	s.mux.HandleFunc("GET /metrics", s.metrics)
	s.mux.HandleFunc("GET /v1/account/state", s.protected(s.state))
	s.mux.HandleFunc("GET /v1/account/export", s.protected(s.accountExport))
	s.mux.HandleFunc("POST /v1/account/retention", s.protected(s.accountRetention))
	s.mux.HandleFunc("DELETE /v1/account/data", s.protectedWithScopes(CardDeleteScopes, s.accountDelete))
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
	s.observability.recordProviderAvailability(r.Context(), available)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": map[bool]string{true: "healthy", false: "degraded"}[available], "service": "ynx-card-productd", "productId": ProductID, "clientId": ClientID, "bundleId": BundleID, "network": Network, "issuerProvider": s.service.ProviderName(), "issuerAvailable": available, "providerCapabilities": s.service.ProviderCapabilities(), "cardCapability": map[bool]string{true: "sandbox_testnet_only", false: "provider_unavailable"}[available], "sensitiveData": "ynx-never-persists-pan-cvv-pin-track-or-raw-identity", "build": s.build})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	available := s.service.ProviderAvailable(r.Context())
	s.observability.recordProviderAvailability(r.Context(), available)
	status := http.StatusOK
	if !available {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{
		"ready":                available,
		"service":              "ynx-card-productd",
		"issuerProvider":       s.service.ProviderName(),
		"issuerAvailable":      available,
		"providerCapabilities": s.service.ProviderCapabilities(),
		"cardCapability":       map[bool]string{true: "sandbox_testnet_only", false: "provider_unavailable"}[available],
		"failureSemantics":     map[bool]string{true: "none", false: "fail_closed"}[available],
		"sensitiveDataMode":    s.service.ProviderCapabilities().SecureDisplay,
	})
}

func (s *Server) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"service":                  "ynx-card-productd",
		"productId":                ProductID,
		"clientId":                 ClientID,
		"bundleId":                 BundleID,
		"stateVersion":             StateVersion,
		"providerCapabilitySchema": ProviderCapabilitySchema,
		"providerCapabilities":     s.service.ProviderCapabilities(),
		"observabilitySchema":      "ynx.card.observability.v1",
		"dataLifecycleSchema":      DataLifecycleSchema,
		"retention":                s.service.retention.Disclosure(),
		"build":                    s.build,
	})
}

func (s *Server) metrics(w http.ResponseWriter, _ *http.Request) {
	s.observability.renderMetrics(w)
}

type protectedHandler func(http.ResponseWriter, *http.Request, GatewayAssertion, []byte)

func (s *Server) protected(next protectedHandler) http.HandlerFunc {
	return s.protectedWithScopes(CardScopes, next)
}

func (s *Server) protectedWithScopes(requiredScopes []string, next protectedHandler) http.HandlerFunc {
	scopes := append([]string(nil), requiredScopes...)
	return func(w http.ResponseWriter, r *http.Request) {
		body, ok := s.readBody(w, r)
		if !ok {
			return
		}
		assertion, err := s.service.gateway.VerifyForScopes(r, body, scopes)
		if err != nil {
			s.writeError(w, r, http.StatusUnauthorized, err.Error())
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		next(w, r, assertion, body)
	}
}
func (s *Server) state(w http.ResponseWriter, r *http.Request, a GatewayAssertion, _ []byte) {
	out, err := s.service.State(a.Account)
	s.respond(w, r, http.StatusOK, out, err)
}
func (s *Server) accountExport(w http.ResponseWriter, r *http.Request, a GatewayAssertion, _ []byte) {
	out, err := s.service.ExportAccount(r.Context(), a.Account)
	s.respond(w, r, http.StatusOK, out, err)
}
func (s *Server) accountRetention(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in struct{}
	if !s.decodeBody(w, r, body, &in) {
		return
	}
	out, err := s.service.EnforceAccountRetention(r.Context(), a.Account)
	s.respond(w, r, http.StatusOK, out, err)
}
func (s *Server) accountDelete(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in DeleteAccountInput
	if !s.decodeBody(w, r, body, &in) {
		return
	}
	out, err := s.service.DeleteAccount(r.Context(), a.Account, in)
	out.IdempotencyDigest = ""
	s.respond(w, r, http.StatusOK, out, err)
}
func (s *Server) apply(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in ApplyInput
	if !s.decodeBody(w, r, body, &in) {
		return
	}
	out, err := s.service.Apply(r.Context(), a.Account, in)
	s.respond(w, r, http.StatusCreated, out, err)
}
func (s *Server) action(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in struct {
		Action         string `json:"action"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !s.decodeBody(w, r, body, &in) {
		return
	}
	out, err := s.service.Transition(r.Context(), a.Account, r.PathValue("id"), in.Action, in.IdempotencyKey)
	s.respond(w, r, http.StatusOK, out, err)
}
func (s *Server) controls(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in ControlsInput
	if !s.decodeBody(w, r, body, &in) {
		return
	}
	out, err := s.service.UpdateControls(r.Context(), a.Account, r.PathValue("id"), in)
	s.respond(w, r, http.StatusOK, out, err)
}
func (s *Server) dispute(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in DisputeInput
	if !s.decodeBody(w, r, body, &in) {
		return
	}
	out, err := s.service.OpenDisputeWithContext(r.Context(), a.Account, r.PathValue("id"), in)
	s.respond(w, r, http.StatusCreated, out, err)
}
func (s *Server) aiRun(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in AIRunInput
	if !s.decodeBody(w, r, body, &in) {
		return
	}
	out, err := s.service.RunAI(r.Context(), a.Account, in)
	s.respond(w, r, http.StatusCreated, out, err)
}
func (s *Server) aiReview(w http.ResponseWriter, r *http.Request, a GatewayAssertion, body []byte) {
	var in struct {
		Decision string `json:"decision"`
	}
	if !s.decodeBody(w, r, body, &in) {
		return
	}
	out, err := s.service.ReviewAIWithContext(r.Context(), a.Account, strings.TrimSpace(r.PathValue("id")), in.Decision)
	s.respond(w, r, http.StatusOK, out, err)
}

func (s *Server) providerEvent(w http.ResponseWriter, r *http.Request) {
	body, ok := s.readBody(w, r)
	if !ok {
		return
	}
	var in ProviderEventInput
	if !s.decodeBody(w, r, body, &in) {
		return
	}
	timestamp, err := time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Provider-Timestamp"))
	if err != nil {
		s.writeError(w, r, http.StatusUnauthorized, "invalid provider timestamp")
		return
	}
	keyID := strings.TrimSpace(r.Header.Get("X-YNX-Provider-Key-ID"))
	if keyID == "" {
		keyID = DefaultProviderEventKeyID
	}
	out, err := s.service.AcceptProviderEventWithKeyIDContext(r.Context(), in, timestamp, keyID, r.Header.Get("X-YNX-Provider-Signature"))
	s.respond(w, r, http.StatusCreated, out, err)
}

func (s *Server) readBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if r.Body == nil {
		return []byte{}, true
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, MaxBodyBytes+1))
	if err != nil {
		s.writeError(w, r, http.StatusBadRequest, "unable to read request")
		return nil, false
	}
	if len(raw) > MaxBodyBytes {
		s.writeError(w, r, http.StatusRequestEntityTooLarge, "request exceeds card product policy")
		return nil, false
	}
	return raw, true
}

func (s *Server) decodeBody(w http.ResponseWriter, r *http.Request, raw []byte, out any) bool {
	if len(raw) == 0 {
		s.writeError(w, r, http.StatusBadRequest, "one bounded JSON object is required")
		return false
	}
	if err := decodeStrict(raw, out); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "request body must be one strict JSON object")
		return false
	}
	return true
}

func (s *Server) respond(w http.ResponseWriter, r *http.Request, success int, value any, err error) {
	if err == nil {
		if auditID := AuditIDFromContext(r.Context()); auditID != "" {
			w.Header().Set(AuditIDHeader, auditID)
		}
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
	s.writeError(w, r, status, err.Error())
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
func (s *Server) writeError(w http.ResponseWriter, r *http.Request, status int, internalMessage string) {
	code := cardErrorCode(status)
	errorID := s.observability.newID("error")
	requestID := RequestIDFromContext(r.Context())
	traceID := TraceIDFromContext(r.Context())
	s.observability.writeLog(map[string]any{
		"at":          s.observability.now().UTC().Format(time.RFC3339Nano),
		"level":       map[bool]string{true: "error", false: "warn"}[status >= 500],
		"event":       "http_error",
		"service":     "ynx-card-productd",
		"requestId":   requestID,
		"traceId":     traceID,
		"errorId":     errorID,
		"errorCode":   code,
		"status":      status,
		"causeDigest": hashBytes([]byte(internalMessage))[:16],
	})
	w.Header().Set(ErrorIDHeader, errorID)
	w.Header().Set(ErrorCodeHeader, code)
	writeJSON(w, status, map[string]string{
		"error":     publicCardErrorMessage(status),
		"code":      code,
		"requestId": requestID,
		"traceId":   traceID,
		"errorId":   errorID,
	})
}

func cardErrorCode(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "CARD_INVALID_REQUEST"
	case http.StatusUnauthorized:
		return "CARD_UNAUTHORIZED"
	case http.StatusNotFound:
		return "CARD_NOT_FOUND"
	case http.StatusConflict:
		return "CARD_CONFLICT"
	case http.StatusRequestEntityTooLarge:
		return "CARD_REQUEST_TOO_LARGE"
	case http.StatusServiceUnavailable:
		return "CARD_PROVIDER_UNAVAILABLE"
	default:
		return "CARD_INTERNAL"
	}
}

func publicCardErrorMessage(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "invalid card product request"
	case http.StatusUnauthorized:
		return "card product authorization failed"
	case http.StatusNotFound:
		return "card product record not found"
	case http.StatusConflict:
		return "card product state conflict"
	case http.StatusRequestEntityTooLarge:
		return "request exceeds card product policy"
	case http.StatusServiceUnavailable:
		return "issuer provider unavailable"
	default:
		return "internal card product error"
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
