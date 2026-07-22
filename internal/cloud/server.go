package cloud

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Server struct {
	service       *Service
	mu            sync.Mutex
	startedAt     time.Time
	requests      map[string]int64
	latencyMillis map[string]int64
	limits        ServerLimits
	inflight      chan struct{}
	clients       map[string]clientWindow
	rejections    map[string]int64
	telemetry     telemetryState
	telemetryOK   bool
	telemetryErr  string
}

type ServerLimits struct {
	MaxConcurrent     int
	RequestsPerMinute int
}
type clientWindow struct {
	StartedAt time.Time
	Count     int
}

func NewServer(service *Service) *Server {
	return NewServerWithLimits(service, ServerLimits{MaxConcurrent: 128, RequestsPerMinute: 120})
}
func NewServerWithLimits(service *Service, limits ServerLimits) *Server {
	if limits.MaxConcurrent < 1 {
		limits.MaxConcurrent = 128
	}
	if limits.RequestsPerMinute < 1 {
		limits.RequestsPerMinute = 120
	}
	now := service.cfg.Now()
	telemetry, err := loadTelemetry(service.cfg.TelemetryPath, now)
	server := &Server{service: service, startedAt: now, requests: map[string]int64{}, latencyMillis: map[string]int64{}, limits: limits, inflight: make(chan struct{}, limits.MaxConcurrent), clients: map[string]clientWindow{}, rejections: map[string]int64{}, telemetry: telemetry, telemetryOK: err == nil}
	if err != nil {
		server.telemetry = newTelemetryState(now)
		server.telemetryErr = "telemetry integrity or availability check failed"
	}
	return server
}

type observedWriter struct {
	http.ResponseWriter
	status  int
	bytes   int
	errorID string
}

type payloadCountingWriter struct {
	http.ResponseWriter
	bytes int64
}

func (w *payloadCountingWriter) Write(body []byte) (int, error) {
	n, err := w.ResponseWriter.Write(body)
	w.bytes += int64(n)
	return n, err
}

func (w *observedWriter) WriteHeader(status int) {
	if status >= 400 {
		w.errorID = newID("error")
		w.Header().Set("X-Error-ID", w.errorID)
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *observedWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += n
	return n, err
}
func (s *Server) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		observedAt := s.service.cfg.Now()
		requestID := newID("request")
		traceID := newID("trace")
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("X-Trace-ID", traceID)
		ow := &observedWriter{ResponseWriter: w}
		defer func() {
			if ow.status == 0 {
				ow.status = 200
			}
			duration := time.Since(started)
			route := strings.TrimPrefix(r.Pattern, r.Method+" ")
			if route == "" {
				route = "unmatched"
			}
			key := fmt.Sprintf("%s %s %d", r.Method, route, ow.status)
			routeKey := r.Method + " " + route
			s.mu.Lock()
			s.requests[key]++
			s.latencyMillis[key] += duration.Milliseconds()
			metric := s.telemetry.Routes[routeKey]
			if metric.LatencyBuckets == nil {
				metric.LatencyBuckets = map[string]int64{}
			}
			metric.Requests++
			if ow.status >= 400 {
				metric.Errors++
			}
			metric.ResponseBytes += int64(ow.bytes)
			metric.TotalLatencyMillis += duration.Milliseconds()
			metric.LatencyBuckets[latencyBucket(duration.Milliseconds())]++
			s.telemetry.Routes[routeKey] = metric
			s.telemetry.UpdatedAt = s.service.cfg.Now()
			s.telemetry.RecentTraces = append(s.telemetry.RecentTraces, traceRecord{TraceID: traceID, RequestID: requestID, ErrorID: ow.errorID, Method: r.Method, Route: route, Status: ow.status, ResponseBytes: ow.bytes, StartedAt: observedAt, DurationMs: duration.Milliseconds()})
			if len(s.telemetry.RecentTraces) > 200 {
				s.telemetry.RecentTraces = append([]traceRecord(nil), s.telemetry.RecentTraces[len(s.telemetry.RecentTraces)-200:]...)
			}
			s.persistTelemetryLocked()
			s.mu.Unlock()
			record := map[string]any{"level": "info", "event": "http.request", "traceId": traceID, "requestId": requestID, "errorId": ow.errorID, "method": r.Method, "route": route, "status": ow.status, "bytes": ow.bytes, "durationMs": duration.Milliseconds()}
			encoded, _ := json.Marshal(record)
			log.Print(string(encoded))
		}()
		client := directClient(r.RemoteAddr)
		now := s.service.cfg.Now()
		s.mu.Lock()
		window := s.clients[client]
		if window.StartedAt.IsZero() || now.Sub(window.StartedAt) >= time.Minute {
			window = clientWindow{StartedAt: now}
		}
		if window.Count >= s.limits.RequestsPerMinute {
			s.rejections["rate_limit"]++
			s.telemetry.Rejections["rate_limit"]++
			s.mu.Unlock()
			w.Header().Set("Retry-After", strconv.Itoa(max(1, 60-int(now.Sub(window.StartedAt).Seconds()))))
			writeError(ow, http.StatusTooManyRequests, "client request rate exceeded; retry after the advertised interval")
			return
		}
		window.Count++
		s.clients[client] = window
		if len(s.clients) > 10000 {
			for key, value := range s.clients {
				if now.Sub(value.StartedAt) >= 2*time.Minute {
					delete(s.clients, key)
				}
			}
		}
		s.mu.Unlock()
		select {
		case s.inflight <- struct{}{}:
			defer func() { <-s.inflight }()
			next.ServeHTTP(ow, r)
		default:
			s.mu.Lock()
			s.rejections["backpressure"]++
			s.telemetry.Rejections["backpressure"]++
			s.mu.Unlock()
			w.Header().Set("Retry-After", "1")
			writeError(ow, http.StatusServiceUnavailable, "server concurrency capacity reached; retry with backoff")
		}
	})
}

