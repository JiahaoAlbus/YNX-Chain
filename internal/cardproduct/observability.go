package cardproduct

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	RequestIDHeader = "X-Request-ID"
	TraceIDHeader   = "X-Trace-ID"
	AuditIDHeader   = "X-Audit-ID"
	ErrorIDHeader   = "X-Error-ID"
	ErrorCodeHeader = "X-YNX-Error-Code"
)

type correlationContextKey string

const (
	requestIDContextKey correlationContextKey = "ynx-card-request-id"
	traceIDContextKey   correlationContextKey = "ynx-card-trace-id"
	spanIDContextKey    correlationContextKey = "ynx-card-span-id"
	auditIDContextKey   correlationContextKey = "ynx-card-audit-id"
)

type auditCorrelation struct {
	mu sync.Mutex
	id string
}

var (
	requestIDPattern = regexp.MustCompile(`^req_[0-9a-f]{16,64}\z`)
	errorIDPattern   = regexp.MustCompile(`^err_[0-9a-f]{16,64}\z`)
	traceIDPattern   = regexp.MustCompile(`^[0-9a-f]{32}\z`)
	spanIDPattern    = regexp.MustCompile(`^[0-9a-f]{16}\z`)
)

type ObservabilityConfig struct {
	LogWriter   io.Writer
	Now         func() time.Time
	IDGenerator func(kind string) string
}

type requestMetricKey struct {
	Method string
	Route  string
	Status int
}

type requestMetric struct {
	Count         uint64
	DurationNanos uint64
	ResponseBytes uint64
}

type observability struct {
	now         func() time.Time
	idGenerator func(kind string) string
	logWriter   io.Writer

	metricsMu           sync.Mutex
	requests            map[requestMetricKey]requestMetric
	providerKnown       bool
	providerAvailable   bool
	providerTransitions map[bool]uint64

	logMu sync.Mutex
}

func newObservability(config ObservabilityConfig) *observability {
	if config.Now == nil {
		config.Now = func() time.Time { return time.Now().UTC() }
	}
	if config.IDGenerator == nil {
		config.IDGenerator = randomCorrelationID
	}
	return &observability{
		now:                 config.Now,
		idGenerator:         config.IDGenerator,
		logWriter:           config.LogWriter,
		requests:            map[requestMetricKey]requestMetric{},
		providerTransitions: map[bool]uint64{},
	}
}

func (o *observability) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := o.now().UTC()
		requestID := strings.ToLower(strings.TrimSpace(r.Header.Get(RequestIDHeader)))
		if !requestIDPattern.MatchString(requestID) {
			requestID = o.newID("request")
		}
		traceID := traceIDFromTraceparent(r.Header.Get("traceparent"))
		if traceID == "" {
			traceID = o.newID("trace")
		}
		spanID := o.newID("span")
		audit := &auditCorrelation{}
		ctx := context.WithValue(r.Context(), requestIDContextKey, requestID)
		ctx = context.WithValue(ctx, traceIDContextKey, traceID)
		ctx = context.WithValue(ctx, spanIDContextKey, spanID)
		ctx = context.WithValue(ctx, auditIDContextKey, audit)
		r = r.WithContext(ctx)

		w.Header().Set(RequestIDHeader, requestID)
		w.Header().Set(TraceIDHeader, traceID)
		recorder := &observedResponseWriter{ResponseWriter: w}
		next.ServeHTTP(recorder, r)

		status := recorder.status
		if status == 0 {
			status = http.StatusOK
		}
		route := canonicalMetricRoute(r.Pattern)
		finished := o.now().UTC()
		duration := finished.Sub(started)
		if duration < 0 {
			duration = 0
		}
		method := normalizeMetricMethod(r.Method)
		o.recordRequest(method, route, status, duration, recorder.bytes)
		entry := map[string]any{
			"at":             finished.Format(time.RFC3339Nano),
			"level":          map[bool]string{true: "error", false: "info"}[status >= 500],
			"event":          "http_request",
			"service":        "ynx-card-productd",
			"requestId":      requestID,
			"traceId":        traceID,
			"method":         method,
			"route":          route,
			"status":         status,
			"durationMicros": duration.Microseconds(),
			"responseBytes":  recorder.bytes,
		}
		if auditID := recorder.Header().Get(AuditIDHeader); auditID != "" {
			entry["auditId"] = auditID
		}
		if errorID := recorder.Header().Get(ErrorIDHeader); errorID != "" {
			entry["errorId"] = errorID
			entry["errorCode"] = recorder.Header().Get(ErrorCodeHeader)
		}
		o.writeLog(entry)
	})
}

