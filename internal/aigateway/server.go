package aigateway

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

func NewServer(service *Service) *Server {
	return NewServerWithBuild(service, buildinfo.Info{})
}

func NewServerWithBuild(service *Service, build buildinfo.Info) *Server {
	s := &Server{service: service, build: buildinfo.Normalize(build), mux: http.NewServeMux()}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler { return s.mux }

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
	s.mux.HandleFunc("GET /ai/stream", s.handleStream)
	s.mux.HandleFunc("POST /ai/permissions", s.handleProxy)
	s.mux.HandleFunc("GET /ai/permissions/{id}", s.handleProxy)
	s.mux.HandleFunc("POST /ai/actions", s.handleProxy)
	s.mux.HandleFunc("GET /ai/actions", s.handleProxy)
	s.mux.HandleFunc("GET /ai/actions/{id}", s.handleProxy)
	s.mux.HandleFunc("POST /ai/actions/{id}/approve", s.handleProxy)
	s.mux.HandleFunc("POST /ai/actions/{id}/reject", s.handleProxy)
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
	labels := fmt.Sprintf(`service="ynx-ai-gatewayd",native_symbol="YNXT",model="%s"`, metricValue(health.Model))
	_, _ = fmt.Fprintf(w, "ynx_ai_gateway_requests_total{%s} %d\n", labels, health.Requests)
	_, _ = fmt.Fprintf(w, "ynx_ai_gateway_successes_total{%s} %d\n", labels, health.Successes)
	_, _ = fmt.Fprintf(w, "ynx_ai_gateway_denied_total{%s} %d\n", labels, health.Denied)
	_, _ = fmt.Fprintf(w, "ynx_ai_gateway_errors_total{%s} %d\n", labels, health.Errors)
	_, _ = fmt.Fprintf(w, "ynx_ai_gateway_active_requests{%s} %d\n", labels, health.Active)
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	requestID, accessKey, ok := s.authorize(w, r)
	if !ok {
		return
	}
	session, query := strings.TrimSpace(r.URL.Query().Get("session")), strings.TrimSpace(r.URL.Query().Get("q"))
	if session == "" || query == "" {
		s.service.RejectRequest()
		s.finish(w, r, requestID, session, PromptHash(query), http.StatusBadRequest, "invalid_request", "session and q are required")
		return
	}
	if len(session) > 128 || len(query) > 8000 {
		s.service.RejectRequest()
		s.finish(w, r, requestID, session, PromptHash(query), http.StatusBadRequest, "invalid_request", "session or q exceeds limits")
		return
	}
	if !s.service.Allow(r.RemoteAddr, accessKey, time.Now().UTC()) {
		s.service.RejectRequest()
		s.finish(w, r, requestID, session, PromptHash(query), http.StatusTooManyRequests, "rate_limited", "AI Gateway rate limit exceeded")
		return
	}
	s.service.StartRequest()
	answer, err := s.service.Complete(r.Context(), session, query, requestID)
	if err != nil {
		s.service.FinishRequest(http.StatusBadGateway)
		s.audit(r, requestID, session, PromptHash(query), http.StatusBadGateway, "upstream_error")
		writeError(w, http.StatusBadGateway, requestID, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Request-ID", requestID)
	_, _ = fmt.Fprintf(w, "event: metadata\ndata: {\"requestId\":%q,\"sessionId\":%q}\n\n", requestID, session)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	for _, chunk := range streamChunks(answer, 96) {
		payload, _ := json.Marshal(map[string]string{"text": chunk})
		_, _ = fmt.Fprintf(w, "event: token\ndata: %s\n\n", payload)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}
	_, _ = fmt.Fprintf(w, "event: done\ndata: {\"requestId\":%q}\n\n", requestID)
	s.service.FinishRequest(http.StatusOK)
	s.audit(r, requestID, session, PromptHash(query), http.StatusOK, "streamed")
}

func (s *Server) handleProxy(w http.ResponseWriter, r *http.Request) {
	requestID, accessKey, ok := s.authorize(w, r)
	if !ok {
		return
	}
	if !s.service.Allow(r.RemoteAddr, accessKey, time.Now().UTC()) {
		s.service.RejectRequest()
		s.finish(w, r, requestID, "", "", http.StatusTooManyRequests, "rate_limited", "AI Gateway rate limit exceeded")
		return
	}
	s.service.StartRequest()
	resp, err := s.service.Proxy(r.Context(), r.Method, r.URL.Path, r.URL.RawQuery, r.Body, requestID)
	if err != nil {
		s.service.FinishRequest(http.StatusBadGateway)
		s.audit(r, requestID, "", "", http.StatusBadGateway, "upstream_error")
		writeError(w, http.StatusBadGateway, requestID, err.Error())
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.Header().Set("X-Request-ID", requestID)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, maxBodyBytes))
	s.service.FinishRequest(resp.StatusCode)
	outcome := "proxied"
	if resp.StatusCode >= 400 {
		outcome = "upstream_rejected"
	}
	s.audit(r, requestID, "", "", resp.StatusCode, outcome)
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	requestID := NewRequestID()
	accessKey := r.Header.Get("X-YNX-AI-Key")
	if accessKey == "" {
		accessKey = r.Header.Get("Authorization")
	}
	if !s.service.Authorized(accessKey) {
		s.service.RejectRequest()
		s.audit(r, requestID, "", "", http.StatusUnauthorized, "unauthorized")
		writeError(w, http.StatusUnauthorized, requestID, "valid AI Gateway API key required")
		return requestID, "", false
	}
	return requestID, strings.TrimSpace(strings.TrimPrefix(accessKey, "Bearer ")), true
}

func (s *Server) finish(w http.ResponseWriter, r *http.Request, requestID, session, promptHash string, status int, outcome, message string) {
	s.audit(r, requestID, session, promptHash, status, outcome)
	writeError(w, status, requestID, message)
}

func (s *Server) audit(r *http.Request, requestID, session, promptHash string, status int, outcome string) {
	_ = s.service.Audit(AuditEntry{RequestID: requestID, At: time.Now().UTC(), RemoteIP: r.RemoteAddr, Method: r.Method, Path: r.URL.Path, SessionID: session, PromptHash: promptHash, Status: status, Outcome: outcome})
}

func streamChunks(value string, max int) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	chunks := make([]string, 0, (len(value)/max)+1)
	for len(value) > max {
		cut := strings.LastIndex(value[:max], " ")
		if cut < max/2 {
			cut = max
		}
		chunks = append(chunks, value[:cut])
		value = strings.TrimSpace(value[cut:])
	}
	if value != "" {
		chunks = append(chunks, value)
	}
	return chunks
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

func metricValue(value string) string {
	return strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "\n", "\\n").Replace(value)
}
