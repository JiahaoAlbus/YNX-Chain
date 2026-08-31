package payproduct

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const (
	requestIDHeader = "X-Request-ID"
	traceIDHeader   = "X-YNX-Trace-ID"
	errorIDHeader   = "X-Error-ID"
)

type observabilityState struct {
	build     buildinfo.Info
	logger    *slog.Logger
	metrics   *serverMetrics
	startedAt time.Time
}

var observedServerStates sync.Map

func NewServerWithBuild(service *Service, build buildinfo.Info) *Server {
	return NewServerWithLogger(service, build, nil)
}

func NewServerWithLogger(service *Service, build buildinfo.Info, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(io.Discard, nil))
	}
	server := NewServer(service)
	observedServerStates.Store(server, &observabilityState{
		build:     buildinfo.Normalize(build),
		logger:    logger,
		metrics:   newServerMetrics(),
		startedAt: time.Now().UTC(),
	})
	return server
}

// ObservedHandler is the canonical runtime handler. It preserves the existing
// API mux while adding dependency-aware operations endpoints, bounded metrics,
// structured completion logs and request/trace/error correlation.
func (s *Server) ObservedHandler() http.Handler {
	state := observationForServer(s)
	dispatch := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			switch r.URL.Path {
			case "/health", "/health/live":
				state.health(s.service, w)
				return
			case "/health/ready", "/ready":
				state.ready(s.service, w, r)
				return
			case "/version":
				state.version(w)
				return
			case "/metrics":
				state.metrics.render(w, state.build)
				return
			}
		}
		s.mux.ServeHTTP(w, r)
	})
	return state.observe(securityHeaders(dispatch))
}

func observationForServer(server *Server) *observabilityState {
	if state, ok := observedServerStates.Load(server); ok {
		return state.(*observabilityState)
	}
	state := &observabilityState{
		build:     buildinfo.Normalize(buildinfo.Info{}),
		logger:    slog.New(slog.NewJSONHandler(io.Discard, nil)),
		metrics:   newServerMetrics(),
		startedAt: time.Now().UTC(),
	}
	actual, _ := observedServerStates.LoadOrStore(server, state)
	return actual.(*observabilityState)
}

type correlationContextKey uint8

const (
	requestIDContextKey correlationContextKey = iota + 1
	traceIDContextKey
)

type DependencyReadiness struct {
	Name       string `json:"name"`
	Required   bool   `json:"required"`
	Configured bool   `json:"configured"`
	Ready      bool   `json:"ready"`
	Status     string `json:"status"`
}

type ReadinessReport struct {
	Ready        bool                  `json:"ready"`
	Service      string                `json:"service"`
	Network      string                `json:"network"`
	CheckedAt    time.Time             `json:"checkedAt"`
	Dependencies []DependencyReadiness `json:"dependencies"`
}

type requestMetricKey struct {
	Method string
	Route  string
	Status int
}

type requestMetric struct {
	Count       uint64
	DurationSum float64
	Bytes       uint64
	Buckets     []uint64
}

type serverMetrics struct {
	mu           sync.Mutex
	inFlight     int64
	requests     map[requestMetricKey]*requestMetric
	dependencies map[string]DependencyReadiness
}

var (
	httpDurationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}
	fallbackIDCounter   atomic.Uint64
)

func newServerMetrics() *serverMetrics {
	return &serverMetrics{
		requests:     map[requestMetricKey]*requestMetric{},
		dependencies: map[string]DependencyReadiness{},
	}
}

func (m *serverMetrics) begin() {
	m.mu.Lock()
	m.inFlight++
	m.mu.Unlock()
}

func (m *serverMetrics) record(method, route string, status, bytesWritten int, duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.inFlight > 0 {
		m.inFlight--
	}
	key := requestMetricKey{Method: method, Route: route, Status: status}
	metric := m.requests[key]
	if metric == nil {
		metric = &requestMetric{Buckets: make([]uint64, len(httpDurationBuckets))}
		m.requests[key] = metric
	}
	seconds := duration.Seconds()
	metric.Count++
	metric.DurationSum += seconds
	if bytesWritten > 0 {
		metric.Bytes += uint64(bytesWritten)
	}
	for index, boundary := range httpDurationBuckets {
		if seconds <= boundary {
			metric.Buckets[index]++
		}
	}
}

func (m *serverMetrics) setDependencies(dependencies []DependencyReadiness) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, dependency := range dependencies {
		m.dependencies[dependency.Name] = dependency
	}
}

