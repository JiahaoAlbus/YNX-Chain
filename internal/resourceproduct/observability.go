package resourceproduct

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"sync/atomic"
	"time"
)

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{8,128}$`)
var traceparentPattern = regexp.MustCompile(`^00-([a-f0-9]{32})-[a-f0-9]{16}-[a-f0-9]{2}$`)

type serviceMetrics struct {
	requests           atomic.Uint64
	errors             atomic.Uint64
	clientErrors       atomic.Uint64
	totalLatencyMicros atomic.Uint64
	maxLatencyMicros   atomic.Uint64
	active             atomic.Int64
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "request-unavailable"
	}
	return "req_" + hex.EncodeToString(b[:])
}

func newTraceID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "00000000000000000000000000000000"
	}
	return hex.EncodeToString(b[:])
}

func (s *Service) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if !requestIDPattern.MatchString(id) {
			id = newRequestID()
		}
		w.Header().Set("X-Request-ID", id)
		traceID := newTraceID()
		if match := traceparentPattern.FindStringSubmatch(r.Header.Get("traceparent")); len(match) == 2 {
			traceID = match[1]
		}
		w.Header().Set("X-Trace-ID", traceID)
		started := time.Now()
		s.metrics.requests.Add(1)
		s.metrics.active.Add(1)
		defer s.metrics.active.Add(-1)
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		status := sw.status
		if status == 0 {
			status = 200
		}
		elapsed := time.Since(started)
		s.metrics.totalLatencyMicros.Add(uint64(elapsed.Microseconds()))
		for current := s.metrics.maxLatencyMicros.Load(); uint64(elapsed.Microseconds()) > current && !s.metrics.maxLatencyMicros.CompareAndSwap(current, uint64(elapsed.Microseconds())); current = s.metrics.maxLatencyMicros.Load() {
		}
		if status >= 500 {
			s.metrics.errors.Add(1)
		} else if status >= 400 {
			s.metrics.clientErrors.Add(1)
		}
		record := map[string]any{"level": "info", "event": "http_server_span", "requestId": id, "traceId": traceID, "method": r.Method, "path": r.URL.Path, "status": status, "durationMicros": elapsed.Microseconds(), "at": time.Now().UTC().Format(time.RFC3339Nano)}
		raw, _ := json.Marshal(record)
		log.Print(string(raw))
	})
}

func (s *Service) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	requests := s.metrics.requests.Load()
	average := float64(0)
	if requests > 0 {
		average = float64(s.metrics.totalLatencyMicros.Load()) / float64(requests)
	}
	serverErrors := s.metrics.errors.Load()
	serverErrorRate := float64(0)
	if requests > 0 {
		serverErrorRate = float64(serverErrors) / float64(requests)
	}
	writeJSON(w, 200, map[string]any{"schemaVersion": 2, "service": "ynx-resource-market", "asOf": time.Now().UTC(), "source": "in-process counters", "coverage": "current process only; resets on restart", "requestsTotal": requests, "clientErrorsTotal": s.metrics.clientErrors.Load(), "serverErrorsTotal": serverErrors, "serverErrorRate": serverErrorRate, "activeRequests": s.metrics.active.Load(), "averageLatencyMicros": average, "maxLatencyMicros": s.metrics.maxLatencyMicros.Load(), "uptimeSeconds": time.Since(s.startedAt).Seconds()})
}

func (s *Service) handleOperationalStatus(w http.ResponseWriter, _ *http.Request) {
	requests, serverErrors := s.metrics.requests.Load(), s.metrics.errors.Load()
	alerts := []map[string]any{}
	if requests >= 20 && float64(serverErrors)/float64(requests) > 0.01 {
		alerts = append(alerts, map[string]any{"code": "http_5xx_rate", "severity": "page", "status": "firing", "threshold": 0.01, "observed": float64(serverErrors) / float64(requests)})
	}
	if active := s.metrics.active.Load(); active > 100 {
		alerts = append(alerts, map[string]any{"code": "active_request_saturation", "severity": "page", "status": "firing", "threshold": 100, "observed": active})
	}
	status := "operational"
	if len(alerts) > 0 {
		status = "degraded"
	}
	writeJSON(w, 200, map[string]any{"schemaVersion": 1, "service": "ynx-resource-market", "status": status, "alerts": alerts, "asOf": time.Now().UTC(), "source": "current-process SLO guardrails", "coverage": "local process only; no public monitor or paging integration"})
}
