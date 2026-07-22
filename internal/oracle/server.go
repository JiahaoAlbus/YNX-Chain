package oracle

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var BuildCommit = "development"

type Server struct {
	service *Service
	logger  *slog.Logger
	mux     *http.ServeMux
	metrics *Metrics
}

var traceParentPattern = regexp.MustCompile(`^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$`)

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (writer *statusWriter) WriteHeader(status int) {
	if writer.status != 0 {
		return
	}
	writer.status = status
	writer.ResponseWriter.WriteHeader(status)
}
func (writer *statusWriter) Write(data []byte) (int, error) {
	if writer.status == 0 {
		writer.WriteHeader(http.StatusOK)
	}
	return writer.ResponseWriter.Write(data)
}

func NewServer(service *Service, logger *slog.Logger) (*Server, error) {
	if service == nil {
		return nil, errors.New("oracle service required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	server := &Server{service: service, logger: logger, mux: http.NewServeMux(), metrics: &Metrics{}}
	server.mux.HandleFunc("GET /health", server.health)
	server.mux.HandleFunc("GET /version", server.version)
	server.mux.HandleFunc("GET /prices", server.price)
	server.mux.HandleFunc("GET /v1/prices", server.price)
	server.mux.HandleFunc("GET /v1/providers", server.providers)
	server.mux.HandleFunc("GET /v1/replay", server.replay)
	server.mux.HandleFunc("GET /v1/market-data", server.marketData)
	server.mux.HandleFunc("POST /internal/v1/observations", server.ingest)
	return server, nil
}

func (server *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	requestID := request.Header.Get("X-Request-ID")
	if !safeID(requestID) {
		requestID = randomID("request")
	}
	traceID := ""
	if match := traceParentPattern.FindStringSubmatch(request.Header.Get("traceparent")); len(match) == 4 && match[1] != strings.Repeat("0", 32) && match[2] != strings.Repeat("0", 16) {
		traceID = match[1]
	}
	if traceID == "" {
		traceID = randomHex(16)
	}
	spanID := randomHex(8)
	response.Header().Set("traceparent", "00-"+traceID+"-"+spanID+"-01")
	tracked := &statusWriter{ResponseWriter: response}
	started := time.Now()
	defer func() {
		if recovered := recover(); recovered != nil {
			errorID := randomID("error")
			server.logger.Error("oracle request panic", "request_id", requestID, "trace_id", traceID, "span_id", spanID, "error_id", errorID)
			if tracked.status == 0 {
				writeJSON(tracked, http.StatusInternalServerError, map[string]string{"error": "internal failure", "errorId": errorID})
			}
		}
		status := tracked.status
		if status == 0 {
			status = http.StatusOK
		}
		server.metrics.observe(status, time.Since(started))
	}()
	response.Header().Set("X-Request-ID", requestID)
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	response.Header().Set("X-Frame-Options", "DENY")
	response.Header().Set("Referrer-Policy", "no-referrer")
	response.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
	server.mux.ServeHTTP(tracked, request)
	server.logger.Info("oracle request", "request_id", requestID, "trace_id", traceID, "span_id", spanID, "method", request.Method, "path", request.URL.Path, "status", tracked.status, "duration_ms", time.Since(started).Milliseconds())
}

func (server *Server) MetricsHandler() http.Handler { return server.metrics.Handler() }

func (server *Server) health(response http.ResponseWriter, _ *http.Request) {
	health := server.service.Health()
	status := http.StatusOK
	if health.Status != "ok" {
		status = http.StatusServiceUnavailable
	}
	writeJSON(response, status, health)
}

func (server *Server) version(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"productId": ProductID, "version": Version, "schema": SchemaVersion, "policyVersion": server.service.policy.Version, "normalizerVersion": NormalizerVersion, "storeVersion": StoreVersion, "commit": BuildCommit})
}

func (server *Server) price(response http.ResponseWriter, request *http.Request) {
	market := request.URL.Query().Get("market")
	kind := DataType(request.URL.Query().Get("type"))
	price, err := server.service.Price(market, kind)
	if err != nil {
		server.metrics.priceUnsafe.Add(1)
		status := http.StatusServiceUnavailable
		if errors.Is(err, errInvalid) {
			status = http.StatusBadRequest
		}
		writeJSON(response, status, map[string]any{"price": price, "error": publicError(err), "errorId": randomID("error")})
		return
	}
	server.metrics.priceGood.Add(1)
	writeJSON(response, http.StatusOK, price)
}

