package quantlab

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

type requestContextKey uint8

const (
	requestIDKey requestContextKey = iota
	traceIDKey
)

type serverMetrics struct {
	requests, errors, forbidden, unavailable atomic.Uint64
	latencyNanos, responseBytes              atomic.Uint64
	activeWebSockets, kills, revokes         atomic.Uint64
	riskRejects                              atomic.Uint64
}

type observedWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *observedWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *observedWriter) Write(value []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	written, err := w.ResponseWriter.Write(value)
	w.bytes += written
	return written, err
}

func (w *observedWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("websocket hijacking unavailable")
	}
	return hijacker.Hijack()
}

func (w *observedWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *observedWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func newRequestIdentity(r *http.Request) *http.Request {
	requestID := strings.TrimSpace(r.Header.Get("X-YNX-Request-ID"))
	if !validCorrelationID(requestID) {
		requestID = randomHex(16)
	}
	traceID := traceIDFromParent(r.Header.Get("traceparent"))
	if traceID == "" {
		traceID = randomHex(16)
	}
	ctx := context.WithValue(r.Context(), requestIDKey, requestID)
	ctx = context.WithValue(ctx, traceIDKey, traceID)
	return r.WithContext(ctx)
}

func validCorrelationID(value string) bool {
	if len(value) < 8 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') && (character < '0' || character > '9') && character != '-' && character != '_' {
			return false
		}
	}
	return true
}

func traceIDFromParent(value string) string {
	parts := strings.Split(strings.TrimSpace(value), "-")
	if len(parts) != 4 || parts[0] != "00" || len(parts[1]) != 32 || len(parts[2]) != 16 || len(parts[3]) != 2 || parts[1] == strings.Repeat("0", 32) {
		return ""
	}
	if _, err := hex.DecodeString(parts[1] + parts[2] + parts[3]); err != nil {
		return ""
	}
	return strings.ToLower(parts[1])
}

func randomHex(bytes int) string {
	value := make([]byte, bytes)
	if _, err := rand.Read(value); err != nil {
		// Process-local fallback remains unpredictable across request timing and
		// is an observability identifier, never an authorization secret.
		return fmt.Sprintf("%032x", time.Now().UnixNano())
	}
	return hex.EncodeToString(value)
}

func requestID(r *http.Request) string {
	value, _ := r.Context().Value(requestIDKey).(string)
	return value
}

func traceID(r *http.Request) string {
	value, _ := r.Context().Value(traceIDKey).(string)
	return value
}

func (s *Server) observe(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	r = newRequestIdentity(r)
	w.Header().Set("X-YNX-Request-ID", requestID(r))
	w.Header().Set("X-YNX-Trace-ID", traceID(r))
	observed := &observedWriter{ResponseWriter: w}
	if r.Method != http.MethodGet && !localPreviewRequest(r) {
		writeProblem(observed, r, http.StatusForbidden, "local_write_boundary_rejected")
	} else {
		s.mux.ServeHTTP(observed, r)
	}
	status := observed.status
	if status == 0 {
		status = http.StatusOK
	}
	duration := time.Since(started)
	s.metrics.requests.Add(1)
	s.metrics.latencyNanos.Add(uint64(duration))
	s.metrics.responseBytes.Add(uint64(observed.bytes))
	if status >= 400 {
		s.metrics.errors.Add(1)
	}
	if status == http.StatusForbidden {
		s.metrics.forbidden.Add(1)
		if r.Pattern == "POST /v1/testnet/orders" {
			s.metrics.riskRejects.Add(1)
		}
	}
	if status == http.StatusServiceUnavailable {
		s.metrics.unavailable.Add(1)
	}
	if status < 300 && r.Pattern == "POST /v1/risk/kill" {
		s.metrics.kills.Add(1)
	}
	if status < 300 && r.Pattern == "POST /v1/testnet/mandates/{digest}/revoke" {
		s.metrics.revokes.Add(1)
	}
	s.logger.Info("quant_http_request", "requestId", requestID(r), "traceId", traceID(r), "errorId", observed.Header().Get("X-YNX-Error-ID"), "method", r.Method, "route", safeRoute(r.Pattern), "status", status, "durationMs", float64(duration.Microseconds())/1000, "responseBytes", observed.bytes, "serviceRole", s.role)
}

func safeRoute(pattern string) string {
	if strings.TrimSpace(pattern) == "" {
		return "unmatched"
	}
	return pattern
}

func (s *Server) metricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	metrics := []struct {
		name  string
		value uint64
	}{
		{"ynx_quant_http_requests_total", s.metrics.requests.Load()},
		{"ynx_quant_http_errors_total", s.metrics.errors.Load()},
		{"ynx_quant_http_forbidden_total", s.metrics.forbidden.Load()},
		{"ynx_quant_http_unavailable_total", s.metrics.unavailable.Load()},
		{"ynx_quant_http_latency_nanoseconds_total", s.metrics.latencyNanos.Load()},
		{"ynx_quant_http_response_bytes_total", s.metrics.responseBytes.Load()},
		{"ynx_quant_kill_switch_activations_total", s.metrics.kills.Load()},
		{"ynx_quant_mandate_revocations_total", s.metrics.revokes.Load()},
		{"ynx_quant_risk_rejections_total", s.metrics.riskRejects.Load()},
	}
	for _, metric := range metrics {
		_, _ = fmt.Fprintf(w, "# TYPE %s counter\n%s %d\n", metric.name, metric.name, metric.value)
	}
	_, _ = fmt.Fprintf(w, "# TYPE ynx_quant_websocket_active gauge\nynx_quant_websocket_active %d\n", s.metrics.activeWebSockets.Load())
	snapshot := s.service.Snapshot()
	if paper, ok := snapshot["paper"].(PaperState); ok {
		kill := 0
		if paper.KillSwitch {
			kill = 1
		}
		_, _ = fmt.Fprintf(w, "# TYPE ynx_quant_kill_switch_active gauge\nynx_quant_kill_switch_active %d\n# TYPE ynx_quant_reconciliation_delta gauge\nynx_quant_reconciliation_delta %d\n", kill, paper.ReconciliationDelta)
	}
	pending := 0
	if records, ok := snapshot["executionLedger"].(map[string]ExecutionLedgerRecord); ok {
		for _, record := range records {
			if record.Status == "reserved_outcome_unknown" {
				pending++
			}
		}
	}
	storage := s.service.StorageStatus()
	_, _ = fmt.Fprintf(w, "# TYPE ynx_quant_execution_pending_unknown gauge\nynx_quant_execution_pending_unknown %d\n# TYPE ynx_quant_storage_backend_info gauge\nynx_quant_storage_backend_info{backend=\"%s\",multi_instance=\"%t\"} 1\n# TYPE ynx_quant_build_info gauge\nynx_quant_build_info{product_id=\"%s\",version=\"%s\",service_role=\"%s\"} 1\n", pending, storage["backend"], storage["multiInstance"], ProductID, Version, s.role)
}

func newJSONLogger(writer io.Writer) *slog.Logger {
	if writer == nil {
		writer = io.Discard
	}
	return slog.New(slog.NewJSONHandler(writer, &slog.HandlerOptions{Level: slog.LevelInfo}))
}
