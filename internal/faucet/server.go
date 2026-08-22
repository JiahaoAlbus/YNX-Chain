package faucet

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const MaxRequestBodyBytes = 16 * 1024

type Server struct {
	service   *Service
	mux       *http.ServeMux
	build     buildinfo.Info
	startedAt time.Time
}

// PublicDependency is deliberately URL-free. Public probes need to distinguish
// an upstream outage from an offline client without learning private topology.
type PublicDependency struct {
	Name     string `json:"name"`
	Required bool   `json:"required"`
	OK       bool   `json:"ok"`
}

// PublicHealth is the stable, topology-safe representation served at /health.
// The internal Health value is still available to in-process metrics, but must
// not cross a public HTTP boundary because it contains the configured RPC URL,
// request-log path, and raw upstream errors.
type PublicHealth struct {
	OK             bool               `json:"ok"`
	Service        string             `json:"service"`
	ChainID        int64              `json:"chainId,omitempty"`
	Height         uint64             `json:"height,omitempty"`
	NativeSymbol   string             `json:"nativeSymbol"`
	UpstreamOK     bool               `json:"upstreamOk"`
	Dependencies   []PublicDependency `json:"dependencies"`
	Build          buildinfo.Info     `json:"build"`
	StartedAt      string             `json:"startedAt"`
	TruthfulStatus string             `json:"truthfulStatus"`
}

// PublicVersion gives installation clients a small, cache-safe source identity
// response. It intentionally does not include endpoints, environment values,
// local paths, configuration, or secret-derived state.
type PublicVersion struct {
	Service      string             `json:"service"`
	Build        buildinfo.Info     `json:"build"`
	StartedAt    string             `json:"startedAt"`
	Dependencies []PublicDependency `json:"dependencies"`
}

func NewServer(service *Service) *Server {
	return NewServerWithBuild(service, buildinfo.Info{})
}

func NewServerWithBuild(service *Service, build buildinfo.Info) *Server {
	s := &Server{service: service, mux: http.NewServeMux(), build: buildinfo.Normalize(build), startedAt: time.Now().UTC()}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /version", s.handleVersion)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
	s.mux.HandleFunc("POST /faucet", s.handleRequest)
	s.mux.HandleFunc("POST /request", s.handleRequest)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	health := s.service.CheckHealth(r.Context())
	status := http.StatusOK
	if !health.OK {
		status = http.StatusBadGateway
	}
	writePublicJSON(w, status, s.publicHealth(health))
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	health := s.service.CheckHealth(r.Context())
	writePublicJSON(w, http.StatusOK, PublicVersion{
		Service:      s.serviceName(health),
		Build:        s.build,
		StartedAt:    s.startedAt.Format(time.RFC3339),
		Dependencies: []PublicDependency{{Name: "chain-rpc", Required: true, OK: health.UpstreamOK}},
	})
}

func (s *Server) publicHealth(health Health) PublicHealth {
	return PublicHealth{
		OK:             health.OK,
		Service:        s.serviceName(health),
		ChainID:        health.ChainID,
		Height:         health.Height,
		NativeSymbol:   health.NativeSymbol,
		UpstreamOK:     health.UpstreamOK,
		Dependencies:   []PublicDependency{{Name: "chain-rpc", Required: true, OK: health.UpstreamOK}},
		Build:          s.build,
		StartedAt:      s.startedAt.Format(time.RFC3339),
		TruthfulStatus: health.TruthfulStatus,
	}
}

func (s *Server) serviceName(health Health) string {
	if health.Service == "" {
		return "ynx-faucetd"
	}
	return health.Service
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte(s.service.Metrics()))
}

func (s *Server) handleRequest(w http.ResponseWriter, r *http.Request) {
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
	resp, status, err := s.service.Request(r.Context(), req, r.RemoteAddr)
	if err != nil {
		writeJSON(w, status, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, status, resp)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writePublicJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, payload)
}