func (s *Server) persistTelemetryLocked() {
	if !s.telemetryOK {
		return
	}
	if err := saveTelemetry(s.service.cfg.TelemetryPath, &s.telemetry); err != nil {
		s.telemetryOK = false
		s.telemetryErr = "telemetry persistence failed"
	}
}
func directClient(remote string) string {
	host, _, err := net.SplitHostPort(remote)
	if err == nil && host != "" {
		return host
	}
	if strings.TrimSpace(remote) == "" {
		return "unknown"
	}
	return remote
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.service.Liveness()) })
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.service.Liveness()) })
	mux.HandleFunc("GET /api/v1/health", s.auth(s.detailedHealth))
	mux.HandleFunc("GET /api/v1/ready", s.auth(s.readiness))
	mux.HandleFunc("GET /api/v1/metrics", s.auth(s.metrics))
	mux.HandleFunc("GET /api/v1/traces", s.auth(s.traces))
	mux.HandleFunc("POST /api/v1/session", s.session)
	mux.HandleFunc("POST /api/v1/session/challenge", s.sessionChallenge)
	mux.HandleFunc("DELETE /api/v1/session", s.auth(s.revokeSession))
	mux.HandleFunc("GET /api/v1/objects", s.auth(s.list))
	mux.HandleFunc("POST /api/v1/objects", s.auth(s.create))
	mux.HandleFunc("POST /api/v1/multipart", s.auth(s.initiateMultipart))
	mux.HandleFunc("GET /api/v1/multipart/{upload}", s.auth(s.getMultipart))
	mux.HandleFunc("PUT /api/v1/multipart/{upload}/parts/{part}", s.auth(s.putMultipartPart))
	mux.HandleFunc("POST /api/v1/multipart/{upload}/complete", s.auth(s.completeMultipart))
	mux.HandleFunc("DELETE /api/v1/multipart/{upload}", s.auth(s.cancelMultipart))
	mux.HandleFunc("POST /api/v1/direct-uploads", s.auth(s.initiateDirectUpload))
	mux.HandleFunc("GET /api/v1/direct-uploads/{upload}", s.auth(s.getDirectUpload))
	mux.HandleFunc("POST /api/v1/direct-uploads/{upload}/complete", s.auth(s.completeDirectUpload))
	mux.HandleFunc("DELETE /api/v1/direct-uploads/{upload}", s.auth(s.cancelDirectUpload))
	mux.HandleFunc("GET /api/v1/objects/{id}", s.auth(s.get))
	mux.HandleFunc("DELETE /api/v1/objects/{id}", s.auth(s.deleteObject))
	mux.HandleFunc("GET /api/v1/objects/{id}/content", s.auth(s.content))
	mux.HandleFunc("PUT /api/v1/objects/{id}/document", s.auth(s.saveDocument))
	mux.HandleFunc("GET /api/v1/objects/{id}/versions", s.auth(s.versions))
	mux.HandleFunc("POST /api/v1/objects/{id}/versions/{version}/restore", s.auth(s.restoreVersion))
	mux.HandleFunc("POST /api/v1/objects/{id}/star", s.auth(s.star))
	mux.HandleFunc("POST /api/v1/objects/{id}/trash", s.auth(s.trash))
	mux.HandleFunc("POST /api/v1/objects/{id}/restore", s.auth(s.restore))
	mux.HandleFunc("GET /api/v1/objects/{id}/grants", s.auth(s.grants))
	mux.HandleFunc("POST /api/v1/objects/{id}/grants", s.auth(s.grant))
	mux.HandleFunc("DELETE /api/v1/objects/{id}/grants/{grant}", s.auth(s.revokeGrant))
	mux.HandleFunc("POST /api/v1/objects/{id}/links", s.auth(s.createLink))
	mux.HandleFunc("GET /api/v1/objects/{id}/links", s.auth(s.links))
	mux.HandleFunc("DELETE /api/v1/objects/{id}/links/{link}", s.auth(s.revokeLink))
	mux.HandleFunc("GET /api/v1/shares/{token}", s.resolveLink)
	mux.HandleFunc("GET /api/v1/shares/{token}/content", s.resolveLinkContent)
	mux.HandleFunc("POST /api/v1/objects/{id}/access-requests", s.auth(s.requestAccess))
	mux.HandleFunc("GET /api/v1/objects/{id}/access-requests", s.auth(s.accessRequests))
	mux.HandleFunc("POST /api/v1/access-requests/{request}/decision", s.auth(s.decideAccess))
	mux.HandleFunc("GET /api/v1/objects/{id}/comments", s.auth(s.comments))
	mux.HandleFunc("POST /api/v1/objects/{id}/comments", s.auth(s.addComment))
	mux.HandleFunc("POST /api/v1/objects/{id}/presence", s.auth(s.presence))
	mux.HandleFunc("GET /api/v1/quota", s.auth(s.quota))
	mux.HandleFunc("GET /api/v1/usage", s.auth(s.usage))
	mux.HandleFunc("GET /api/v1/audit", s.auth(s.audit))
	mux.HandleFunc("GET /api/v1/export", s.auth(s.exportData))
	mux.HandleFunc("GET /api/v1/deletions", s.auth(s.deletions))
	mux.HandleFunc("POST /api/v1/deletions/{deletion}/retry", s.auth(s.retryDeletion))
	mux.HandleFunc("GET /api/v1/ai/status", s.auth(s.aiStatus))
	mux.HandleFunc("POST /api/v1/ai/jobs", s.auth(s.aiJob))
	mux.HandleFunc("GET /api/v1/ai/jobs/{job}", s.auth(s.aiGet))
	mux.HandleFunc("POST /api/v1/ai/jobs/{job}/cancel", s.auth(s.aiCancel))
	mux.HandleFunc("POST /api/v1/ai/jobs/{job}/review", s.auth(s.aiReview))
	return securityHeaders(s.observe(s.exitModeGuard(mux)))
}

