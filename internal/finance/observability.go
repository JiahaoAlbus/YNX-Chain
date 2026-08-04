package finance

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	requestIDHeader       = "X-Request-ID"
	errorIDHeader         = "X-Error-ID"
	operationsKeyHeader   = "X-YNX-Operations-Key"
	observabilityVersion  = "finance-observability-v1"
	metricsPayloadVersion = "finance-metrics-v1"
)

var safeRequestID = regexp.MustCompile(`^[A-Za-z0-9._:-]{8,128}$`)

var latencyBoundsMS = []int64{5, 10, 25, 50, 100, 250, 500, 1000, 5000}

type requestIDContextKey struct{}

type routeMetric struct {
	Requests        uint64            `json:"requests"`
	Errors          uint64            `json:"errors"`
	TotalDurationMS int64             `json:"totalDurationMs"`
	MaxDurationMS   int64             `json:"maxDurationMs"`
	StatusClasses   map[string]uint64 `json:"statusClasses"`
	LatencyBuckets  map[string]uint64 `json:"latencyBuckets"`
}

type sourceMetric struct {
	Observations uint64            `json:"observations"`
	Available    uint64            `json:"available"`
	Unavailable  uint64            `json:"unavailable"`
	SyncStatus   map[string]uint64 `json:"syncStatus"`
}

type metricsSnapshot struct {
	SchemaVersion        string                  `json:"schemaVersion"`
	ObservabilityVersion string                  `json:"observabilityVersion"`
	Service              string                  `json:"service"`
	ServiceVersion       string                  `json:"serviceVersion"`
	ProcessInstanceID    string                  `json:"processInstanceId"`
	StartedAt            time.Time               `json:"startedAt"`
	ObservedAt           time.Time               `json:"observedAt"`
	UptimeSeconds        int64                   `json:"uptimeSeconds"`
	ProcessScope         string                  `json:"processScope"`
	InFlight             int64                   `json:"inFlight"`
	TotalRequests        uint64                  `json:"totalRequests"`
	Routes               map[string]routeMetric  `json:"routes"`
	Sources              map[string]sourceMetric `json:"sources"`
	PrivacyBoundary      string                  `json:"privacyBoundary"`
}

type financeMetrics struct {
	mu                sync.Mutex
	startedAt         time.Time
	processInstanceID string
	inFlight          int64
	totalRequests     uint64
	routes            map[string]*routeMetric
	sources           map[string]*sourceMetric
}

func newFinanceMetrics(now time.Time) *financeMetrics {
	return &financeMetrics{
		startedAt:         now.UTC(),
		processInstanceID: randomHex(12),
		routes:            map[string]*routeMetric{},
		sources:           map[string]*sourceMetric{},
	}
}

func (m *financeMetrics) begin() {
	m.mu.Lock()
	m.inFlight++
	m.mu.Unlock()
}

func (m *financeMetrics) finish(method, route string, status int, duration time.Duration) {
	if route == "" {
		route = "unmatched"
	}
	key := route
	if !strings.HasPrefix(route, method+" ") {
		key = method + " " + route
	}
	durationMS := duration.Milliseconds()
	if durationMS < 0 {
		durationMS = 0
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.inFlight > 0 {
		m.inFlight--
	}
	m.totalRequests++
	metric := m.routes[key]
	if metric == nil {
		metric = &routeMetric{StatusClasses: map[string]uint64{}, LatencyBuckets: map[string]uint64{}}
		m.routes[key] = metric
	}
	metric.Requests++
	if status >= 400 {
		metric.Errors++
	}
	metric.TotalDurationMS += durationMS
	if durationMS > metric.MaxDurationMS {
		metric.MaxDurationMS = durationMS
	}
	metric.StatusClasses[fmt.Sprintf("%dxx", status/100)]++
	metric.LatencyBuckets[latencyBucket(durationMS)]++
}

func (m *financeMetrics) observeSource(id string, status SourceStatus) {
	id = strings.TrimSpace(id)
	if id == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	metric := m.sources[id]
	if metric == nil {
		metric = &sourceMetric{SyncStatus: map[string]uint64{}}
		m.sources[id] = metric
	}
	metric.Observations++
	if status.Available {
		metric.Available++
	} else {
		metric.Unavailable++
	}
	syncStatus := strings.TrimSpace(status.SyncStatus)
	if syncStatus == "" {
		syncStatus = "unspecified"
	}
	metric.SyncStatus[syncStatus]++
}

func (m *financeMetrics) snapshot(now time.Time) metricsSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	routes := make(map[string]routeMetric, len(m.routes))
	for key, value := range m.routes {
		routes[key] = routeMetric{
			Requests:        value.Requests,
			Errors:          value.Errors,
			TotalDurationMS: value.TotalDurationMS,
			MaxDurationMS:   value.MaxDurationMS,
			StatusClasses:   cloneCounter(value.StatusClasses),
			LatencyBuckets:  cloneCounter(value.LatencyBuckets),
		}
	}
	sources := make(map[string]sourceMetric, len(m.sources))
	for key, value := range m.sources {
		sources[key] = sourceMetric{
			Observations: value.Observations,
			Available:    value.Available,
			Unavailable:  value.Unavailable,
			SyncStatus:   cloneCounter(value.SyncStatus),
		}
	}
	uptime := now.UTC().Sub(m.startedAt).Seconds()
	if uptime < 0 {
		uptime = 0
	}
	return metricsSnapshot{
		SchemaVersion:        metricsPayloadVersion,
		ObservabilityVersion: observabilityVersion,
		Service:              "ynx-finance",
		ServiceVersion:       "1.2.0",
		ProcessInstanceID:    m.processInstanceID,
		StartedAt:            m.startedAt,
		ObservedAt:           now.UTC(),
		UptimeSeconds:        int64(uptime),
		ProcessScope:         "in-memory counters reset on process restart; no continuity is implied",
		InFlight:             m.inFlight,
		TotalRequests:        m.totalRequests,
		Routes:               routes,
		Sources:              sources,
		PrivacyBoundary:      "No account, balance, activity, token, note, budget, request body, query string, or remote address is collected.",
	}
}