func (o *observability) newID(kind string) string {
	value := strings.ToLower(strings.TrimSpace(o.idGenerator(kind)))
	switch kind {
	case "trace":
		if traceIDPattern.MatchString(value) && value != strings.Repeat("0", 32) {
			return value
		}
	case "span":
		if spanIDPattern.MatchString(value) && value != strings.Repeat("0", 16) {
			return value
		}
	case "request":
		if requestIDPattern.MatchString(value) {
			return value
		}
	case "error":
		if errorIDPattern.MatchString(value) {
			return value
		}
	}
	return randomCorrelationID(kind)
}

func (o *observability) recordRequest(method, route string, status int, duration time.Duration, responseBytes int64) {
	key := requestMetricKey{Method: method, Route: route, Status: status}
	o.metricsMu.Lock()
	metric := o.requests[key]
	metric.Count++
	metric.DurationNanos += uint64(duration)
	if responseBytes > 0 {
		metric.ResponseBytes += uint64(responseBytes)
	}
	o.requests[key] = metric
	o.metricsMu.Unlock()
}

func (o *observability) recordProviderAvailability(ctx context.Context, available bool) {
	o.metricsMu.Lock()
	known := o.providerKnown
	changed := known && o.providerAvailable != available
	o.providerKnown = true
	o.providerAvailable = available
	if changed {
		o.providerTransitions[available]++
	}
	o.metricsMu.Unlock()
	if changed {
		o.writeLog(map[string]any{
			"at":        o.now().UTC().Format(time.RFC3339Nano),
			"level":     map[bool]string{true: "info", false: "error"}[available],
			"event":     "issuer_availability_changed",
			"service":   "ynx-card-productd",
			"requestId": RequestIDFromContext(ctx),
			"traceId":   TraceIDFromContext(ctx),
			"available": available,
		})
	}
}

func (o *observability) renderMetrics(w http.ResponseWriter) {
	o.metricsMu.Lock()
	requests := make(map[requestMetricKey]requestMetric, len(o.requests))
	for key, value := range o.requests {
		requests[key] = value
	}
	providerKnown := o.providerKnown
	providerAvailable := o.providerAvailable
	providerTransitions := map[bool]uint64{
		false: o.providerTransitions[false],
		true:  o.providerTransitions[true],
	}
	o.metricsMu.Unlock()

	keys := make([]requestMetricKey, 0, len(requests))
	for key := range requests {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		left := keys[i]
		right := keys[j]
		if left.Method != right.Method {
			return left.Method < right.Method
		}
		if left.Route != right.Route {
			return left.Route < right.Route
		}
		return left.Status < right.Status
	})

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, "# HELP ynx_card_http_requests_total Bounded Card HTTP requests by method, route template and status.\n")
	_, _ = io.WriteString(w, "# TYPE ynx_card_http_requests_total counter\n")
	_, _ = io.WriteString(w, "# HELP ynx_card_http_request_duration_seconds Card HTTP request duration.\n")
	_, _ = io.WriteString(w, "# TYPE ynx_card_http_request_duration_seconds summary\n")
	_, _ = io.WriteString(w, "# HELP ynx_card_http_response_bytes_total Card HTTP response bytes.\n")
	_, _ = io.WriteString(w, "# TYPE ynx_card_http_response_bytes_total counter\n")
	for _, key := range keys {
		metric := requests[key]
		labels := fmt.Sprintf("method=%s,route=%s,status=%s", prometheusQuote(key.Method), prometheusQuote(key.Route), prometheusQuote(strconv.Itoa(key.Status)))
		_, _ = fmt.Fprintf(w, "ynx_card_http_requests_total{%s} %d\n", labels, metric.Count)
		_, _ = fmt.Fprintf(w, "ynx_card_http_request_duration_seconds_sum{%s} %.9f\n", labels, float64(metric.DurationNanos)/float64(time.Second))
		_, _ = fmt.Fprintf(w, "ynx_card_http_request_duration_seconds_count{%s} %d\n", labels, metric.Count)
		_, _ = fmt.Fprintf(w, "ynx_card_http_response_bytes_total{%s} %d\n", labels, metric.ResponseBytes)
	}
	_, _ = io.WriteString(w, "# HELP ynx_card_issuer_state_known Whether issuer availability has been observed.\n")
	_, _ = io.WriteString(w, "# TYPE ynx_card_issuer_state_known gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_card_issuer_state_known %d\n", boolMetric(providerKnown))
	_, _ = io.WriteString(w, "# HELP ynx_card_issuer_available Whether the configured issuer is currently available.\n")
	_, _ = io.WriteString(w, "# TYPE ynx_card_issuer_available gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_card_issuer_available %d\n", boolMetric(providerKnown && providerAvailable))
	_, _ = io.WriteString(w, "# HELP ynx_card_issuer_state_transitions_total Issuer availability state transitions.\n")
	_, _ = io.WriteString(w, "# TYPE ynx_card_issuer_state_transitions_total counter\n")
	_, _ = fmt.Fprintf(w, "ynx_card_issuer_state_transitions_total{state=\"available\"} %d\n", providerTransitions[true])
	_, _ = fmt.Fprintf(w, "ynx_card_issuer_state_transitions_total{state=\"unavailable\"} %d\n", providerTransitions[false])
}

