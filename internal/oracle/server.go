package oracle

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

var BuildCommit = "development"

type Server struct {
	service *Service
	logger  *slog.Logger
	mux     *http.ServeMux
}

func NewServer(service *Service, logger *slog.Logger) (*Server, error) {
	if service == nil {
		return nil, errors.New("oracle service required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	server := &Server{service: service, logger: logger, mux: http.NewServeMux()}
	server.mux.HandleFunc("GET /health", server.health)
	server.mux.HandleFunc("GET /version", server.version)
	server.mux.HandleFunc("GET /prices", server.price)
	server.mux.HandleFunc("GET /v1/prices", server.price)
	server.mux.HandleFunc("GET /v1/providers", server.providers)
	server.mux.HandleFunc("GET /v1/replay", server.replay)
	server.mux.HandleFunc("POST /internal/v1/observations", server.ingest)
	return server, nil
}

func (server *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	requestID := request.Header.Get("X-Request-ID")
	if !safeID(requestID) {
		requestID = randomID("request")
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			errorID := randomID("error")
			server.logger.Error("oracle request panic", "request_id", requestID, "error_id", errorID)
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "internal failure", "errorId": errorID})
		}
	}()
	response.Header().Set("X-Request-ID", requestID)
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	response.Header().Set("X-Frame-Options", "DENY")
	response.Header().Set("Referrer-Policy", "no-referrer")
	response.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
	started := time.Now()
	server.mux.ServeHTTP(response, request)
	server.logger.Info("oracle request", "request_id", requestID, "method", request.Method, "path", request.URL.Path, "duration_ms", time.Since(started).Milliseconds())
}

func (server *Server) health(response http.ResponseWriter, _ *http.Request) {
	health := server.service.Health()
	status := http.StatusOK
	if health.Status != "ok" {
		status = http.StatusServiceUnavailable
	}
	writeJSON(response, status, health)
}

func (server *Server) version(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"productId": ProductID, "version": Version, "schema": SchemaVersion, "policyVersion": server.service.policy.Version, "commit": BuildCommit})
}

func (server *Server) price(response http.ResponseWriter, request *http.Request) {
	market := request.URL.Query().Get("market")
	kind := DataType(request.URL.Query().Get("type"))
	price, err := server.service.Price(market, kind)
	if err != nil {
		status := http.StatusServiceUnavailable
		if errors.Is(err, errInvalid) {
			status = http.StatusBadRequest
		}
		writeJSON(response, status, map[string]any{"price": price, "error": publicError(err), "errorId": randomID("error")})
		return
	}
	writeJSON(response, http.StatusOK, price)
}

func (server *Server) providers(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"schema": SchemaVersion, "source": "YNX Oracle versioned provider registry", "asOf": server.service.now().UTC(), "items": server.service.Providers()})
}

func (server *Server) replay(response http.ResponseWriter, request *http.Request) {
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

func (server *Server) ingest(response http.ResponseWriter, request *http.Request) {
	var observation Observation
	if err := decodeRequest(response, request, &observation, 64<<10); err != nil {
		writeFailure(response, http.StatusBadRequest, err.Error())
		return
	}
	created, err := server.service.Ingest(observation)
	if err != nil {
		writeFailure(response, http.StatusUnauthorized, publicError(err))
		return
	}
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
	default:
		message := err.Error()
		if strings.Contains(message, "signature") || strings.Contains(message, "hash") || strings.Contains(message, "sequence") || strings.Contains(message, "provider") {
			return "observation rejected"
		}
		return message
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
	data := make([]byte, 12)
	_, _ = rand.Read(data)
	return prefix + "_" + hex.EncodeToString(data)
}
