package faucet

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const MaxRequestBodyBytes = 16 * 1024

type Server struct {
	service *Service
	mux     *http.ServeMux
	build   buildinfo.Info
}

func NewServer(service *Service) *Server {
	return NewServerWithBuild(service, buildinfo.Info{})
}

func NewServerWithBuild(service *Service, build buildinfo.Info) *Server {
	s := &Server{service: service, mux: http.NewServeMux(), build: buildinfo.Normalize(build)}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
	s.mux.HandleFunc("POST /faucet", s.handleRequest)
	s.mux.HandleFunc("POST /request", s.handleRequest)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
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
