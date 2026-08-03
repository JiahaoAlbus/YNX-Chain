package aiproduct

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

const requestIDHeader = "X-Request-ID"

var safeRequestID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`)

type requestContextKey struct{}

type requestMetrics struct {
	total           atomic.Uint64
	active          atomic.Int64
	responses2xx    atomic.Uint64
	responses3xx    atomic.Uint64
	responses4xx    atomic.Uint64
	responses5xx    atomic.Uint64
	durationMicros  atomic.Uint64
	responseBytes   atomic.Uint64
	gatewayReady    atomic.Uint64
	gatewayNotReady atomic.Uint64
}

type observedResponseWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *observedResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *observedResponseWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(body)
	w.bytes += n
	return n, err
}

func (w *observedResponseWriter) Flush() {
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

func normalizedLogger(logger *slog.Logger) *slog.Logger {
	if logger != nil {
		return logger
	}
	return slog.New(slog.NewJSONHandler(io.Discard, nil))
}

func newRequestID(candidate string) string {
	candidate = strings.TrimSpace(candidate)
	if safeRequestID.MatchString(candidate) {
		return candidate
	}
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err == nil {
		return hex.EncodeToString(raw)
	}
	return fmt.Sprintf("ynx-ai-%d", time.Now().UnixNano())
}

func requestIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(requestContextKey{}).(string)
	return value
}

func (s *Server) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := newRequestID(r.Header.Get(requestIDHeader))
		w.Header().Set(requestIDHeader, requestID)
		ctx := context.WithValue(r.Context(), requestContextKey{}, requestID)
		r = r.WithContext(ctx)
		recorder := &observedResponseWriter{ResponseWriter: w}
		started := time.Now()
		s.metrics.active.Add(1)
		defer func() {
			s.metrics.active.Add(-1)
			s.metrics.total.Add(1)
			status := recorder.status
			if status == 0 {
				status = http.StatusOK
			}
			s.metrics.recordStatus(status)
			duration := time.Since(started)
			s.metrics.durationMicros.Add(uint64(duration.Microseconds()))
			s.metrics.responseBytes.Add(uint64(recorder.bytes))
			pattern := r.Pattern
			if pattern == "" {
				pattern = "unmatched"
			}
			attributes := []any{
				"event", "http_request_completed",
				"requestId", requestID,
				"method", r.Method,
				"route", pattern,
				"status", status,
				"durationMs", float64(duration.Microseconds()) / 1000,
				"responseBytes", recorder.bytes,
			}
			if traceparent := boundedTraceparent(r.Header.Get("traceparent")); traceparent != "" {
				attributes = append(attributes, "traceparent", traceparent)
			}
			s.logger.InfoContext(ctx, "YNX AI HTTP request completed", attributes...)
		}()
		next.ServeHTTP(recorder, r)
	})
}

func boundedTraceparent(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 128 || strings.ContainsAny(value, "\r\n") {
		return ""
	}
	return value
}

func (m *requestMetrics) recordStatus(status int) {
	switch {
	case status >= 500:
		m.responses5xx.Add(1)
	case status >= 400:
		m.responses4xx.Add(1)
	case status >= 300:
		m.responses3xx.Add(1)
	default:
		m.responses2xx.Add(1)
	}
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = fmt.Fprintf(w, `# HELP ynx_ai_http_requests_total Completed HTTP requests.
# TYPE ynx_ai_http_requests_total counter
ynx_ai_http_requests_total %d
# HELP ynx_ai_http_requests_active HTTP requests currently executing.
# TYPE ynx_ai_http_requests_active gauge
ynx_ai_http_requests_active %d
# HELP ynx_ai_http_responses_total Completed HTTP responses by status class.
# TYPE ynx_ai_http_responses_total counter
ynx_ai_http_responses_total{class="2xx"} %d
ynx_ai_http_responses_total{class="3xx"} %d
ynx_ai_http_responses_total{class="4xx"} %d
ynx_ai_http_responses_total{class="5xx"} %d
# HELP ynx_ai_http_request_duration_seconds_total Aggregate HTTP request duration.
# TYPE ynx_ai_http_request_duration_seconds_total counter
ynx_ai_http_request_duration_seconds_total %.6f
# HELP ynx_ai_http_response_bytes_total Aggregate response bytes written.
# TYPE ynx_ai_http_response_bytes_total counter
ynx_ai_http_response_bytes_total %d
# HELP ynx_ai_gateway_readiness_checks_total Gateway readiness checks by result.
# TYPE ynx_ai_gateway_readiness_checks_total counter
ynx_ai_gateway_readiness_checks_total{result="ready"} %d
ynx_ai_gateway_readiness_checks_total{result="not_ready"} %d
`,
		s.metrics.total.Load(),
		s.metrics.active.Load(),
		s.metrics.responses2xx.Load(),
		s.metrics.responses3xx.Load(),
		s.metrics.responses4xx.Load(),
		s.metrics.responses5xx.Load(),
		float64(s.metrics.durationMicros.Load())/1_000_000,
		s.metrics.responseBytes.Load(),
		s.metrics.gatewayReady.Load(),
		s.metrics.gatewayNotReady.Load(),
	)
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.GatewayURL+"/health", nil)
	if err == nil && s.cfg.GatewayKey != "" {
		request.Header.Set("X-YNX-AI-Key", s.cfg.GatewayKey)
	}
	status := http.StatusServiceUnavailable
	gatewayStatus := 0
	detail := "AI Gateway is unreachable or unhealthy"
	if err == nil {
		response, requestErr := s.client.Do(request)
		if requestErr == nil {
			gatewayStatus = response.StatusCode
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4<<10))
			_ = response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				status = http.StatusOK
				detail = "local product and configured AI Gateway are reachable"
			}
		}
	}
	ready := status == http.StatusOK
	if ready {
		s.metrics.gatewayReady.Add(1)
	} else {
		s.metrics.gatewayNotReady.Add(1)
	}
	writeJSON(w, status, map[string]any{
		"ok":                ready,
		"product":           ProductID,
		"gatewayReachable":  ready,
		"gatewayStatus":     gatewayStatus,
		"integratedCentral": false,
		"generationLive":    false,
		"status":            detail,
		"requestId":         requestIDFromContext(r.Context()),
	})
}
