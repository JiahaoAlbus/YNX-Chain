package quantlab

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type Server struct {
	service *Service
	mux     *http.ServeMux
	role    string
	logger  *slog.Logger
	metrics serverMetrics
}

func NewServer(s *Service) *Server {
	return NewRoleServer(s, "all")
}

func NewRoleServer(s *Service, role string) *Server {
	return NewObservedRoleServer(s, role, os.Stderr)
}

func NewObservedRoleServer(s *Service, role string, logWriter io.Writer) *Server {
	allowed := map[string]bool{"all": true, "research": true, "paper": true, "risk": true}
	if !allowed[role] {
		panic("invalid quant service role")
	}
	v := &Server{service: s, mux: http.NewServeMux(), role: role, logger: newJSONLogger(logWriter)}
	v.mux.HandleFunc("GET /health", v.health)
	v.mux.HandleFunc("GET /version", v.version)
	v.mux.HandleFunc("GET /v1/snapshot", v.snapshot)
	v.mux.HandleFunc("GET /v1/stream", v.stream)
	v.mux.HandleFunc("GET /metrics", v.metricsHandler)
	v.mux.HandleFunc("POST /v1/wallet/sessions/complete", v.completeWalletSession)
	if role == "all" || role == "research" {
		v.mux.HandleFunc("POST /v1/datasets", v.dataset)
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
		v.mux.HandleFunc("POST /v1/testnet/signing-payloads/mandate", v.mandateSigningPayload)
		v.mux.HandleFunc("POST /v1/testnet/signing-payloads/order", v.orderSigningPayload)
	}
	v.mux.HandleFunc("/", v.notFound)
	return v
}
func (s *Server) completeWalletSession(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 256<<10)
	body, err := io.ReadAll(r.Body)
	if err != nil || s.service.cfg.SessionCompleter == nil {
		writeProblem(w, r, http.StatusServiceUnavailable, "wallet_session_unavailable")
		return
	}
	payload, status, err := s.service.cfg.SessionCompleter.CompleteWalletSession(r.Context(), body)
	if err != nil {
		writeProblem(w, r, http.StatusServiceUnavailable, "wallet_session_unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}
func (s *Server) dataset(w http.ResponseWriter, r *http.Request) {
	var q DatasetRecord
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.RegisterDataset(q)
	respond(w, r, v, e, 201)
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	s.observe(w, r)
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
	snapshot := s.service.Snapshot()
	if snapshot["failure"] != nil {
		writeProblem(w, r, http.StatusServiceUnavailable, "state_unavailable")
		return
	}
	paper := snapshot["paper"].(PaperState)
	pendingUnknown := 0
	for _, record := range snapshot["executionLedger"].(map[string]ExecutionLedgerRecord) {
		if record.Status == "reserved_outcome_unknown" {
			pendingUnknown++
		}
	}
	write(w, 200, map[string]any{"status": "ok", "ready": true, "productId": ProductID, "serviceRole": s.role, "version": Version, "commit": BuildCommit, "mode": "simulated_testnet_only", "liveFundsEnabled": false, "storage": s.service.StorageStatus(), "signals": map[string]any{"killSwitch": paper.KillSwitch, "reconciliationDelta": paper.ReconciliationDelta, "pendingUnknownExecutions": pendingUnknown}})
}
func (s *Server) version(w http.ResponseWriter, r *http.Request) {
	write(w, 200, map[string]any{"productId": ProductID, "version": Version, "commit": BuildCommit, "storage": s.service.StorageStatus()})
}
func (s *Server) snapshot(w http.ResponseWriter, r *http.Request) {
	write(w, 200, s.service.Snapshot())
}
func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		HandshakeTimeout: 5 * time.Second,
		CheckOrigin: func(request *http.Request) bool {
			if strings.TrimSpace(request.Header.Get("Origin")) == "" {
				return true
			}
			return localWebSocketOrigin(request)
		},
	}
	connection, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer connection.Close()
	s.metrics.activeWebSockets.Add(1)
	defer s.metrics.activeWebSockets.Add(^uint64(0))
	connection.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if err := connection.WriteJSON(map[string]any{
		"type":       "snapshot",
		"requestId":  requestID(r),
		"traceId":    traceID(r),
		"source":     s.service.StorageSource(),
		"asOf":       time.Now().UTC(),
		"version":    Version,
		"confidence": "authoritative",
		"data":       s.service.Snapshot(),
	}); err != nil {
		return
	}
	// Read until the client closes. This prevents a write-only connection from
	// being retained forever and gives intermediaries a normal close path.
	connection.SetReadLimit(1024)
	connection.SetReadDeadline(time.Now().Add(35 * time.Second))
	connection.SetPongHandler(func(string) error {
		connection.SetReadDeadline(time.Now().Add(35 * time.Second))
		return nil
	})
	for {
		if _, _, err := connection.ReadMessage(); err != nil {
			return
		}
	}
}
func (s *Server) notFound(w http.ResponseWriter, r *http.Request) {
	writeProblem(w, r, http.StatusNotFound, "route_not_found")
}
func localWebSocketOrigin(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(host)
	if err != nil || ip == nil || !ip.IsLoopback() {
		return false
	}
	origin := strings.TrimRight(r.Header.Get("Origin"), "/")
	return origin == "http://"+r.Host || origin == "https://"+r.Host
}
func (s *Server) backtest(w http.ResponseWriter, r *http.Request) {
	var q BacktestRequest
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.RunBacktest(q)
	respond(w, r, v, e, 201)
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
	respond(w, r, v, e, 201)
}
func (s *Server) stage(w http.ResponseWriter, r *http.Request) {
	var q LifecycleApproval
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.AdvanceStrategy(r.PathValue("id"), q)
	respond(w, r, v, e, 200)
}
func (s *Server) revokeMandate(w http.ResponseWriter, r *http.Request) {
	var q struct {
		Actor string `json:"actor"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.RevokeMandate(r.PathValue("digest"), q.Actor)
	respond(w, r, v, e, 200)
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
	respond(w, r, v, e, 201)
}
func (s *Server) reconcile(w http.ResponseWriter, r *http.Request) {
	var q struct{ Cash, Position int64 }
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.Reconcile(q.Cash, q.Position)
	respond(w, r, v, e, 200)
}
func (s *Server) kill(w http.ResponseWriter, r *http.Request) {
	var q struct {
		Reason string `json:"reason"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.Kill(q.Reason)
	respond(w, r, v, e, 200)
}
func (s *Server) mandate(w http.ResponseWriter, r *http.Request) {
	var q Mandate
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.RegisterMandateWithSession(r.Context(), q, exchangeSession(r))
	respond(w, r, v, e, 201)
}

func (s *Server) mandateSigningPayload(w http.ResponseWriter, r *http.Request) {
	var q Mandate
	if !decode(w, r, &q) {
		return
	}
	payload := ExchangeMandateSigningPayload(q)
	write(w, http.StatusOK, map[string]string{"domain": ExchangeQuantAdapterVersion, "payload": string(payload), "digest": hashBytes(payload)})
}

func (s *Server) orderSigningPayload(w http.ResponseWriter, r *http.Request) {
	var q struct {
		Account        string `json:"account"`
		Market         string `json:"market"`
		Side           string `json:"side"`
		Price          int64  `json:"price"`
		Amount         int64  `json:"amount"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decode(w, r, &q) {
		return
	}
	order := TestnetOrder{Market: q.Market, Side: q.Side, Price: q.Price, Amount: q.Amount, IdempotencyKey: q.IdempotencyKey}
	payload := ExchangeOrderSigningPayload(q.Account, order)
	write(w, http.StatusOK, map[string]string{"domain": "ynx-exchange-order-v1", "payload": string(payload), "digest": hashBytes(payload)})
}
func (s *Server) testnet(w http.ResponseWriter, r *http.Request) {
	var q struct {
		MandateDigest   string                 `json:"mandateDigest"`
		Side            string                 `json:"side"`
		Price           int64                  `json:"price"`
		Amount          int64                  `json:"amount"`
		IdempotencyKey  string                 `json:"idempotencyKey"`
		Risk            TestnetRiskObservation `json:"risk"`
		WalletSignature string                 `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, e := s.service.SubmitTestnetWithSession(r.Context(), q.MandateDigest, q.Side, q.Price, q.Amount, q.IdempotencyKey, q.WalletSignature, exchangeSession(r), q.Risk)
	respond(w, r, v, e, 201)
}

func exchangeSession(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get("X-YNX-Quant-Product-Session-Proof"))
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_json")
		return false
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		writeProblem(w, r, http.StatusBadRequest, "single_json_value_required")
		return false
	}
	return true
}
func respond(w http.ResponseWriter, r *http.Request, v any, e error, ok int) {
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
	errorCode := "invalid_request"
	if errors.Is(e, ErrForbidden) {
		errorCode = "forbidden"
	} else if errors.Is(e, ErrConflict) {
		errorCode = "conflict"
	} else if errors.Is(e, ErrUnavailable) {
		errorCode = "unavailable"
	}
	writeProblem(w, r, code, errorCode)
}
func writeProblem(w http.ResponseWriter, r *http.Request, code int, errorCode string) {
	errorID := randomHex(12)
	w.Header().Set("X-YNX-Error-ID", errorID)
	write(w, code, map[string]string{"error": errorCode, "requestId": requestID(r), "errorId": errorID})
}
func write(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