func (s *Server) exitModeGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.service.cfg.ExitMode || r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodDelete ||
			(r.Method == http.MethodPost && (r.URL.Path == "/api/v1/session" || r.URL.Path == "/api/v1/session/challenge" || strings.HasSuffix(r.URL.Path, "/trash") || strings.HasSuffix(r.URL.Path, "/cancel") || (strings.HasPrefix(r.URL.Path, "/api/v1/deletions/") && strings.HasSuffix(r.URL.Path, "/retry")))) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("X-YNX-Service-Mode", "user-exit")
		writeError(w, http.StatusLocked, "service is in user-exit mode; new writes are disabled while read, export, revoke, cancel, trash, and delete paths remain available")
	})
}

func (s *Server) detailedHealth(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "audit.read") {
		return
	}
	writeJSON(w, 200, s.service.Health())
}
func (s *Server) metrics(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "audit.read") {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	writeJSON(w, 200, map[string]any{"schemaVersion": 2, "source": "ynx-cloudd persistent RED telemetry", "asOf": s.service.cfg.Now(), "firstObservedAt": s.telemetry.FirstObserved, "routes": s.telemetry.Routes, "rejections": s.telemetry.Rejections, "alerts": evaluateAlerts(s.telemetry, s.telemetryOK), "telemetryPersistence": map[string]any{"healthy": s.telemetryOK, "error": s.telemetryErr}, "inflight": len(s.inflight), "maxConcurrent": s.limits.MaxConcurrent, "requestsPerMinutePerDirectClient": s.limits.RequestsPerMinute, "clientIdentityBoundary": "direct TCP peer; X-Forwarded-For is not trusted", "latencyHistogramBoundsMillis": latencyBoundsMillis, "coverage": "integrity-checked local persistence across process restart; single replica only"})
}