func (m *serverMetrics) render(w http.ResponseWriter, build buildinfo.Info) {
	m.mu.Lock()
	defer m.mu.Unlock()

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintln(w, "# HELP ynx_pay_http_requests_total Total completed HTTP requests.")
	fmt.Fprintln(w, "# TYPE ynx_pay_http_requests_total counter")
	fmt.Fprintln(w, "# HELP ynx_pay_http_request_duration_seconds HTTP request duration histogram.")
	fmt.Fprintln(w, "# TYPE ynx_pay_http_request_duration_seconds histogram")
	fmt.Fprintln(w, "# HELP ynx_pay_http_response_bytes_total Total response bytes written.")
	fmt.Fprintln(w, "# TYPE ynx_pay_http_response_bytes_total counter")

	keys := make([]requestMetricKey, 0, len(m.requests))
	for key := range m.requests {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Method != keys[j].Method {
			return keys[i].Method < keys[j].Method
		}
		if keys[i].Route != keys[j].Route {
			return keys[i].Route < keys[j].Route
		}
		return keys[i].Status < keys[j].Status
	})
	for _, key := range keys {
		metric := m.requests[key]
		labels := fmt.Sprintf("method=\"%s\",route=\"%s\",status=\"%d\"", prometheusEscape(key.Method), prometheusEscape(key.Route), key.Status)
		fmt.Fprintf(w, "ynx_pay_http_requests_total{%s} %d\n", labels, metric.Count)
		for index, boundary := range httpDurationBuckets {
			fmt.Fprintf(w, "ynx_pay_http_request_duration_seconds_bucket{%s,le=\"%s\"} %d\n", labels, strconv.FormatFloat(boundary, 'f', -1, 64), metric.Buckets[index])
		}
		fmt.Fprintf(w, "ynx_pay_http_request_duration_seconds_bucket{%s,le=\"+Inf\"} %d\n", labels, metric.Count)
		fmt.Fprintf(w, "ynx_pay_http_request_duration_seconds_sum{%s} %s\n", labels, strconv.FormatFloat(metric.DurationSum, 'f', 9, 64))
		fmt.Fprintf(w, "ynx_pay_http_request_duration_seconds_count{%s} %d\n", labels, metric.Count)
		fmt.Fprintf(w, "ynx_pay_http_response_bytes_total{%s} %d\n", labels, metric.Bytes)
	}

	fmt.Fprintln(w, "# HELP ynx_pay_http_requests_in_flight Current in-flight HTTP requests.")
	fmt.Fprintln(w, "# TYPE ynx_pay_http_requests_in_flight gauge")
	fmt.Fprintf(w, "ynx_pay_http_requests_in_flight %d\n", m.inFlight)
	fmt.Fprintln(w, "# HELP ynx_pay_build_info Build identity for this process.")
	fmt.Fprintln(w, "# TYPE ynx_pay_build_info gauge")
	fmt.Fprintf(w, "ynx_pay_build_info{commit=\"%s\",release=\"%s\",build_time=\"%s\"} 1\n", prometheusEscape(build.Commit), prometheusEscape(build.Release), prometheusEscape(build.BuildTime))
	fmt.Fprintln(w, "# HELP ynx_pay_dependency_ready Last observed dependency readiness state.")
	fmt.Fprintln(w, "# TYPE ynx_pay_dependency_ready gauge")
	dependencyNames := make([]string, 0, len(m.dependencies))
	for name := range m.dependencies {
		dependencyNames = append(dependencyNames, name)
	}
	sort.Strings(dependencyNames)
	for _, name := range dependencyNames {
		dependency := m.dependencies[name]
		ready := 0
		if dependency.Ready {
			ready = 1
		}
		fmt.Fprintf(w, "ynx_pay_dependency_ready{dependency=\"%s\",required=\"%t\",configured=\"%t\",status=\"%s\"} %d\n", prometheusEscape(dependency.Name), dependency.Required, dependency.Configured, prometheusEscape(dependency.Status), ready)
	}
}

func prometheusEscape(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\n", "\\n")
	return strings.ReplaceAll(value, "\"", "\\\"")
}

type observedResponseWriter struct {
	http.ResponseWriter
	requestID    string
	traceID      string
	errorID      string
	status       int
	bytes        int
	headerSent   bool
	errorPayload bytes.Buffer
}

func (w *observedResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	if status >= http.StatusBadRequest {
		w.ensureErrorID()
		return
	}
	w.flushHeader()
}

