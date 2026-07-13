package bridgegateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

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
	s.mux.HandleFunc("POST /bridge/transfers", s.requireAuth(s.handleCreate))
	s.mux.HandleFunc("GET /bridge/transfers", s.requireAuth(s.handleList))
	s.mux.HandleFunc("GET /bridge/transfers/{id}", s.requireAuth(s.handleGet))
	s.mux.HandleFunc("POST /bridge/transfers/{id}/attestations", s.requireAuth(s.handleAttest))
	s.mux.HandleFunc("POST /bridge/transfers/{id}/finalize", s.requireAuth(s.handleFinalize))
	s.mux.HandleFunc("GET /bridge/audit", s.requireAuth(s.handleAudit))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.service.Health(s.build))
}

func (s *Server) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	health := s.service.Health(s.build)
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	labels := `service="ynx-bridged",native_symbol="YNXT",live_bridge="false"`
	_, _ = fmt.Fprintf(w, "ynx_bridge_transfers_total{%s} %d\n", labels, health.TransferCount)
	_, _ = fmt.Fprintf(w, "ynx_bridge_ready_total{%s} %d\n", labels, health.ReadyCount)
	_, _ = fmt.Fprintf(w, "ynx_bridge_finalized_local_total{%s} %d\n", labels, health.FinalizedLocalCount)
	_, _ = fmt.Fprintf(w, "ynx_bridge_audit_events_total{%s} %d\n", labels, health.AuditEventCount)
	_, _ = fmt.Fprintf(w, "ynx_bridge_external_submission_enabled{%s} 0\n", labels)
}

func (s *Server) handleCreate(w http.ResponseWriter, r *http.Request) {
	var request CreateTransferRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.CreateTransfer(request)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, result)
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	transfer, err := s.service.Get(r.PathValue("id"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, transfer)
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	limit, err := boundedInt(r.URL.Query().Get("limit"), 50)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	items := s.service.List(strings.TrimSpace(r.URL.Query().Get("after")), limit)
	writeJSON(w, http.StatusOK, map[string]any{"transfers": items, "count": len(items)})
}

func (s *Server) handleAttest(w http.ResponseWriter, r *http.Request) {
	var request AttestationRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.AddAttestation(r.PathValue("id"), request)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, result)
}

func (s *Server) handleFinalize(w http.ResponseWriter, r *http.Request) {
	var request FinalizeRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.Finalize(r.PathValue("id"), request)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request) {
	limit, err := boundedInt(r.URL.Query().Get("limit"), 50)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	after := uint64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("after")); raw != "" {
		after, err = strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "after must be a uint64"})
			return
		}
	}
	items := s.service.Audit(after, limit)
	writeJSON(w, http.StatusOK, map[string]any{"events": items, "count": len(items)})
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value := r.Header.Get("X-YNX-Bridge-Key")
		if value == "" {
			value = r.Header.Get("Authorization")
		}
		if !s.service.Authorized(value) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "valid Bridge API key required"})
			return
		}
		next(w, r)
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, MaxRequestBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid bounded json request"})
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request must contain one json object"})
		return false
	}
	return true
}

func writeServiceError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, ErrInvalid):
		status = http.StatusBadRequest
	case errors.Is(err, ErrUnauthorizedRelayer):
		status = http.StatusForbidden
	case errors.Is(err, ErrConflict), errors.Is(err, ErrInsufficientQuorum):
		status = http.StatusConflict
	}
	message := err.Error()
	if status == http.StatusInternalServerError {
		message = "bridge persistence unavailable"
	}
	writeJSON(w, status, map[string]string{"error": message})
}

func boundedInt(raw string, fallback int) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > MaxListLimit {
		return 0, fmt.Errorf("limit must be between 1 and %d", MaxListLimit)
	}
	return value, nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
