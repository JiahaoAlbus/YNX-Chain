package stablecoinissuer

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
	s.mux.HandleFunc("POST /stablecoin/issuers", s.requireAuth(s.handleSubmitIssuer))
	s.mux.HandleFunc("GET /stablecoin/issuers", s.requireAuth(s.handleListIssuers))
	s.mux.HandleFunc("GET /stablecoin/issuers/{id}", s.requireAuth(s.handleGetIssuer))
	s.mux.HandleFunc("POST /stablecoin/issuers/{id}/review", s.requireAuth(s.handleReviewIssuer))
	s.mux.HandleFunc("POST /stablecoin/issuers/{id}/revoke", s.requireAuth(s.handleRevokeIssuer))
	s.mux.HandleFunc("POST /stablecoin/assets", s.requireAuth(s.handleSubmitAsset))
	s.mux.HandleFunc("GET /stablecoin/assets", s.requireAuth(s.handleListAssets))
	s.mux.HandleFunc("GET /stablecoin/assets/{id}", s.requireAuth(s.handleGetAsset))
	s.mux.HandleFunc("POST /stablecoin/assets/{id}/review", s.requireAuth(s.handleReviewAsset))
	s.mux.HandleFunc("POST /stablecoin/assets/{id}/revoke", s.requireAuth(s.handleRevokeAsset))
	s.mux.HandleFunc("POST /stablecoin/assets/{id}/intents", s.requireAuth(s.handleCreateIntent))
	s.mux.HandleFunc("GET /stablecoin/intents", s.requireAuth(s.handleListIntents))
	s.mux.HandleFunc("GET /stablecoin/intents/{id}", s.requireAuth(s.handleGetIntent))
	s.mux.HandleFunc("GET /stablecoin/audit", s.requireAuth(s.handleAudit))
	s.mux.HandleFunc("GET /stablecoin/transparency", s.requireAuth(s.handleTransparency))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.service.Health(s.build))
}

func (s *Server) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	health := s.service.Health(s.build)
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	labels := `service="ynx-stablecoind",native_symbol="YNXT",external_execution="false"`
	_, _ = fmt.Fprintf(w, "ynx_stablecoin_issuers_total{%s} %d\n", labels, health.IssuerCount)
	_, _ = fmt.Fprintf(w, "ynx_stablecoin_approved_issuers_total{%s} %d\n", labels, health.ApprovedIssuerCount)
	_, _ = fmt.Fprintf(w, "ynx_stablecoin_assets_total{%s} %d\n", labels, health.AssetCount)
	_, _ = fmt.Fprintf(w, "ynx_stablecoin_approved_assets_total{%s} %d\n", labels, health.ApprovedAssetCount)
	_, _ = fmt.Fprintf(w, "ynx_stablecoin_revoked_assets_total{%s} %d\n", labels, health.RevokedAssetCount)
	_, _ = fmt.Fprintf(w, "ynx_stablecoin_intents_total{%s} %d\n", labels, health.IntentCount)
	_, _ = fmt.Fprintf(w, "ynx_stablecoin_audit_events_total{%s} %d\n", labels, health.AuditEventCount)
	_, _ = fmt.Fprintf(w, "ynx_stablecoin_external_execution_enabled{%s} 0\n", labels)
	_, _ = fmt.Fprintf(w, "ynx_stablecoin_native_ynxt_issuer_actions_allowed{%s} 0\n", labels)
}

func (s *Server) handleSubmitIssuer(w http.ResponseWriter, r *http.Request) {
	var request SubmitIssuerRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.SubmitIssuer(request)
	writeMutation(w, result, err, http.StatusCreated)
}

func (s *Server) handleReviewIssuer(w http.ResponseWriter, r *http.Request) {
	var request ReviewRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.ReviewIssuer(r.PathValue("id"), request)
	writeMutation(w, result, err, http.StatusOK)
}

func (s *Server) handleRevokeIssuer(w http.ResponseWriter, r *http.Request) {
	var request RevokeRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.RevokeIssuer(r.PathValue("id"), request)
	writeMutation(w, result, err, http.StatusOK)
}