func (w *observedResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	if w.status >= http.StatusBadRequest && strings.HasPrefix(strings.ToLower(w.Header().Get("Content-Type")), "application/json") {
		return w.errorPayload.Write(data)
	}
	w.flushHeader()
	count, err := w.ResponseWriter.Write(data)
	w.bytes += count
	return count, err
}

func (w *observedResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *observedResponseWriter) ensureErrorID() string {
	if w.errorID == "" {
		w.errorID = randomHex(16)
		w.Header().Set(errorIDHeader, w.errorID)
	}
	return w.errorID
}

func (w *observedResponseWriter) flushHeader() {
	if w.headerSent {
		return
	}
	if w.status == 0 {
		w.status = http.StatusOK
	}
	w.ResponseWriter.WriteHeader(w.status)
	w.headerSent = true
}

func (w *observedResponseWriter) finalize() {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	if w.errorPayload.Len() > 0 {
		w.ensureErrorID()
		body := w.errorPayload.Bytes()
		var payload map[string]any
		if json.Unmarshal(body, &payload) == nil {
			payload["requestId"] = w.requestID
			payload["traceId"] = w.traceID
			payload["errorId"] = w.errorID
			if encoded, err := json.Marshal(payload); err == nil {
				body = append(encoded, '\n')
			}
		}
		w.Header().Del("Content-Length")
		w.flushHeader()
		count, _ := w.ResponseWriter.Write(body)
		w.bytes += count
		return
	}
	w.flushHeader()
}

func (state *observabilityState) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := normalizedRequestID(r.Header.Get(requestIDHeader))
		traceID := normalizedTraceID(r.Header.Get(traceIDHeader), r.Header.Get("Traceparent"))
		ctx := context.WithValue(r.Context(), requestIDContextKey, requestID)
		ctx = context.WithValue(ctx, traceIDContextKey, traceID)
		r = r.WithContext(ctx)

		writer := &observedResponseWriter{ResponseWriter: w, requestID: requestID, traceID: traceID}
		writer.Header().Set(requestIDHeader, requestID)
		writer.Header().Set("X-YNX-Request-ID", requestID)
		writer.Header().Set(traceIDHeader, traceID)
		writer.Header().Set("Traceparent", traceparent(traceID))

		started := time.Now()
		state.metrics.begin()
		defer func() {
			if recovered := recover(); recovered != nil {
				if writer.status == 0 {
					writeError(writer, http.StatusInternalServerError, "internal service error")
				} else {
					writer.ensureErrorID()
				}
				state.logger.Error("http_panic", "service", "ynx-pay-product", "request_id", requestID, "trace_id", traceID, "error_id", writer.errorID)
			}
			writer.finalize()
			status := writer.status
			route := routeLabel(r)
			duration := time.Since(started)
			state.metrics.record(r.Method, route, status, writer.bytes, duration)
			attributes := []any{
				"service", "ynx-pay-product",
				"method", r.Method,
				"route", route,
				"status", status,
				"bytes", writer.bytes,
				"duration_ms", float64(duration.Microseconds()) / 1000,
				"request_id", requestID,
				"trace_id", traceID,
			}
			if writer.errorID != "" {
				attributes = append(attributes, "error_id", writer.errorID)
			}
			switch {
			case status >= 500:
				state.logger.Error("http_request", attributes...)
			case status >= 400:
				state.logger.Warn("http_request", attributes...)
			default:
				state.logger.Info("http_request", attributes...)
			}
		}()

		next.ServeHTTP(writer, r)
	})
}

func routeLabel(r *http.Request) string {
	pattern := strings.TrimSpace(r.Pattern)
	if pattern == "" {
		switch r.URL.Path {
		case "/health", "/health/live":
			return "/health/live"
		case "/health/ready", "/ready":
			return "/health/ready"
		case "/version":
			return "/version"
		case "/metrics":
			return "/metrics"
		default:
			return "unmatched"
		}
	}
	fields := strings.Fields(pattern)
	if len(fields) == 2 && strings.EqualFold(fields[0], r.Method) {
		return fields[1]
	}
	return pattern
}

func normalizedRequestID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 8 && len(value) <= 128 {
		valid := true
		for _, char := range value {
			if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || strings.ContainsRune("._:-", char)) {
				valid = false
				break
			}
		}
		if valid {
			return value
		}
	}
	return randomHex(16)
}

