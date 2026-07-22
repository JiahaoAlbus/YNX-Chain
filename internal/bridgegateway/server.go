package bridgegateway

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

var traceparentPattern = regexp.MustCompile(`^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$`)

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

func (s *Server) Handler() http.Handler { return s.observeAndLimit(s.mux) }

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *statusWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func (s *Server) observeAndLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := newRequestID()
		traceID, responseTraceparent := traceContext(r.Header.Get("traceparent"))
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("X-Trace-ID", traceID)
		w.Header().Set("traceparent", responseTraceparent)
		started := time.Now()
		accessKey := r.Header.Get("X-YNX-Bridge-Key")
		if accessKey == "" {
			accessKey = r.Header.Get("Authorization")
		}
		writer := &statusWriter{ResponseWriter: w}
		if !s.service.Allow(r.RemoteAddr, accessKey, started.UTC()) {
			writeJSON(writer, http.StatusTooManyRequests, map[string]string{"error": "Bridge API rate limit exceeded"})
		} else {
			next.ServeHTTP(writer, r)
		}
		status := writer.status
		if status == 0 {
			status = http.StatusOK
		}
		pattern := r.Pattern
		if pattern == "" {
			pattern = "unmatched"
		}
		slog.Info("bridge_http_request", "request_id", requestID, "trace_id", traceID, "method", r.Method, "route", pattern, "status", status, "duration_ms", time.Since(started).Milliseconds())
	})
}

func newRequestID() string {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err == nil {
		return "breq_" + hex.EncodeToString(raw)
	}
	return "breq_" + hashText(time.Now().UTC().Format(time.RFC3339Nano))[:24]
}

func traceContext(incoming string) (string, string) {
	traceID := ""
	flags := "01"
	if match := traceparentPattern.FindStringSubmatch(strings.ToLower(strings.TrimSpace(incoming))); len(match) == 4 && match[1] != strings.Repeat("0", 32) && match[2] != strings.Repeat("0", 16) {
		traceID = match[1]
		flags = match[3]
	}
	if traceID == "" {
		traceID = randomHex(16)
	}
	spanID := randomHex(8)
	return traceID, "00-" + traceID + "-" + spanID + "-" + flags
}