func (s *Server) handleSubmitAsset(w http.ResponseWriter, r *http.Request) {
	var request SubmitAssetRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.SubmitAsset(request)
	writeMutation(w, result, err, http.StatusCreated)
}

func (s *Server) handleReviewAsset(w http.ResponseWriter, r *http.Request) {
	var request ReviewRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.ReviewAsset(r.PathValue("id"), request)
	writeMutation(w, result, err, http.StatusOK)
}

func (s *Server) handleRevokeAsset(w http.ResponseWriter, r *http.Request) {
	var request RevokeRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.RevokeAsset(r.PathValue("id"), request)
	writeMutation(w, result, err, http.StatusOK)
}

func (s *Server) handleCreateIntent(w http.ResponseWriter, r *http.Request) {
	var request CreateIntentRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.CreateIntent(r.PathValue("id"), request)
	writeMutation(w, result, err, http.StatusCreated)
}

func (s *Server) handleGetIssuer(w http.ResponseWriter, r *http.Request) {
	item, err := s.service.GetIssuer(r.PathValue("id"))
	writeRecord(w, item, err)
}

func (s *Server) handleGetAsset(w http.ResponseWriter, r *http.Request) {
	item, err := s.service.GetAsset(r.PathValue("id"))
	writeRecord(w, item, err)
}

func (s *Server) handleGetIntent(w http.ResponseWriter, r *http.Request) {
	item, err := s.service.GetIntent(r.PathValue("id"))
	writeRecord(w, item, err)
}

func (s *Server) handleListIssuers(w http.ResponseWriter, r *http.Request) {
	limit, ok := queryLimit(w, r)
	if !ok {
		return
	}
	items := s.service.ListIssuers(strings.TrimSpace(r.URL.Query().Get("after")), limit)
	writeJSON(w, http.StatusOK, map[string]any{"issuers": items, "count": len(items)})
}

func (s *Server) handleListAssets(w http.ResponseWriter, r *http.Request) {
	limit, ok := queryLimit(w, r)
	if !ok {
		return
	}
	items := s.service.ListAssets(strings.TrimSpace(r.URL.Query().Get("after")), limit)
	writeJSON(w, http.StatusOK, map[string]any{"assets": items, "count": len(items)})
}

func (s *Server) handleListIntents(w http.ResponseWriter, r *http.Request) {
	limit, ok := queryLimit(w, r)
	if !ok {
		return
	}
	items := s.service.ListIntents(strings.TrimSpace(r.URL.Query().Get("after")), limit)
	writeJSON(w, http.StatusOK, map[string]any{"intents": items, "count": len(items)})
}

func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request) {
	limit, ok := queryLimit(w, r)
	if !ok {
		return
	}
	after := uint64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("after")); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "after must be a uint64"})
			return
		}
		after = value
	}
	items := s.service.Audit(after, limit)
	writeJSON(w, http.StatusOK, map[string]any{"events": items, "count": len(items)})
}

func (s *Server) handleTransparency(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.service.Transparency())
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value := r.Header.Get("X-YNX-Stablecoin-Key")
		if value == "" {
			value = r.Header.Get("Authorization")
		}
		if !s.service.Authorized(value) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "valid Stablecoin control API key required"})
			return
		}
		next(w, r)
	}
}

func writeMutation[T any](w http.ResponseWriter, result MutationResult[T], err error, createdStatus int) {
	if err != nil {
		writeServiceError(w, err)
		return
	}
	status := createdStatus
	if result.Replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, result)
}

func writeRecord[T any](w http.ResponseWriter, record T, err error) {
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, record)
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
	case errors.Is(err, ErrConflict), errors.Is(err, ErrNotApproved):
		status = http.StatusConflict
	}
	message := err.Error()
	if status == http.StatusInternalServerError {
		message = "stablecoin control persistence unavailable"
	}
	writeJSON(w, status, map[string]string{"error": message})
}

func queryLimit(w http.ResponseWriter, r *http.Request) (int, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("limit"))
	if raw == "" {
		return 50, true
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > MaxListLimit {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("limit must be between 1 and %d", MaxListLimit)})
		return 0, false
	}
	return value, true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