func (server *Server) providers(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"schema": SchemaVersion, "source": "YNX Oracle versioned provider registry", "asOf": server.service.now().UTC(), "items": server.service.Providers()})
}

func (server *Server) replay(response http.ResponseWriter, request *http.Request) {
	server.metrics.replayRequests.Add(1)
	asOf, err := time.Parse(time.RFC3339Nano, request.URL.Query().Get("asOf"))
	if err != nil {
		writeFailure(response, http.StatusBadRequest, "invalid replay timestamp")
		return
	}
	market, kind := request.URL.Query().Get("market"), DataType(request.URL.Query().Get("type"))
	items, err := server.service.Replay(market, kind, asOf)
	if err != nil {
		writeFailure(response, http.StatusBadRequest, publicError(err))
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"schema": SchemaVersion, "source": "YNX Oracle reproducible historical replay", "asOf": asOf.UTC(), "items": items})
}

func (server *Server) marketData(response http.ResponseWriter, request *http.Request) {
	limit := 100
	if raw := request.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeFailure(response, http.StatusBadRequest, "invalid limit")
			return
		}
		limit = parsed
	}
	feed, err := server.service.LiveData(request.URL.Query().Get("market"), DataType(request.URL.Query().Get("type")), limit)
	if err != nil {
		status := http.StatusServiceUnavailable
		if errors.Is(err, errInvalid) {
			status = http.StatusBadRequest
		}
		writeJSON(response, status, map[string]any{"feed": feed, "error": publicError(err), "errorId": randomID("error")})
		return
	}
	writeJSON(response, http.StatusOK, feed)
}

func (server *Server) ingest(response http.ResponseWriter, request *http.Request) {
	var observation Observation
	if err := decodeRequest(response, request, &observation, 64<<10); err != nil {
		writeFailure(response, http.StatusBadRequest, err.Error())
		return
	}
	created, err := server.service.Ingest(observation)
	if err != nil {
		server.metrics.ingestRejected.Add(1)
		status := http.StatusUnauthorized
		switch {
		case errors.Is(err, ErrProviderRateLimit):
			status = http.StatusTooManyRequests
		case errors.Is(err, errInvalid):
			status = http.StatusBadRequest
		case errors.Is(err, ErrPersistence):
			status = http.StatusInternalServerError
		}
		writeFailure(response, status, publicError(err))
		return
	}
	server.metrics.ingestAccepted.Add(1)
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(response, status, map[string]any{"accepted": true, "created": created, "observationId": observation.ID, "hash": observation.Hash})
}

func decodeRequest(response http.ResponseWriter, request *http.Request, target any, limit int64) error {
	request.Body = http.MaxBytesReader(response, request.Body, limit)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("invalid request schema")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("one JSON value required")
	}
	return nil
}

func writeFailure(response http.ResponseWriter, status int, message string) {
	writeJSON(response, status, map[string]string{"error": strings.TrimSpace(message), "errorId": randomID("error")})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func publicError(err error) string {
	if err == nil {
		return ""
	}
	switch {
	case errors.Is(err, errInvalid):
		return "invalid request"
	case errors.Is(err, ErrProviderRateLimit):
		return "provider rate limit exceeded"
	case errors.Is(err, ErrProviderNotRegistered):
		return "observation rejected"
	case errors.Is(err, ErrEmergencyPause):
		return ErrEmergencyPause.Error()
	case errors.Is(err, ErrPersistence):
		return "internal persistence failure"
	default:
		message := err.Error()
		if strings.Contains(message, "signature") || strings.Contains(message, "hash") || strings.Contains(message, "sequence") || strings.Contains(message, "provider") {
			return "observation rejected"
		}
		for _, allowed := range []string{"no observations", "all observations rejected as stale, future-dated, inactive, or incompatible", "outlier rejection removed every observation", "price is not safe for authoritative consumption", "no normalized events", "normalized feed is stale"} {
			if message == allowed {
				return message
			}
		}
		return "request failed"
	}
}

func safeID(value string) bool {
	if len(value) < 8 || len(value) > 128 {
		return false
	}
	for _, char := range value {
		if !(char == '-' || char == '_' || char == ':' || char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9') {
			return false
		}
	}
	return true
}

func randomID(prefix string) string {
	return prefix + "_" + randomHex(12)
}

func randomHex(bytes int) string {
	data := make([]byte, bytes)
	_, _ = rand.Read(data)
	return hex.EncodeToString(data)
}
