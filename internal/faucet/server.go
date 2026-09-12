package faucet

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const MaxRequestBodyBytes = 16 * 1024

var defaultFaucetAllowedOrigins = []string{
	"https://ynxweb4.com",
	"https://www.ynxweb4.com",
	"https://faucet.ynxweb4.com",
}

type Server struct {
	service *Service
	mux     *http.ServeMux
	build   buildinfo.Info
	cfg     ServerConfig
}

type ServerConfig struct {
	AllowedOrigins []string
}

func NewServer(service *Service) *Server {
	return NewServerWithBuild(service, buildinfo.Info{})
}

func NewServerWithBuild(service *Service, build buildinfo.Info) *Server {
	return NewServerWithBuildAndConfig(service, build, ServerConfig{})
}

func NewServerWithBuildAndConfig(service *Service, build buildinfo.Info, cfg ServerConfig) *Server {
	normalized := normalizeServerConfig(cfg)
	s := &Server{
		service: service,
		mux:     http.NewServeMux(),
		build:   buildinfo.Normalize(build),
		cfg:     normalized,
	}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if s.allowedWebsiteOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if !s.allowedWebsiteOrigin(origin) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		s.mux.ServeHTTP(w, r)
	})
}

func (s *Server) routes() {
	s.websiteRoutes()
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
	s.mux.HandleFunc("POST /faucet", s.handleRequest)
	s.mux.HandleFunc("POST /request", s.handleRequest)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	health := s.service.CheckHealth(r.Context())
	health.Build = s.build
	status := http.StatusOK
	if !health.OK {
		status = http.StatusBadGateway
	}
	writeJSON(w, status, health)
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte(s.service.Metrics()))
}

func (s *Server) handleRequest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	r.Body = http.MaxBytesReader(w, r.Body, MaxRequestBodyBytes)
	var req Request
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
		return
	}
	resp, status, err := s.service.Request(r.Context(), req, requestClientIdentity(r))
	if err != nil {
		writeJSON(w, status, map[string]any{"error": err.Error(), "requestId": resp.RequestID, "transactionHash": resp.TransactionHash, "status": resp.Status, "retrySameRequest": resp.RetrySameRequest})
		return
	}
	writeJSON(w, status, resp)
}

func (s *Server) allowedWebsiteOrigin(origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return false
	}
	for _, allowed := range s.cfg.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

func requestClientIdentity(r *http.Request) string {
	realIP := strings.TrimSpace(r.Header.Get("X-Real-IP"))
	if parsed := net.ParseIP(realIP); parsed != nil {
		return parsed.String()
	}
	return r.RemoteAddr
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func normalizeServerConfig(cfg ServerConfig) ServerConfig {
	if origins := normalizeAllowedOrigins(cfg.AllowedOrigins); len(origins) > 0 {
		return ServerConfig{AllowedOrigins: origins}
	}
	if value := strings.TrimSpace(os.Getenv("YNX_FAUCET_ALLOWED_ORIGINS")); value != "" {
		if origins := parseCSV(value); len(origins) > 0 {
			return ServerConfig{AllowedOrigins: origins}
		}
	}
	return ServerConfig{AllowedOrigins: append([]string{}, defaultFaucetAllowedOrigins...)}
}

func normalizeAllowedOrigins(values []string) []string {
	var out []string
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func parseCSV(value string) []string {
	var out []string
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}