func (s *Server) traces(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "audit.read") {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	writeJSON(w, 200, map[string]any{"schemaVersion": 1, "source": "ynx-cloudd bounded request traces", "asOf": s.service.cfg.Now(), "traces": s.telemetry.RecentTraces, "limit": 200, "coverage": "control-plane HTTP spans with normalized routes; provider child spans are not yet instrumented"})
}

func (s *Server) readiness(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "audit.read") {
		return
	}
	ready, checks := s.service.Readiness()
	s.mu.Lock()
	telemetryOK := s.telemetryOK
	s.mu.Unlock()
	checks["telemetryPersistence"] = telemetryOK
	ready = ready && telemetryOK
	status := http.StatusOK
	if !ready {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{"schemaVersion": 1, "ready": ready, "source": "ynx-cloudd authenticated readiness", "asOf": s.service.cfg.Now(), "mode": s.service.serviceMode(), "checks": checks})
}

type authed func(http.ResponseWriter, *http.Request, Session)

func (s *Server) auth(next authed) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if raw == "" {
			writeError(w, 401, "Sign in with YNX Wallet session required")
			return
		}
		session, err := s.service.Authenticate(raw)
		if err != nil {
			writeError(w, 401, "session expired or revoked")
			return
		}
		if id := r.PathValue("id"); id != "" && strings.HasPrefix(r.URL.Path, "/api/v1/objects/") {
			if err := s.service.CheckObjectProduct(session.Account, id, session.Product); err != nil {
				writeError(w, 403, "object is outside the authenticated product boundary")
				return
			}
		}
		next(w, r, session)
	}
}

func requireScope(w http.ResponseWriter, s Session, scope string) bool {
	for _, v := range s.Scopes {
		if v == scope {
			return true
		}
	}
	writeError(w, 403, "session scope does not allow this action")
	return false
}

func requireProductScope(w http.ResponseWriter, s Session, cloudScope, docsScope string) bool {
	if s.Product == "docs" {
		return requireScope(w, s, docsScope)
	}
	return requireScope(w, s, cloudScope)
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	var envelope WalletSessionEnvelope
	if !decode(w, r, &envelope, 64<<10) {
		return
	}
	token, session, err := s.service.CreateSession(r.Context(), envelope)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"token": token, "session": session})
}