func normalizedTraceID(value, parent string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if validTraceID(value) {
		return value
	}
	parts := strings.Split(strings.TrimSpace(parent), "-")
	if len(parts) == 4 {
		candidate := strings.ToLower(parts[1])
		if validTraceID(candidate) {
			return candidate
		}
	}
	return randomHex(16)
}

func validTraceID(value string) bool {
	if len(value) != 32 || value == strings.Repeat("0", 32) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func randomHex(size int) string {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err == nil {
		return hex.EncodeToString(raw)
	}
	fallback := sha256.Sum256([]byte(fmt.Sprintf("%d:%d", time.Now().UnixNano(), fallbackIDCounter.Add(1))))
	return hex.EncodeToString(fallback[:])[:size*2]
}

func traceparent(traceID string) string {
	return "00-" + traceID + "-" + randomHex(8) + "-01"
}

func requestIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(requestIDContextKey).(string)
	return value
}

func traceIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(traceIDContextKey).(string)
	return value
}

func applyCorrelationHeaders(request *http.Request) {
	requestID := requestIDFromContext(request.Context())
	if requestID == "" {
		requestID = normalizedRequestID(request.Header.Get(requestIDHeader))
	}
	traceID := traceIDFromContext(request.Context())
	if !validTraceID(traceID) {
		traceID = normalizedTraceID(request.Header.Get(traceIDHeader), request.Header.Get("Traceparent"))
	}
	request.Header.Set(requestIDHeader, requestID)
	request.Header.Set("X-YNX-Request-ID", requestID)
	request.Header.Set(traceIDHeader, traceID)
	request.Header.Set("Traceparent", traceparent(traceID))
}

func (s *Service) Readiness(ctx context.Context) ReadinessReport {
	report := ReadinessReport{
		Ready:     true,
		Service:   "ynx-pay-product",
		Network:   ChainID,
		CheckedAt: s.now().UTC(),
	}
	add := func(dependency DependencyReadiness) {
		report.Dependencies = append(report.Dependencies, dependency)
		if dependency.Required && !dependency.Ready {
			report.Ready = false
		}
	}

	storeStatus := DependencyReadiness{Name: "store", Required: true, Configured: true, Ready: true, Status: "verified"}
	if verification, err := VerifyStoreBackup(s.store.path, s.key); err != nil || !verification.Verified || verification.SnapshotVersion != 1 {
		storeStatus.Ready = false
		storeStatus.Status = "unavailable"
	}
	add(storeStatus)

	centralStatus := DependencyReadiness{Name: "central_pay", Required: true, Configured: s.pay != nil, Status: "probe_unsupported"}
	if prober, ok := s.pay.(interface{ Health(context.Context) error }); ok {
		centralStatus.Status = "ready"
		centralStatus.Ready = prober.Health(ctx) == nil
		if !centralStatus.Ready {
			centralStatus.Status = "unavailable"
		}
	}
	add(centralStatus)

	add(optionalDependency("ai_gateway", s.ai != nil))
	add(optionalDependency("paymaster", s.sponsorship != nil))
	add(optionalDependency("bridge", s.bridge != nil))
	add(optionalDependency("stable_settlement", s.stableApproval != nil))
	add(optionalDependency("quant_verifier", len(s.quantEvidenceKeys) > 0))
	return report
}

func optionalDependency(name string, configured bool) DependencyReadiness {
	status := "not_configured"
	if configured {
		status = "configured_unprobed"
	}
	return DependencyReadiness{Name: name, Required: false, Configured: configured, Ready: false, Status: status}
}

func (state *observabilityState) health(service *Service, w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                   true,
		"status":               "live",
		"service":              "ynx-pay-product",
		"network":              ChainID,
		"evmChainId":           EVMChainID,
		"asset":                NativeAsset,
		"feeYnxt":              NativeFeeYNXT,
		"crossChainSettlement": "unavailable",
		"paidEvidence":         "authoritative-central-pay-api",
		"uptimeSeconds":        int64(time.Since(state.startedAt).Seconds()),
		"build":                state.build,
	})
}

func (state *observabilityState) ready(service *Service, w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	report := service.Readiness(ctx)
	state.metrics.setDependencies(report.Dependencies)
	status := http.StatusOK
	if !report.Ready {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{"readiness": report, "build": state.build})
}

func (state *observabilityState) version(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, map[string]any{
		"service":         "ynx-pay-product",
		"apiVersion":      "v1",
		"snapshotVersion": 1,
		"network":         ChainID,
		"evmChainId":      EVMChainID,
		"build":           state.build,
	})
}