func randomHex(size int) string {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err == nil {
		return hex.EncodeToString(raw)
	}
	return hashText(time.Now().UTC().Format(time.RFC3339Nano) + "|" + strconv.Itoa(size))[:size*2]
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
	s.mux.HandleFunc("GET /bridge/transparency", s.handleTransparency)
	s.mux.HandleFunc("GET /bridge/routes", s.handleRoutes)
	s.mux.HandleFunc("GET /bridge/assets", s.handleAssets)
	s.mux.HandleFunc("POST /bridge/transfers", s.requireAuth(s.handleCreate))
	s.mux.HandleFunc("GET /bridge/transfers", s.requireAuth(s.handleList))
	s.mux.HandleFunc("GET /bridge/transfers/{id}", s.requireAuth(s.handleGet))
	s.mux.HandleFunc("POST /bridge/transfers/{id}/attestations", s.requireAuth(s.handleAttest))
	s.mux.HandleFunc("POST /bridge/transfers/{id}/finalize", s.requireAuth(s.handleFinalize))
	s.mux.HandleFunc("POST /bridge/transfers/{id}/outcomes", s.requireAuth(s.handleOutcome))
	s.mux.HandleFunc("POST /bridge/safety", s.requireAuth(s.handleSafety))
	s.mux.HandleFunc("POST /bridge/reconciliations", s.requireAuth(s.handleReconciliation))
	s.mux.HandleFunc("GET /bridge/audit", s.requireAuth(s.handleAudit))
	s.mux.HandleFunc("GET /bridge/data-exports/{account}", s.requireAuth(s.handleDataExport))
	s.mux.HandleFunc("POST /bridge/data-deletion-requests", s.requireAuth(s.handleDataDeletionRequest))
	s.mux.HandleFunc("POST /bridge/data-deletion-requests/{id}/execute", s.requireAuth(s.handleDataDeletionExecute))
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
	paused := 0
	if health.Safety.Paused {
		paused = 1
	}
	_, _ = fmt.Fprintf(w, "ynx_bridge_paused{%s} %d\n", labels, paused)
	var exposure uint64
	for _, route := range s.service.Transparency().Routes {
		value, _ := strconv.ParseUint(route.CoordinatorOutstanding, 10, 64)
		exposure += value
		routeLabels := fmt.Sprintf(`%s,provider="%s",source_chain="%s",destination_chain="%s",source_asset="%s",destination_asset="%s"`, labels, route.Route.Provider, route.Route.SourceChain, route.Route.DestinationChain, route.Route.SourceAsset, route.Route.DestinationAsset)
		limit, _ := strconv.ParseUint(route.Route.MaxOutstanding, 10, 64)
		_, _ = fmt.Fprintf(w, "ynx_bridge_route_outstanding{%s} %d\n", routeLabels, value)
		_, _ = fmt.Fprintf(w, "ynx_bridge_route_outstanding_limit{%s} %d\n", routeLabels, limit)
		if route.LastReconciliation != nil {
			balanced := 0
			if route.LastReconciliation.Balanced {
				balanced = 1
			}
			recordedAt, _ := time.Parse(time.RFC3339Nano, route.LastReconciliation.RecordedAt)
			_, _ = fmt.Fprintf(w, "ynx_bridge_reconciliation_balanced{%s} %d\n", routeLabels, balanced)
			_, _ = fmt.Fprintf(w, "ynx_bridge_reconciliation_timestamp_seconds{%s} %d\n", routeLabels, recordedAt.Unix())
		}
	}
	_, _ = fmt.Fprintf(w, "ynx_bridge_coordinator_outstanding{%s} %d\n", labels, exposure)
	_, _ = fmt.Fprintf(w, "ynx_bridge_rate_limit_denied_total{%s} %d\n", labels, health.RateLimitDenied)
}

func (s *Server) handleTransparency(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.service.Transparency())
}

func (s *Server) handleRoutes(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.service.RouteCatalog())
}

func (s *Server) handleAssets(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.service.AssetCatalog())
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

func (s *Server) handleOutcome(w http.ResponseWriter, r *http.Request) {
	var request OutcomeRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.RecordOutcome(r.PathValue("id"), request)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSafety(w http.ResponseWriter, r *http.Request) {
	var request PauseRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	safety, replayed, err := s.service.SetPause(request)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"safety": safety, "replayed": replayed})
}

func (s *Server) handleReconciliation(w http.ResponseWriter, r *http.Request) {
	var request ReconciliationRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	reconciliation, replayed, err := s.service.Reconcile(request)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reconciliation": reconciliation, "replayed": replayed})
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

func (s *Server) handleDataExport(w http.ResponseWriter, r *http.Request) {
	exported, err := s.service.ExportAccount(r.PathValue("account"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, exported)
}

func (s *Server) handleDataDeletionRequest(w http.ResponseWriter, r *http.Request) {
	var request DataDeletionRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	record, replayed, err := s.service.RequestDataDeletion(request)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"request": record, "replayed": replayed})
}

func (s *Server) handleDataDeletionExecute(w http.ResponseWriter, r *http.Request) {
	var request DataDeletionExecuteRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	record, replayed, err := s.service.ExecuteDataDeletion(r.PathValue("id"), request)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"request": record, "replayed": replayed})
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
	if status >= 400 {
		requestID := w.Header().Get("X-Request-ID")
		errorID := "berr_" + hashText(requestID + "|" + strconv.Itoa(status))[:16]
		w.Header().Set("X-Error-ID", errorID)
		if original, ok := value.(map[string]string); ok {
			enriched := map[string]string{}
			for key, item := range original {
				enriched[key] = item
			}
			enriched["requestId"] = requestID
			enriched["errorId"] = errorID
			value = enriched
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