func cloneCounter(input map[string]uint64) map[string]uint64 {
	out := make(map[string]uint64, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func latencyBucket(durationMS int64) string {
	for _, bound := range latencyBoundsMS {
		if durationMS <= bound {
			return fmt.Sprintf("le_%dms", bound)
		}
	}
	return "gt_5000ms"
}

type observedResponseWriter struct {
	http.ResponseWriter
	status    int
	requestID string
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
	return w.ResponseWriter.Write(body)
}

func (w *observedResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (s *Server) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := s.now()
		requestID := acceptedRequestID(r.Header.Get(requestIDHeader))
		w.Header().Set(requestIDHeader, requestID)
		observed := &observedResponseWriter{ResponseWriter: w, requestID: requestID}
		s.metrics.begin()
		r = r.WithContext(context.WithValue(r.Context(), requestIDContextKey{}, requestID))
		next.ServeHTTP(observed, r)
		status := observed.status
		if status == 0 {
			status = http.StatusOK
		}
		route := r.Pattern
		if route == "" {
			route = "unmatched"
		}
		duration := s.now().Sub(started)
		s.metrics.finish(r.Method, route, status, duration)
		s.writeAccessLog(map[string]any{
			"timestamp":            s.now().UTC(),
			"event":                "http.request.completed",
			"service":              "ynx-finance",
			"serviceVersion":       "1.2.0",
			"observabilityVersion": observabilityVersion,
			"requestId":            requestID,
			"method":               r.Method,
			"route":                route,
			"status":               status,
			"durationMs":           maxInt64(duration.Milliseconds(), 0),
			"errorId":              observed.Header().Get(errorIDHeader),
		})
	})
}

func (s *Server) metricsEndpoint(w http.ResponseWriter, r *http.Request) {
	provided := strings.TrimSpace(r.Header.Get(operationsKeyHeader))
	if provided == "" || !hmac.Equal([]byte(provided), []byte(s.cfg.OperationsKey)) {
		writeError(w, http.StatusUnauthorized, "operations_auth_rejected", "Operational metrics authentication failed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, s.metrics.snapshot(s.now()))
}

func (s *Server) observedPortfolio(ctx context.Context, account string, classifications map[string]Classification) Portfolio {
	portfolio := s.service.Upstreams.Portfolio(ctx, account, classifications)
	s.metrics.observeSource("explorer", portfolio.ExplorerStatus)
	s.metrics.observeSource("pay", portfolio.PayStatus)
	ids := make([]string, 0, len(portfolio.ReadSources))
	for id := range portfolio.ReadSources {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		s.metrics.observeSource(id, portfolio.ReadSources[id].Status)
	}
	return portfolio
}

func (s *Server) observeReadSources(sources map[string]ReadSourceDescriptor) {
	ids := make([]string, 0, len(sources))
	for id := range sources {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		s.metrics.observeSource(id, sources[id].Status)
	}
}

func (s *Server) writeAccessLog(value map[string]any) {
	if s.logger == nil {
		return
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return
	}
	s.logger.Print(string(raw))
}

func newJSONLogger(writer io.Writer) *log.Logger {
	if writer == nil {
		writer = io.Discard
	}
	return log.New(writer, "", 0)
}

func acceptedRequestID(value string) string {
	value = strings.TrimSpace(value)
	if safeRequestID.MatchString(value) {
		return value
	}
	return "fin_" + randomHex(16)
}

func requestIDFromWriter(w http.ResponseWriter) string {
	if observed, ok := w.(*observedResponseWriter); ok {
		return observed.requestID
	}
	return strings.TrimSpace(w.Header().Get(requestIDHeader))
}

func stableErrorID(code string) string {
	code = strings.TrimSpace(code)
	if code == "" {
		return "YNX-FIN-UNSPECIFIED"
	}
	var builder strings.Builder
	lastDash := false
	for _, r := range strings.ToUpper(code) {
		switch {
		case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastDash = false
		default:
			if !lastDash && builder.Len() > 0 {
				builder.WriteByte('-')
				lastDash = true
			}
		}
	}
	return "YNX-FIN-" + strings.Trim(builder.String(), "-")
}

func randomHex(bytes int) string {
	if bytes < 1 {
		bytes = 1
	}
	raw := make([]byte, bytes)
	if _, err := rand.Read(raw); err != nil {
		fallback := sha256.Sum256([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
		raw = fallback[:bytes]
	}
	return hex.EncodeToString(raw)
}

func maxInt64(value, minimum int64) int64 {
	if value < minimum {
		return minimum
	}
	return value
}
