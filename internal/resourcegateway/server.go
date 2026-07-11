package resourcegateway

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type Server struct {
	service *Service
	build   buildinfo.Info
	mux     *http.ServeMux
}

func NewServer(service *Service) *Server { return NewServerWithBuild(service, buildinfo.Info{}) }
func NewServerWithBuild(service *Service, build buildinfo.Info) *Server {
	s := &Server{service: service, build: buildinfo.Normalize(build), mux: http.NewServeMux()}
	s.routes()
	return s
}
func (s *Server) Handler() http.Handler { return s.mux }

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
	s.mux.HandleFunc("GET /resource-market/policy", s.handleProxy)
	s.mux.HandleFunc("GET /resource-market/quote", s.handleProxy)
	s.mux.HandleFunc("GET /resource-market/analytics", s.handleProxy)
	s.mux.HandleFunc("POST /resource-market/delegations", s.handleProxy)
	s.mux.HandleFunc("GET /resource-market/delegations/{address}", s.handleProxy)
	s.mux.HandleFunc("POST /resource-market/rent", s.handleProxy)
	s.mux.HandleFunc("GET /resource-market/income/{address}", s.handleProxy)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	health := s.service.Health(r.Context(), s.build)
	status := http.StatusOK
	if !health.OK {
		status = http.StatusBadGateway
	}
	writeJSON(w, status, health)
}
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	health := s.service.snapshotHealth(s.build)
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	labels := `service="ynx-resourced",native_symbol="YNXT"`
	_, _ = fmt.Fprintf(w, "ynx_resource_gateway_requests_total{%s} %d\n", labels, health.Requests)
	_, _ = fmt.Fprintf(w, "ynx_resource_gateway_successes_total{%s} %d\n", labels, health.Successes)
	_, _ = fmt.Fprintf(w, "ynx_resource_gateway_denied_total{%s} %d\n", labels, health.Denied)
	_, _ = fmt.Fprintf(w, "ynx_resource_gateway_errors_total{%s} %d\n", labels, health.Errors)
	_, _ = fmt.Fprintf(w, "ynx_resource_gateway_audit_errors_total{%s} %d\n", labels, health.AuditErrors)
	_, _ = fmt.Fprintf(w, "ynx_resource_gateway_active_requests{%s} %d\n", labels, health.Active)
}

func (s *Server) handleProxy(w http.ResponseWriter, r *http.Request) {
	requestID, accessKey, ok := s.authorize(w, r)
	if !ok {
		return
	}
	if !s.service.Allow(r.RemoteAddr, accessKey, time.Now().UTC()) {
		s.service.RejectRequest()
		s.finish(w, r, requestID, nil, http.StatusTooManyRequests, "rate_limited", "Resource API rate limit exceeded")
		return
	}
	var body []byte
	if r.Method != http.MethodGet {
		r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
		var err error
		body, err = io.ReadAll(r.Body)
		if err != nil {
			s.service.RejectRequest()
			status := http.StatusBadRequest
			if strings.Contains(err.Error(), "request body too large") {
				status = http.StatusRequestEntityTooLarge
			}
			s.finish(w, r, requestID, nil, status, "invalid_body", "request body exceeds limits or cannot be read")
			return
		}
		if !json.Valid(body) {
			s.service.RejectRequest()
			s.finish(w, r, requestID, body, http.StatusBadRequest, "invalid_json", "valid JSON request body required")
			return
		}
	}
	entry := AuditEntry{RequestID: requestID, At: time.Now().UTC(), RemoteIP: r.RemoteAddr, Method: r.Method, Path: r.URL.Path, BodyHash: BodyHash(body), Status: http.StatusAccepted, Outcome: "accepted"}
	if err := s.service.Audit(entry); err != nil {
		s.service.RejectRequest()
		writeError(w, http.StatusInternalServerError, requestID, "Resource audit storage unavailable")
		return
	}
	s.service.StartRequest()
	resp, err := s.service.Proxy(r.Context(), r.Method, r.URL.Path, r.URL.RawQuery, body, requestID)
	if err != nil {
		s.service.FinishRequest(http.StatusBadGateway)
		s.audit(r, requestID, body, http.StatusBadGateway, "upstream_error")
		writeError(w, http.StatusBadGateway, requestID, err.Error())
		return
	}
	if resp.ContentType != "" {
		w.Header().Set("Content-Type", resp.ContentType)
	}
	w.Header().Set("X-Request-ID", requestID)
	w.WriteHeader(resp.Status)
	_, _ = w.Write(resp.Body)
	s.service.FinishRequest(resp.Status)
	outcome := "proxied"
	if resp.Status >= 400 {
		outcome = "upstream_rejected"
	}
	s.audit(r, requestID, body, resp.Status, outcome)
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	requestID := NewRequestID()
	accessKey := r.Header.Get("X-YNX-Resource-Key")
	if accessKey == "" {
		accessKey = r.Header.Get("Authorization")
	}
	if !s.service.Authorized(accessKey) {
		s.service.RejectRequest()
		s.audit(r, requestID, nil, http.StatusUnauthorized, "unauthorized")
		writeError(w, http.StatusUnauthorized, requestID, "valid Resource API key required")
		return requestID, "", false
	}
	return requestID, strings.TrimSpace(strings.TrimPrefix(accessKey, "Bearer ")), true
}
func (s *Server) finish(w http.ResponseWriter, r *http.Request, requestID string, body []byte, status int, outcome, message string) {
	s.audit(r, requestID, body, status, outcome)
	writeError(w, status, requestID, message)
}
func (s *Server) audit(r *http.Request, requestID string, body []byte, status int, outcome string) {
	_ = s.service.Audit(AuditEntry{RequestID: requestID, At: time.Now().UTC(), RemoteIP: r.RemoteAddr, Method: r.Method, Path: r.URL.Path, BodyHash: BodyHash(body), Status: status, Outcome: outcome})
}
func writeError(w http.ResponseWriter, status int, requestID, message string) {
	w.Header().Set("X-Request-ID", requestID)
	writeJSON(w, status, map[string]string{"error": message, "requestId": requestID})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
