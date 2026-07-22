package payproduct

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var requestIDRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`)
var traceparentRE = regexp.MustCompile(`^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$`)

type observabilityContextKey string

const (
	requestIDContextKey observabilityContextKey = "request-id"
	traceIDContextKey   observabilityContextKey = "trace-id"
)

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

func (w *observedResponseWriter) Write(raw []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(raw)
	w.bytes += n
	return n, err
}

func (w *observedResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func requestObservability(next http.Handler, logger *slog.Logger, metrics *RuntimeMetrics) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		requestID := r.Header.Get("X-Request-ID")
		if !requestIDRE.MatchString(requestID) {
			requestID = "req_" + randomToken(12)
		}
		traceID := ""
		if match := traceparentRE.FindStringSubmatch(strings.ToLower(r.Header.Get("traceparent"))); len(match) == 4 && match[1] != strings.Repeat("0", 32) {
			traceID = match[1]
		}
		if traceID == "" {
			traceID = hashString(requestID, started.UTC().Format(time.RFC3339Nano), randomToken(8))[:32]
		}
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("X-Trace-ID", traceID)
		observed := &observedResponseWriter{ResponseWriter: w}
		ctx := context.WithValue(r.Context(), requestIDContextKey, requestID)
		ctx = context.WithValue(ctx, traceIDContextKey, traceID)
		observedRequest := r.WithContext(ctx)
		next.ServeHTTP(observed, observedRequest)
		if observed.status == 0 {
			observed.status = http.StatusOK
		}
		duration := time.Since(started)
		if metrics != nil {
			metrics.Observe(observedRequest.Method, observedRequest.Pattern, observed.status, observed.bytes, duration)
		}
		attrs := []any{"event", "http.request", "request_id", requestID, "trace_id", traceID, "method", observedRequest.Method, "route", observedRequest.Pattern, "status", observed.status, "duration_ms", float64(duration.Microseconds()) / 1000, "response_bytes", observed.bytes}
		if role := observed.Header().Get("X-YNX-Merchant-Role"); role != "" {
			attrs = append(attrs, "merchant_role", role)
		}
		if errorID := observed.Header().Get("X-Error-ID"); errorID != "" {
			attrs = append(attrs, "error_id", errorID)
		}
		if observed.status >= 500 {
			logger.Error("http request completed", attrs...)
		} else if observed.status >= 400 {
			logger.Warn("http request completed", attrs...)
		} else {
			logger.Info("http request completed", attrs...)
		}
	})
}

func RequestIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(requestIDContextKey).(string)
	return value
}

func TraceIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(traceIDContextKey).(string)
	return value
}

func TraceparentFromContext(ctx context.Context) string {
	traceID := TraceIDFromContext(ctx)
	if len(traceID) != 32 {
		return ""
	}
	spanID := hashString(traceID, randomToken(8))[:16]
	return "00-" + traceID + "-" + spanID + "-01"
}

func newDiscardLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, nil))
}

func errorCode(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "invalid_request"
	case http.StatusUnauthorized:
		return "unauthorized"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusConflict:
		return "conflict"
	case http.StatusRequestEntityTooLarge:
		return "request_too_large"
	default:
		if status >= 500 {
			return "internal_error"
		}
		return "operation_failed"
	}
}

func publicErrorMessage(err error) string {
	if err == nil {
		return "operation failed"
	}
	message := err.Error()
	lower := strings.ToLower(message)
	for _, external := range []string{"central pay api", "ynx ai gateway", "provider response", "provider request"} {
		if strings.Contains(lower, external) {
			return "authoritative provider unavailable or rejected the operation"
		}
	}
	for _, internal := range []string{"read pay product store", "write pay product store", "decode pay product store", "no such file", "permission denied", "server path", "stack"} {
		if strings.Contains(lower, internal) {
			return "merchant state operation failed; use the error ID for support"
		}
	}
	safeMarkers := []string{"required", "invalid", "must ", "must be", "not found", "not active", "does not allow", "expired", "replay", "mismatch", "unavailable", "already exists", "unsupported", "permission", "disabled", "changed; sign in again", "at least one active owner"}
	for _, marker := range safeMarkers {
		if strings.Contains(lower, marker) && !strings.ContainsAny(message, "\r\n") {
			return message
		}
	}
	if errors.Is(err, context.Canceled) {
		return "operation cancelled"
	}
	return "operation failed; use the error ID for support"
}
