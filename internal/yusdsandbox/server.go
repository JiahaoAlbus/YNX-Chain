package yusdsandbox

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

type Server struct {
	service *Service
	mux     *http.ServeMux
}

func NewServer(service *Service) *Server {
	s := &Server{service: service, mux: http.NewServeMux()}
	s.routes()
	return s
}
func (s *Server) Handler() http.Handler { return s.mux }
func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("GET /yusd/snapshot", s.snapshot)
	s.mux.HandleFunc("GET /yusd/accounts/{account}", s.balance)
	s.mux.HandleFunc("GET /yusd/redemptions", s.redemptions)
	s.mux.HandleFunc("GET /yusd/audit", s.audit)
	s.mux.HandleFunc("POST /yusd/reserve-deposits", s.auth(s.deposit))
	s.mux.HandleFunc("POST /yusd/mint", s.auth(s.mint))
	s.mux.HandleFunc("POST /yusd/redemptions", s.auth(s.redeem))
	s.mux.HandleFunc("POST /yusd/redemptions/{id}/fulfill", s.auth(s.fulfill))
	s.mux.HandleFunc("POST /yusd/provider-status", s.auth(s.provider))
	s.mux.HandleFunc("POST /yusd/pause", s.auth(s.pause))
}
func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	snapshot := s.service.Snapshot()
	writeJSON(w, 200, map[string]any{"ok": snapshot.Solvent && snapshot.Reconciled, "service": "ynx-yusd-sandboxd", "source": snapshot.Source, "asOf": snapshot.AsOf, "version": snapshot.Version, "testnetOnly": true, "realityValue": false, "externalReserveAttested": false, "externalExecutionEnabled": false, "productionReady": false, "providerStatus": snapshot.ProviderStatus, "paused": snapshot.Paused, "failure": false})
}
func (s *Server) snapshot(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, s.service.Snapshot())
}
func (s *Server) balance(w http.ResponseWriter, r *http.Request) {
	value, err := s.service.Balance(r.PathValue("account"))
	if err != nil {
		writeError(w, err)
		return
	}
	snapshot := s.service.Snapshot()
	writeJSON(w, 200, map[string]any{"source": snapshot.Source, "asOf": snapshot.AsOf, "version": snapshot.Version, "account": r.PathValue("account"), "balanceUnits": value, "failure": false})
}
func (s *Server) redemptions(w http.ResponseWriter, _ *http.Request) {
	snapshot := s.service.Snapshot()
	items := s.service.Redemptions()
	writeJSON(w, 200, map[string]any{"source": snapshot.Source, "asOf": snapshot.AsOf, "version": snapshot.Version, "coverage": map[string]any{"returned": len(items), "complete": true}, "redemptions": items, "failure": false})
}
func (s *Server) audit(w http.ResponseWriter, _ *http.Request) {
	snapshot := s.service.Snapshot()
	items := s.service.Audit()
	writeJSON(w, 200, map[string]any{"source": snapshot.Source, "asOf": snapshot.AsOf, "version": snapshot.Version, "coverage": map[string]any{"returned": len(items), "complete": true}, "events": items, "failure": false})
}
func (s *Server) deposit(w http.ResponseWriter, r *http.Request) {
	var req MutationRequest
	if !decode(w, r, &req) {
		return
	}
	result, err := s.service.DepositReserve(req)
	writeMutation(w, result, err, 201)
}
func (s *Server) mint(w http.ResponseWriter, r *http.Request) {
	var req MutationRequest
	if !decode(w, r, &req) {
		return
	}
	result, err := s.service.Mint(req)
	writeMutation(w, result, err, 201)
}
func (s *Server) redeem(w http.ResponseWriter, r *http.Request) {
	var req MutationRequest
	if !decode(w, r, &req) {
		return
	}
	result, err := s.service.Redeem(req)
	writeMutation(w, result, err, 202)
}
func (s *Server) fulfill(w http.ResponseWriter, r *http.Request) {
	var req MutationRequest
	if !decode(w, r, &req) {
		return
	}
	result, err := s.service.Fulfill(r.PathValue("id"), req)
	writeMutation(w, result, err, 200)
}
func (s *Server) provider(w http.ResponseWriter, r *http.Request) {
	var req ProviderRequest
	if !decode(w, r, &req) {
		return
	}
	result, err := s.service.SetProvider(req)
	writeMutation(w, result, err, 200)
}
func (s *Server) pause(w http.ResponseWriter, r *http.Request) {
	var req PauseRequest
	if !decode(w, r, &req) {
		return
	}
	result, err := s.service.SetPaused(req)
	writeMutation(w, result, err, 200)
}
func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value := r.Header.Get("X-YNX-YUSD-Sandbox-Key")
		if value == "" {
			value = r.Header.Get("Authorization")
		}
		if !s.service.Authorized(value) {
			writeJSON(w, 401, map[string]any{"error": "valid YUSD Sandbox API key required", "failure": true})
			return
		}
		next(w, r)
	}
}
func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	if strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])) != "application/json" {
		writeJSON(w, 415, map[string]any{"error": "Content-Type application/json is required", "failure": true})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(out) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		writeJSON(w, 400, map[string]any{"error": "request must contain one bounded canonical object", "failure": true})
		return false
	}
	return true
}
func writeMutation[T any](w http.ResponseWriter, result MutationResult[T], err error, status int) {
	if err != nil {
		writeError(w, err)
		return
	}
	if result.Replayed {
		status = 200
	}
	writeJSON(w, status, result)
}
func writeError(w http.ResponseWriter, err error) {
	status := 500
	switch {
	case errors.Is(err, ErrInvalid):
		status = 400
	case errors.Is(err, ErrNotFound):
		status = 404
	case errors.Is(err, ErrConflict):
		status = 409
	case errors.Is(err, ErrUnavailable):
		status = 503
	}
	message := err.Error()
	if status == 500 {
		message = "YUSD sandbox persistence unavailable"
	}
	writeJSON(w, status, map[string]any{"error": message, "failure": true})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