func (o *observability) writeLog(value map[string]any) {
	if o.logWriter == nil {
		return
	}
	o.logMu.Lock()
	_ = json.NewEncoder(o.logWriter).Encode(value)
	o.logMu.Unlock()
}

type observedResponseWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *observedResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

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
	written, err := w.ResponseWriter.Write(raw)
	w.bytes += int64(written)
	return written, err
}

func RequestIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(requestIDContextKey).(string)
	return value
}

func TraceIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(traceIDContextKey).(string)
	return value
}

func RecordAuditID(ctx context.Context, auditID string) {
	correlation, _ := ctx.Value(auditIDContextKey).(*auditCorrelation)
	if correlation == nil || auditID == "" {
		return
	}
	correlation.mu.Lock()
	correlation.id = auditID
	correlation.mu.Unlock()
}

func AuditIDFromContext(ctx context.Context) string {
	correlation, _ := ctx.Value(auditIDContextKey).(*auditCorrelation)
	if correlation == nil {
		return ""
	}
	correlation.mu.Lock()
	defer correlation.mu.Unlock()
	return correlation.id
}

func TraceparentFromContext(ctx context.Context) string {
	traceID := TraceIDFromContext(ctx)
	spanID, _ := ctx.Value(spanIDContextKey).(string)
	if !traceIDPattern.MatchString(traceID) || !spanIDPattern.MatchString(spanID) {
		return ""
	}
	return "00-" + traceID + "-" + spanID + "-01"
}

func traceIDFromTraceparent(value string) string {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(value)), "-")
	if len(parts) != 4 || parts[0] != "00" || !traceIDPattern.MatchString(parts[1]) || !spanIDPattern.MatchString(parts[2]) || len(parts[3]) != 2 {
		return ""
	}
	if parts[1] == strings.Repeat("0", 32) || parts[2] == strings.Repeat("0", 16) {
		return ""
	}
	if _, err := hex.DecodeString(parts[3]); err != nil {
		return ""
	}
	return parts[1]
}

func randomCorrelationID(kind string) string {
	size := 16
	prefix := kind + "_"
	switch kind {
	case "trace":
		size = 16
		prefix = ""
	case "span":
		size = 8
		prefix = ""
	case "request":
		prefix = "req_"
	case "error":
		prefix = "err_"
	}
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		fallback := hashBytes([]byte(fmt.Sprintf("%s\n%d", kind, time.Now().UTC().UnixNano())))
		if kind == "trace" {
			return fallback[:32]
		}
		if kind == "span" {
			return fallback[:16]
		}
		return prefix + fallback[:32]
	}
	return prefix + hex.EncodeToString(raw)
}

func normalizeMetricMethod(method string) string {
	switch method {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodHead, http.MethodOptions:
		return method
	default:
		return "OTHER"
	}
}

func canonicalMetricRoute(pattern string) string {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" || len(pattern) > 160 || strings.ContainsAny(pattern, "\r\n\t") {
		return "unmatched"
	}
	return pattern
}

func prometheusQuote(value string) string {
	return strconv.Quote(value)
}

func boolMetric(value bool) int {
	if value {
		return 1
	}
	return 0
}
