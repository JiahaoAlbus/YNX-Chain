package calendar

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var safeRequestID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`)

type metricKey struct {
	Method  string
	Pattern string
	Status  int
}

type metricValue struct {
	Count          uint64
	DurationMicros uint64
}

type runtimeMetrics struct {
	mu          sync.Mutex
	requests    map[metricKey]metricValue
	inFlight    uint64
	maxInFlight uint64
}

func newRuntimeMetrics() *runtimeMetrics {
	return &runtimeMetrics{requests: map[metricKey]metricValue{}}
}

func (m *runtimeMetrics) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if !safeRequestID.MatchString(requestID) {
			requestID = randomRequestID()
		}
		w.Header().Set("X-Request-ID", requestID)
		capture := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		started := time.Now()
		m.mu.Lock()
		m.inFlight++
		if m.inFlight > m.maxInFlight {
			m.maxInFlight = m.inFlight
		}
		m.mu.Unlock()
		next.ServeHTTP(capture, r)
		pattern := r.Pattern
		if pattern == "" {
			pattern = "unmatched"
		}
		key := metricKey{Method: r.Method, Pattern: pattern, Status: capture.status}
		elapsed := uint64(time.Since(started).Microseconds())
		m.mu.Lock()
		m.inFlight--
		value := m.requests[key]
		value.Count++
		value.DurationMicros += elapsed
		m.requests[key] = value
		m.mu.Unlock()
	})
}

func (m *runtimeMetrics) serve(w http.ResponseWriter, _ *http.Request) {
	type row struct {
		key   metricKey
		value metricValue
	}
	m.mu.Lock()
	rows := make([]row, 0, len(m.requests))
	for key, value := range m.requests {
		rows = append(rows, row{key: key, value: value})
	}
	inFlight, maxInFlight := m.inFlight, m.maxInFlight
	m.mu.Unlock()
	sort.Slice(rows, func(i, j int) bool {
		left, right := rows[i].key, rows[j].key
		return left.Method+left.Pattern+strconv.Itoa(left.Status) < right.Method+right.Pattern+strconv.Itoa(right.Status)
	})
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprintln(w, "# HELP ynx_calendar_http_requests_total Calendar HTTP requests by bounded route and status.")
	fmt.Fprintln(w, "# TYPE ynx_calendar_http_requests_total counter")
	for _, row := range rows {
		labels := metricLabels(row.key)
		fmt.Fprintf(w, "ynx_calendar_http_requests_total%s %d\n", labels, row.value.Count)
	}
	fmt.Fprintln(w, "# HELP ynx_calendar_http_request_duration_seconds_total Accumulated Calendar request duration.")
	fmt.Fprintln(w, "# TYPE ynx_calendar_http_request_duration_seconds_total counter")
	for _, row := range rows {
		labels := metricLabels(row.key)
		fmt.Fprintf(w, "ynx_calendar_http_request_duration_seconds_total%s %.6f\n", labels, float64(row.value.DurationMicros)/1_000_000)
	}
	fmt.Fprintln(w, "# HELP ynx_calendar_http_requests_in_flight Calendar requests currently executing.")
	fmt.Fprintln(w, "# TYPE ynx_calendar_http_requests_in_flight gauge")
	fmt.Fprintf(w, "ynx_calendar_http_requests_in_flight %d\n", inFlight)
	fmt.Fprintln(w, "# HELP ynx_calendar_http_requests_max_in_flight Maximum observed in-flight requests since process start.")
	fmt.Fprintln(w, "# TYPE ynx_calendar_http_requests_max_in_flight gauge")
	fmt.Fprintf(w, "ynx_calendar_http_requests_max_in_flight %d\n", maxInFlight)
}

func metricLabels(key metricKey) string {
	return fmt.Sprintf(`{method=%q,route=%q,status=%q}`, key.Method, key.Pattern, strconv.Itoa(key.Status))
}

func randomRequestID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err == nil {
		return "cal_" + hex.EncodeToString(value[:])
	}
	return fmt.Sprintf("cal_fallback_%d", time.Now().UnixNano())
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}
