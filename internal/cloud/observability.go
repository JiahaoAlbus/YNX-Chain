package cloud

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type serverObservability struct {
	build         buildinfo.Info
	startedAt     time.Time
	requests      atomic.Uint64
	errors        atomic.Uint64
	responseBytes atomic.Uint64
	durationNanos atomic.Uint64
	inFlight      atomic.Int64
}

func NewServer(service *Service) *Server {
	return NewServerWithBuild(service, buildinfo.Info{})
}

func NewServerWithBuild(service *Service, build buildinfo.Info) *Server {
	return &Server{
		service: service,
		observability: &serverObservability{
			build:     buildinfo.Normalize(build),
			startedAt: time.Now().UTC(),
		},
	}
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	health := s.service.Health()
	health["build"] = s.observability.build
	health["startedAt"] = s.observability.startedAt.Format(time.RFC3339Nano)
	health["truthfulStatus"] = "local-bounded-docs-runtime-not-publicly-deployed"
	writeJSON(w, http.StatusOK, health)
}

func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	health := s.service.Health()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"service":        "ynx-cloudd",
		"schemaVersion":  health["schemaVersion"],
		"stateLoaded":    true,
		"durability":     health["durability"],
		"trustBoundary":  health["trustBoundary"],
		"readinessBasis": "service-initialized-state-loaded-and-local-boundaries-configured",
	})
}

func (s *Server) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"service":       "ynx-cloudd",
		"product":       "YNX Docs",
		"contract":      "ynx-docs-v1",
		"schemaVersion": s.service.Health()["schemaVersion"],
		"build":         s.observability.build,
	})
}

func (s *Server) metrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	health := s.service.Health()
	obs := s.observability
	_, _ = fmt.Fprintln(w, "# HELP ynx_docs_http_requests_total Total HTTP requests completed by the Docs runtime.")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_docs_http_requests_total counter\nynx_docs_http_requests_total %d\n", obs.requests.Load())
	_, _ = fmt.Fprintln(w, "# HELP ynx_docs_http_errors_total Total HTTP responses with status 400 or greater.")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_docs_http_errors_total counter\nynx_docs_http_errors_total %d\n", obs.errors.Load())
	_, _ = fmt.Fprintln(w, "# HELP ynx_docs_http_in_flight Current in-flight HTTP requests.")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_docs_http_in_flight gauge\nynx_docs_http_in_flight %d\n", obs.inFlight.Load())
	_, _ = fmt.Fprintln(w, "# HELP ynx_docs_http_response_bytes_total Total response bytes written.")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_docs_http_response_bytes_total counter\nynx_docs_http_response_bytes_total %d\n", obs.responseBytes.Load())
	_, _ = fmt.Fprintln(w, "# HELP ynx_docs_http_request_duration_seconds Request duration summary.")
	_, _ = fmt.Fprintln(w, "# TYPE ynx_docs_http_request_duration_seconds summary")
	_, _ = fmt.Fprintf(w, "ynx_docs_http_request_duration_seconds_sum %.9f\n", float64(obs.durationNanos.Load())/float64(time.Second))
	_, _ = fmt.Fprintf(w, "ynx_docs_http_request_duration_seconds_count %d\n", obs.requests.Load())
	_, _ = fmt.Fprintln(w, "# HELP ynx_docs_info Build and schema identity for the Docs runtime.")
	_, _ = fmt.Fprintln(w, "# TYPE ynx_docs_info gauge")
	_, _ = fmt.Fprintf(w, "ynx_docs_info{commit=\"%s\",release=\"%s\",schema_version=\"%v\"} 1\n", prometheusEscape(obs.build.Commit), prometheusEscape(obs.build.Release), health["schemaVersion"])
}

func (s *Server) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		requestID := safeObservabilityID(r.Header.Get("X-Request-ID"))
		if requestID == "" {
			requestID = newID("req")
		}
		traceID := safeObservabilityID(r.Header.Get("X-Trace-ID"))
		if traceID == "" {
			traceID = requestID
		}
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("X-Trace-ID", traceID)
		recorder := &observedResponseWriter{ResponseWriter: w}
		obs := s.observability
		obs.inFlight.Add(1)
		defer obs.inFlight.Add(-1)
		next.ServeHTTP(recorder, r)
		if recorder.status == 0 {
			recorder.status = http.StatusOK
		}
		duration := time.Since(started)
		obs.requests.Add(1)
		obs.responseBytes.Add(uint64(recorder.bytes))
		obs.durationNanos.Add(uint64(duration))
		if recorder.status >= http.StatusBadRequest {
			obs.errors.Add(1)
		}
		slog.Info("ynx_docs_http_request",
			"request_id", requestID,
			"trace_id", traceID,
			"method", r.Method,
			"path", r.URL.Path,
			"status", recorder.status,
			"bytes", recorder.bytes,
			"duration_ms", float64(duration.Microseconds())/1000,
		)
	})
}

type observedResponseWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *observedResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *observedResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	if status >= http.StatusBadRequest {
		w.Header().Set("X-Error-ID", newID("err"))
	}
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

func safeObservabilityID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 128 {
		return ""
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("-_.:", r) {
			continue
		}
		return ""
	}
	return value
}

func prometheusEscape(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\n", "\\n")
	return strings.ReplaceAll(value, "\"", "\\\"")
}