func (s *Server) sessionChallenge(w http.ResponseWriter, r *http.Request) {
	var request struct {
		AuthorizationRequest WalletAuthorizationRequest `json:"authorizationRequest"`
		WalletApproval       WalletApproval             `json:"walletApproval"`
	}
	if !decode(w, r, &request, 48<<10) {
		return
	}
	challenge, err := s.service.CreateWalletChallenge(request.AuthorizationRequest, request.WalletApproval)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, challenge)
}
func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request, _ Session) {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if err := s.service.RevokeSession(token); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(204)
}

func (s *Server) list(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, 400, "invalid page limit")
			return
		}
		limit = parsed
	}
	page, err := s.service.ListPage(a.Account, ListOptions{Product: a.Product, ParentID: r.URL.Query().Get("parentId"), Query: r.URL.Query().Get("q"), View: r.URL.Query().Get("view"), Limit: limit, Cursor: r.URL.Query().Get("cursor")})
	writeResult(w, page, err)
}
func (s *Server) create(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	var req CreateObjectRequest
	if !decode(w, r, &req, MaxUploadBytes*2) {
		return
	}
	req.Product = a.Product
	obj, err := s.service.Create(r.Context(), a.Account, req)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, obj)
}
func (s *Server) initiateMultipart(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	var req struct {
		ParentID     string     `json:"parentId"`
		Name         string     `json:"name"`
		MIME         string     `json:"mime"`
		Encryption   Encryption `json:"encryption"`
		Artifact     *Artifact  `json:"artifact"`
		ExpectedSize int64      `json:"expectedSize"`
		ExpectedHash string     `json:"expectedHash"`
	}
	if !decode(w, r, &req, 32<<10) {
		return
	}
	u, err := s.service.InitiateMultipart(a.Account, CreateObjectRequest{Product: a.Product, ParentID: req.ParentID, Kind: KindFile, Name: req.Name, MIME: req.MIME, Encryption: req.Encryption, Artifact: req.Artifact}, req.ExpectedSize, req.ExpectedHash)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, u)
}
func (s *Server) getMultipart(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	v, err := s.service.GetMultipart(a.Account, r.PathValue("upload"))
	writeResult(w, v, err)
}
func (s *Server) putMultipartPart(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	n, err := strconv.Atoi(r.PathValue("part"))
	if err != nil {
		writeError(w, 400, "invalid part number")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes)
	b, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, 413, "multipart part exceeds bound")
		return
	}
	p, err := s.service.PutMultipartPart(r.Context(), a.Account, r.PathValue("upload"), n, b, strings.ToLower(strings.TrimSpace(r.Header.Get("X-Content-SHA256"))))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 200, p)
}
func (s *Server) completeMultipart(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	var req struct {
		Parts []int `json:"parts"`
	}
	if !decode(w, r, &req, 16<<10) {
		return
	}
	v, err := s.service.CompleteMultipart(r.Context(), a.Account, r.PathValue("upload"), req.Parts)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, v)
}
func (s *Server) cancelMultipart(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	if err := s.service.CancelMultipart(a.Account, r.PathValue("upload")); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) initiateDirectUpload(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	var req struct {
		ParentID     string     `json:"parentId"`
		Name         string     `json:"name"`
		MIME         string     `json:"mime"`
		Encryption   Encryption `json:"encryption"`
		Artifact     *Artifact  `json:"artifact"`
		ExpectedSize int64      `json:"expectedSize"`
		ExpectedHash string     `json:"expectedHash"`
	}
	if !decode(w, r, &req, 32<<10) {
		return
	}
	u, plan, err := s.service.InitiateDirectUpload(r.Context(), a.Account, CreateObjectRequest{Product: a.Product, ParentID: req.ParentID, Kind: KindFile, Name: req.Name, MIME: req.MIME, Encryption: req.Encryption, Artifact: req.Artifact}, req.ExpectedSize, req.ExpectedHash)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"upload": u, "plan": plan})
}
func (s *Server) getDirectUpload(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	v, err := s.service.GetDirectUpload(a.Account, r.PathValue("upload"))
	writeResult(w, v, err)
}
func (s *Server) completeDirectUpload(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	v, err := s.service.CompleteDirectUpload(r.Context(), a.Account, r.PathValue("upload"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, v)
}
func (s *Server) cancelDirectUpload(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	v, err := s.service.CancelDirectUpload(r.Context(), a.Account, r.PathValue("upload"))
	writeResult(w, v, err)
}
func (s *Server) get(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	obj, err := s.service.Get(a.Account, r.PathValue("id"))
	writeResult(w, obj, err)
}
func (s *Server) deleteObject(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	var confirmation struct {
		Confirm string `json:"confirm"`
	}
	if !decode(w, r, &confirmation, 1024) {
		return
	}
	if confirmation.Confirm != "DELETE" {
		writeError(w, http.StatusBadRequest, "permanent deletion requires exact DELETE confirmation")
		return
	}
	if err := s.service.DeleteObject(a.Account, r.PathValue("id")); err != nil {
		var pending DeletionPendingError
		if errors.As(err, &pending) {
			writeJSON(w, http.StatusAccepted, map[string]any{"status": "logical-deletion-complete", "physicalDeletion": "pending", "pendingBlobs": pending.Count})
			return
		}
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) content(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	version, _ := strconv.Atoi(r.URL.Query().Get("version"))
	obj, b, err := s.service.Content(a.Account, r.PathValue("id"), version)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", obj.MIME)
	w.Header().Set("X-Content-SHA256", hashBytes(b))
	w.Header().Set("Content-Disposition", `inline; filename="`+strings.ReplaceAll(obj.Name, "\"", "")+`"`)
	counter := &payloadCountingWriter{ResponseWriter: w}
	http.ServeContent(counter, r, obj.Name, obj.UpdatedAt, bytes.NewReader(b))
	if counter.bytes > 0 {
		if err := s.service.RecordEgress(a.Account, a.Product, obj.ID, counter.bytes, "session"); err != nil {
			log.Printf(`{"level":"error","event":"usage.persist.failed","product":%q,"objectId":%q}`, a.Product, obj.ID)
		}
	}
}
func (s *Server) saveDocument(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "docs" || !requireScope(w, a, "documents.write") {
		return
	}
	var req SaveDocumentRequest
	if !decode(w, r, &req, MaxUploadBytes*2) {
		return
	}
	obj, err := s.service.SaveDocument(r.Context(), a.Account, r.PathValue("id"), req)
	writeResult(w, obj, err)
}
func (s *Server) versions(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	v, err := s.service.Versions(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) restoreVersion(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	n, err := strconv.Atoi(r.PathValue("version"))
	if err != nil {
		writeError(w, 400, "invalid version")
		return
	}
	obj, e := s.service.RestoreVersion(a.Account, r.PathValue("id"), n)
	writeResult(w, obj, e)
}
func (s *Server) star(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	var req struct {
		Starred bool `json:"starred"`
	}
	if !decode(w, r, &req, 1024) {
		return
	}
	obj, err := s.service.SetStar(a.Account, r.PathValue("id"), req.Starred)
	writeResult(w, obj, err)
}
func (s *Server) trash(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	obj, err := s.service.SetTrash(a.Account, r.PathValue("id"), true)
	writeResult(w, obj, err)
}
func (s *Server) restore(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	obj, err := s.service.SetTrash(a.Account, r.PathValue("id"), false)
	writeResult(w, obj, err)
}

func (s *Server) grants(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	g, err := s.service.Grants(a.Account, r.PathValue("id"))
	writeResult(w, g, err)
}
func (s *Server) grant(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	var req struct {
		Principal string     `json:"principal"`
		Role      string     `json:"role"`
		ExpiresAt *time.Time `json:"expiresAt"`
	}
	if !decode(w, r, &req, 4096) {
		return
	}
	g, err := s.service.Grant(a.Account, r.PathValue("id"), req.Principal, req.Role, req.ExpiresAt)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, g)
}
func (s *Server) revokeGrant(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	g, err := s.service.RevokeGrant(a.Account, r.PathValue("id"), r.PathValue("grant"))
	writeResult(w, g, err)
}
func (s *Server) createLink(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	var req struct {
		Role      string    `json:"role"`
		ExpiresAt time.Time `json:"expiresAt"`
	}
	if !decode(w, r, &req, 4096) {
		return
	}
	l, token, err := s.service.CreateLink(a.Account, r.PathValue("id"), req.Role, req.ExpiresAt)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"link": l, "token": token})
}
func (s *Server) links(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	v, err := s.service.Links(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) revokeLink(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	l, err := s.service.RevokeLink(a.Account, r.PathValue("id"), r.PathValue("link"))
	writeResult(w, l, err)
}
func (s *Server) resolveLink(w http.ResponseWriter, r *http.Request) {
	obj, err := s.service.ResolveLink(r.PathValue("token"))
	writeResult(w, obj, err)
}
func (s *Server) resolveLinkContent(w http.ResponseWriter, r *http.Request) {
	obj, b, err := s.service.ResolveLinkContent(r.PathValue("token"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", obj.MIME)
	w.Header().Set("X-Content-SHA256", hashBytes(b))
	counter := &payloadCountingWriter{ResponseWriter: w}
	http.ServeContent(counter, r, obj.Name, obj.UpdatedAt, bytes.NewReader(b))
	if counter.bytes > 0 {
		if err := s.service.RecordEgress(obj.Owner, obj.Product, obj.ID, counter.bytes, "share"); err != nil {
			log.Printf(`{"level":"error","event":"usage.persist.failed","product":%q,"objectId":%q}`, obj.Product, obj.ID)
		}
	}
}
func (s *Server) requestAccess(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	var req struct {
		Role    string `json:"role"`
		Message string `json:"message"`
	}
	if !decode(w, r, &req, 4096) {
		return
	}
	v, err := s.service.RequestAccess(a.Account, r.PathValue("id"), req.Role, req.Message)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, v)
}
func (s *Server) accessRequests(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	v, err := s.service.AccessRequests(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) decideAccess(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	var req struct {
		Decision string `json:"decision"`
	}
	if !decode(w, r, &req, 1024) {
		return
	}
	v, err := s.service.DecideAccess(a.Account, a.Product, r.PathValue("request"), req.Decision)
	writeResult(w, v, err)
}

func (s *Server) comments(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	v, err := s.service.Comments(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) addComment(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "docs" || !requireScope(w, a, "comments.write") {
		return
	}
	var req struct {
		Version  int      `json:"version"`
		Body     string   `json:"body"`
		Mentions []string `json:"mentions"`
	}
	if !decode(w, r, &req, 32<<10) {
		return
	}
	v, err := s.service.AddComment(a.Account, r.PathValue("id"), req.Version, req.Body, req.Mentions)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, v)
}
func (s *Server) presence(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	var req struct {
		Label string `json:"label"`
	}
	if !decode(w, r, &req, 1024) {
		return
	}
	v, err := s.service.Presence(a.Account, r.PathValue("id"), req.Label)
	writeResult(w, v, err)
}
func (s *Server) quota(w http.ResponseWriter, r *http.Request, a Session) {
	used, limit := s.service.Quota(a.Account, a.Product)
	writeJSON(w, 200, map[string]any{"usedBytes": used, "limitBytes": limit, "claim": "bounded local product quota; not unlimited storage"})
}
func (s *Server) usage(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	v, err := s.service.Usage(a.Account, a.Product)
	writeResult(w, v, err)
}
func (s *Server) audit(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "audit.read") {
		return
	}
	v, err := s.service.Audit(a.Account, a.Product)
	writeResult(w, v, err)
}
func (s *Server) exportData(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	body, manifest, err := s.service.ExportOwnedData(r.Context(), a.Account, a.Product)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="ynx-cloud-export.zip"`)
	w.Header().Set("X-Content-SHA256", hashBytes(body))
	w.Header().Set("X-YNX-Export-As-Of", manifest.AsOf.Format(time.RFC3339Nano))
	w.WriteHeader(200)
	counter := &payloadCountingWriter{ResponseWriter: w}
	_, _ = counter.Write(body)
	if counter.bytes > 0 {
		if err := s.service.RecordEgress(a.Account, a.Product, "", counter.bytes, "export"); err != nil {
			log.Printf(`{"level":"error","event":"usage.persist.failed","product":%q,"channel":"export"}`, a.Product)
		}
	}
}
func (s *Server) deletions(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	v, err := s.service.BlobDeletions(a.Account, a.Product)
	writeResult(w, v, err)
}
func (s *Server) retryDeletion(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	v, err := s.service.RetryBlobDeletion(r.Context(), a.Account, a.Product, r.PathValue("deletion"))
	writeResult(w, v, err)
}
func (s *Server) aiStatus(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "ai.use") {
		return
	}
	writeJSON(w, 200, s.service.AIStatus(r.Context()))
}
func (s *Server) aiJob(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "ai.use") {
		return
	}
	var req struct {
		Mode        string   `json:"mode"`
		Instruction string   `json:"instruction"`
		ObjectIDs   []string `json:"objectIds"`
		Versions    []int    `json:"versions"`
		Consent     bool     `json:"consent"`
	}
	if !decode(w, r, &req, 64<<10) {
		return
	}
	v, err := s.service.CreateAIJob(r.Context(), a.Account, a.Product, req.Mode, req.Instruction, req.ObjectIDs, req.Versions, req.Consent)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, v)
}
func (s *Server) aiGet(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "ai.use") {
		return
	}
	v, err := s.service.GetAIJob(a.Account, a.Product, r.PathValue("job"))
	writeResult(w, v, err)
}
func (s *Server) aiCancel(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "ai.use") {
		return
	}
	v, err := s.service.CancelAIJob(a.Account, a.Product, r.PathValue("job"))
	writeResult(w, v, err)
}
func (s *Server) aiReview(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "ai.use") {
		return
	}
	var req struct {
		Decision string `json:"decision"`
	}
	if !decode(w, r, &req, 1024) {
		return
	}
	v, err := s.service.ReviewAI(a.Account, a.Product, r.PathValue("job"), req.Decision)
	writeResult(w, v, err)
}

func decode(w http.ResponseWriter, r *http.Request, out any, max int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, max)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		writeError(w, 400, "invalid JSON request: "+err.Error())
		return false
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		writeError(w, 400, "request must contain one JSON value")
		return false
	}
	return true
}
func writeResult(w http.ResponseWriter, v any, err error) {
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func writeServiceError(w http.ResponseWriter, err error) {
	status := 400
	var conflict ConflictError
	switch {
	case errors.As(err, &conflict):
		writeJSON(w, 409, map[string]any{"error": err.Error(), "current": conflict.Current})
		return
	case errors.Is(err, ErrDenied):
		status = 403
	case errors.Is(err, ErrNotFound):
		status = 404
	case strings.Contains(err.Error(), "quota"):
		status = 413
	case strings.Contains(err.Error(), "unavailable"):
		status = 503
	}
	writeError(w, status, err.Error())
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func securityHeaders(next http.Handler) http.Handler {
	return securityHeadersWithConnectOrigin(next, "")
}
func securityHeadersWithConnectOrigin(next http.Handler, directOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connect := "'self'"
		if origin, err := validatedUploadOrigin(directOrigin); err == nil {
			connect += " " + origin
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src "+connect+"; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

// SecureHandler applies the same browser security boundary to product-local static files.
func SecureHandler(next http.Handler) http.Handler { return securityHeaders(next) }
func SecureHandlerWithDirectUploadOrigin(next http.Handler, origin string) http.Handler {
	return securityHeadersWithConnectOrigin(next, origin)
}
