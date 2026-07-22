package quantlab

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
)

type Server struct {
	service *Service
	mux     *http.ServeMux
	role    string
}

func NewServer(s *Service) *Server {
	return NewRoleServer(s, "all")
}

func NewRoleServer(s *Service, role string) *Server {
	allowed := map[string]bool{"all": true, "research": true, "paper": true, "risk": true}
	if !allowed[role] {
		panic("invalid quant service role")
	}
	v := &Server{service: s, mux: http.NewServeMux(), role: role}
	v.mux.HandleFunc("GET /health", v.health)
	v.mux.HandleFunc("GET /version", v.version)
	v.mux.HandleFunc("GET /v1/snapshot", v.snapshot)
	if role == "all" || role == "research" {
		v.mux.HandleFunc("POST /v1/backtests", v.backtest)
		v.mux.HandleFunc("POST /v1/backtests/from-market", v.backtestFromMarket)
		v.mux.HandleFunc("PUT /v1/strategies/{id}/stage", v.stage)
	}
	if role == "all" || role == "paper" {
		v.mux.HandleFunc("POST /v1/paper/orders", v.paper)
		v.mux.HandleFunc("POST /v1/paper/reconcile", v.reconcile)
	}
	if role == "all" || role == "risk" {
		v.mux.HandleFunc("POST /v1/risk/kill", v.kill)
		v.mux.HandleFunc("POST /v1/testnet/mandates", v.mandate)
		v.mux.HandleFunc("POST /v1/testnet/mandates/{digest}/revoke", v.revokeMandate)
		v.mux.HandleFunc("POST /v1/testnet/orders", v.testnet)
	}
	return v
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodGet && !localPreviewRequest(r) {
		write(w, http.StatusForbidden, map[string]string{"error": "local preview write boundary rejected"})
		return
	}
	s.mux.ServeHTTP(w, r)
}
func localPreviewRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(host)
	if err != nil || ip == nil || !ip.IsLoopback() || r.Header.Get("X-YNX-Preview-Mode") != "local-paper" {
		return false
	}
	origin := strings.TrimRight(r.Header.Get("Origin"), "/")
	return origin == "" || origin == "http://"+r.Host || origin == "https://"+r.Host
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	write(w, 200, map[string]any{"status": "ok", "productId": ProductID, "serviceRole": s.role, "version": Version, "commit": BuildCommit, "mode": "simulated_testnet_only", "liveFundsEnabled": false})
}
func (s *Server) version(w http.ResponseWriter, r *http.Request) {
	write(w, 200, map[string]any{"productId": ProductID, "version": Version, "commit": BuildCommit})
}
func (s *Server) snapshot(w http.ResponseWriter, r *http.Request) {
	write(w, 200, s.service.Snapshot())
}
func (s *Server) backtest(w http.ResponseWriter, r *http.Request) {
	var q BacktestRequest
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.RunBacktest(q)
	respond(w, v, e, 201)
}
func (s *Server) backtestFromMarket(w http.ResponseWriter, r *http.Request) {
	var q struct {
		Strategy    StrategySpec `json:"strategy"`
		Assumptions Assumptions  `json:"assumptions"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.RunBacktestFromMarket(q.Strategy, q.Assumptions)
	respond(w, v, e, 201)
}
func (s *Server) stage(w http.ResponseWriter, r *http.Request) {
	var q LifecycleApproval
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.AdvanceStrategy(r.PathValue("id"), q)
	respond(w, v, e, 200)
}
func (s *Server) revokeMandate(w http.ResponseWriter, r *http.Request) {
	var q struct {
		Actor string `json:"actor"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.RevokeMandate(r.PathValue("digest"), q.Actor)
	respond(w, v, e, 200)
}
func (s *Server) paper(w http.ResponseWriter, r *http.Request) {
	var q struct {
		StrategyHash string `json:"strategyHash"`
		Side         string `json:"side"`
		Amount       int64  `json:"amount"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.ApplyPaperSignalFromMarket(q.StrategyHash, q.Side, q.Amount)
	respond(w, v, e, 201)
}
func (s *Server) reconcile(w http.ResponseWriter, r *http.Request) {
	var q struct{ Cash, Position int64 }
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.Reconcile(q.Cash, q.Position)
	respond(w, v, e, 200)
}
func (s *Server) kill(w http.ResponseWriter, r *http.Request) {
	var q struct {
		Reason string `json:"reason"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.Kill(q.Reason)
	respond(w, v, e, 200)
}
func (s *Server) mandate(w http.ResponseWriter, r *http.Request) {
	var q Mandate
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.RegisterMandate(q)
	respond(w, v, e, 201)
}
func (s *Server) testnet(w http.ResponseWriter, r *http.Request) {
	var q struct {
		MandateDigest  string `json:"mandateDigest"`
		Side           string `json:"side"`
		Price          int64  `json:"price"`
		Amount         int64  `json:"amount"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.SubmitTestnet(q.MandateDigest, q.Side, q.Price, q.Amount, q.IdempotencyKey)
	respond(w, v, e, 201)
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		write(w, 400, map[string]string{"error": "invalid JSON: " + e.Error()})
		return false
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		write(w, 400, map[string]string{"error": "one JSON value required"})
		return false
	}
	return true
}
func respond(w http.ResponseWriter, v any, e error, ok int) {
	if e == nil {
		write(w, ok, v)
		return
	}
	code := 400
	if errors.Is(e, ErrForbidden) {
		code = 403
	} else if errors.Is(e, ErrConflict) {
		code = 409
	} else if errors.Is(e, ErrUnavailable) {
		code = 503
	}
	write(w, code, map[string]string{"error": e.Error()})
}
func write(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
