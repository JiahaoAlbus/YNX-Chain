package exchangeproduct

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/sha3"
)

type Server struct {
	service       *Service
	quant         *QuantExecutionAdapter
	mux           *http.ServeMux
	requests      atomic.Uint64
	errors        atomic.Uint64
	inFlight      atomic.Int64
	durationNanos atomic.Uint64
	concurrency   chan struct{}
	rateMu        sync.Mutex
	rateByPeer    map[string]rateWindow
}

type rateWindow struct {
	started time.Time
	count   int
}

func NewServer(service *Service) *Server {
	s := &Server{service: service, quant: NewQuantExecutionAdapter(service), mux: http.NewServeMux(), concurrency: make(chan struct{}, 128), rateByPeer: map[string]rateWindow{}}
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("GET /ready", s.ready)
	s.mux.HandleFunc("GET /metrics", s.metrics)
	s.mux.HandleFunc("GET /version", s.version)
	s.mux.HandleFunc("GET /v1/config", s.config)
	s.mux.HandleFunc("GET /v1/markets", s.markets)
	s.mux.HandleFunc("GET /v1/orderbook", s.book)
	s.mux.HandleFunc("GET /v1/market-data/trades", s.marketTrades)
	s.mux.HandleFunc("GET /v1/market-data/candles", s.marketCandles)
	s.mux.HandleFunc("GET /v1/solvency", s.solvency)
	s.mux.HandleFunc("GET /v1/solvency/liability-proof", s.liabilityProof)
	s.mux.HandleFunc("GET /v1/liquidity/quote", s.liquidityQuote)
	s.mux.HandleFunc("POST /v1/liquidity/execute", s.liquidityExecute)
	s.mux.HandleFunc("GET /v1/risk", s.risk)
	s.mux.HandleFunc("GET /v1/risk/policy", s.riskPolicy)
	s.mux.HandleFunc("GET /v1/streams/market/snapshot", s.marketStreamSnapshot)
	s.mux.HandleFunc("GET /v1/streams/user/snapshot", s.userStreamSnapshot)
	s.mux.HandleFunc("GET /v1/ws/market", s.marketWebSocket)
	s.mux.HandleFunc("GET /v1/ws/user", s.userWebSocket)
	s.mux.HandleFunc("GET /v1/ws/drop-copy", s.dropCopyWebSocket)
	s.mux.HandleFunc("GET /v1/account", s.account)
	s.mux.HandleFunc("GET /v1/margin/account", s.marginAccount)
	s.mux.HandleFunc("POST /v1/margin/transfer", s.marginTransfer)
	s.mux.HandleFunc("GET /v1/perpetual/orderbook", s.perpetualBook)
	s.mux.HandleFunc("POST /v1/perpetual/orders", s.perpetualOrder)
	s.mux.HandleFunc("POST /v1/perpetual/orders/{id}/cancel", s.cancelPerpetualOrder)
	s.mux.HandleFunc("POST /v1/deposit-intents", s.depositIntent)
	s.mux.HandleFunc("POST /v1/deposits", s.deposit)
	s.mux.HandleFunc("POST /v1/deposits/{id}/refresh", s.refreshDeposit)
	s.mux.HandleFunc("POST /v1/withdrawals/review", s.withdrawal)
	s.mux.HandleFunc("POST /v1/orders", s.order)
	s.mux.HandleFunc("PUT /v1/orders/{id}", s.amend)
	s.mux.HandleFunc("POST /v1/orders/mass-cancel", s.massCancel)
	s.mux.HandleFunc("POST /v1/orders/{id}/cancel", s.cancel)
	s.mux.HandleFunc("POST /v1/conditional-orders", s.conditionalOrder)
	s.mux.HandleFunc("POST /v1/conditional-orders/{id}/cancel", s.cancelConditionalOrder)
	s.mux.HandleFunc("POST /v1/oco", s.oco)
	s.mux.HandleFunc("POST /v1/twap", s.twap)
	s.mux.HandleFunc("POST /v1/twap/{id}/cancel", s.cancelTWAP)
	s.mux.HandleFunc("POST /v1/iceberg", s.iceberg)
	s.mux.HandleFunc("POST /v1/scale", s.scale)
	s.mux.HandleFunc("POST /v1/scale/{id}/cancel", s.cancelScale)
	s.mux.HandleFunc("PUT /v1/dead-man", s.deadMan)
	s.mux.HandleFunc("GET /v1/quant-adapter/capabilities", s.quantCapabilities)
	s.mux.HandleFunc("POST /v1/quant-adapter/account", s.quantAccount)
	s.mux.HandleFunc("POST /v1/quant-adapter/orderbook", s.quantBook)
	s.mux.HandleFunc("POST /v1/quant-adapter/orders", s.quantSubmit)
	s.mux.HandleFunc("PUT /v1/quant-adapter/orders/{id}", s.quantAmend)
	s.mux.HandleFunc("POST /v1/quant-adapter/conditional-orders", s.quantConditional)
	s.mux.HandleFunc("POST /v1/quant-adapter/conditional-orders/{id}/cancel", s.quantCancelConditional)
	s.mux.HandleFunc("POST /v1/quant-adapter/oco", s.quantOCO)
	s.mux.HandleFunc("POST /v1/quant-adapter/twap", s.quantTWAP)
	s.mux.HandleFunc("POST /v1/quant-adapter/twap/{id}/cancel", s.quantCancelTWAP)
	s.mux.HandleFunc("POST /v1/quant-adapter/iceberg", s.quantIceberg)
	s.mux.HandleFunc("POST /v1/quant-adapter/scale", s.quantScale)
	s.mux.HandleFunc("POST /v1/quant-adapter/scale/{id}/cancel", s.quantCancelScale)
	s.mux.HandleFunc("POST /v1/quant-adapter/orders/{id}/cancel", s.quantCancel)
	s.mux.HandleFunc("POST /v1/quant-adapter/mass-cancel", s.quantMassCancel)
	s.mux.HandleFunc("POST /v1/quant-adapter/control", s.quantControl)
	s.mux.HandleFunc("POST /v1/quant-adapter/kill", s.quantKill)
	s.mux.HandleFunc("POST /v1/quant-adapter/reconcile", s.quantReconcile)
	s.mux.HandleFunc("PUT /v1/security", s.security)
	s.mux.HandleFunc("POST /v1/support", s.support)
	s.mux.HandleFunc("POST /v1/ai/drafts", s.ai)
	s.mux.HandleFunc("POST /v1/ai/drafts/{id}/actions", s.aiAction)
	s.mux.HandleFunc("POST /v1/admin/test-credits", s.testCredits)
	s.mux.HandleFunc("POST /v1/admin/risk/oracle/refresh", s.refreshRiskOracle)
	s.mux.HandleFunc("POST /v1/admin/perpetual/funding/settle", s.settlePerpetualFunding)
	s.mux.HandleFunc("POST /v1/admin/perpetual/liquidations/run", s.runPerpetualLiquidations)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
	if !validRequestID(requestID) {
		var raw [16]byte
		if _, err := rand.Read(raw[:]); err == nil {
			requestID = hex.EncodeToString(raw[:])
		} else {
			requestID = fmt.Sprintf("request-%d", time.Now().UnixNano())
		}
	}
	w.Header().Set("X-Request-ID", requestID)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	if !s.allowPeer(r.RemoteAddr, time.Now().UTC()) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "rate_limited", "request rate limit exceeded")
		s.requests.Add(1)
		slog.Warn("exchange_http_rejected", "request_id", requestID, "error_id", w.Header().Get("X-Error-ID"), "reason", "rate_limited", "status", http.StatusTooManyRequests)
		return
	}
	select {
	case s.concurrency <- struct{}{}:
		defer func() { <-s.concurrency }()
	default:
		w.Header().Set("Retry-After", "1")
		writeError(w, http.StatusServiceUnavailable, "capacity_exhausted", "request capacity exhausted")
		s.requests.Add(1)
		s.errors.Add(1)
		slog.Warn("exchange_http_rejected", "request_id", requestID, "error_id", w.Header().Get("X-Error-ID"), "reason", "capacity_exhausted", "status", http.StatusServiceUnavailable)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/v1/ws/") {
		s.mux.ServeHTTP(w, r)
		return
	}
	s.requests.Add(1)
	s.inFlight.Add(1)
	started := time.Now()
	recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	s.mux.ServeHTTP(recorder, r)
	s.inFlight.Add(-1)
	duration := time.Since(started)
	s.durationNanos.Add(uint64(duration))
	if recorder.status >= 500 {
		s.errors.Add(1)
	}
	route := r.Pattern
	if route == "" {
		route = "unmatched"
	}
	slog.Info("exchange_http_request", "request_id", requestID, "error_id", w.Header().Get("X-Error-ID"), "method", r.Method, "route", route, "status", recorder.status, "duration_ms", float64(duration.Microseconds())/1000)
}

func (s *Server) allowPeer(remoteAddr string, now time.Time) bool {
	peer := remoteAddr
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		peer = host
	}
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	if _, exists := s.rateByPeer[peer]; !exists && len(s.rateByPeer) >= 10_000 {
		for key, candidate := range s.rateByPeer {
			if now.Sub(candidate.started) >= time.Minute {
				delete(s.rateByPeer, key)
			}
		}
		if len(s.rateByPeer) >= 10_000 {
			peer = "__overflow__"
		}
	}
	window := s.rateByPeer[peer]
	if window.started.IsZero() || now.Sub(window.started) >= time.Minute {
		window = rateWindow{started: now}
	}
	window.count++
	s.rateByPeer[peer] = window
	return window.count <= 300
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func validRequestID(value string) bool {
	if len(value) < 8 || len(value) > 128 {
		return false
	}
	for _, r := range value {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.') {
			return false
		}
	}
	return true
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"status": "live", "productId": ProductID, "version": Version, "commit": BuildCommit, "venue": "owned deterministic testnet only", "chainId": ChainID, "productionCustody": false})
}
func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	s.service.mu.Lock()
	stateCopy := cloneState(s.service.state)
	_, errAudit := normalizeAuditChain(&stateCopy)
	errEvents := verifyExecutionChain(&stateCopy)
	expectedIntegrity, errIntegrity := stateIntegrity(stateCopy)
	integrityValid := errIntegrity == nil && expectedIntegrity == stateCopy.IntegrityHash
	schema := s.service.state.SchemaVersion
	s.service.mu.Unlock()
	if errAudit != nil || errEvents != nil || !integrityValid || schema != currentStateSchemaVersion {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "not_ready", "stateIntegrity": false, "schemaVersion": schema, "expectedSchemaVersion": currentStateSchemaVersion})
		return
	}
	status := "ready_local_engine"
	if s.service.cfg.DeployedPublic {
		status = "ready_public_testnet"
	}
	writeJSON(w, 200, map[string]any{"status": status, "stateIntegrity": true, "schemaVersion": schema, "integrations": s.service.Integrations(), "deployedPublic": s.service.cfg.DeployedPublic})
}
func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	requests := s.requests.Load()
	fmt.Fprintf(w, "# TYPE ynx_exchange_http_requests_total counter\nynx_exchange_http_requests_total %d\n", requests)
	fmt.Fprintf(w, "# TYPE ynx_exchange_http_errors_total counter\nynx_exchange_http_errors_total %d\n", s.errors.Load())
	fmt.Fprintf(w, "# TYPE ynx_exchange_http_in_flight gauge\nynx_exchange_http_in_flight %d\n", s.inFlight.Load())
	fmt.Fprintf(w, "# TYPE ynx_exchange_http_duration_seconds_total counter\nynx_exchange_http_duration_seconds_total %.9f\n", float64(s.durationNanos.Load())/float64(time.Second))
}
func (s *Server) version(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"productId": ProductID, "version": Version, "commit": BuildCommit})
}
func (s *Server) config(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"chainId": ChainID, "evmChainId": EVMChainID, "nativeAsset": NativeAsset, "custodyAddress": s.service.state.CustodyAddress, "networks": s.service.Networks(), "integrations": s.service.Integrations(), "warnings": []string{"Not an exchange listing", "Not production custody", "No third-party liquidity, price, volume or market depth"}})
}
func (s *Server) markets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"markets": Markets(), "source": "YNX-owned deterministic order state only"})
}
func (s *Server) book(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.service.Book()) }

func (s *Server) solvency(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.service.SolvencySnapshot())
}

func (s *Server) liabilityProof(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:read")
	if !ok {
		return
	}
	asset := strings.TrimSpace(r.URL.Query().Get("asset"))
	if asset == "" {
		asset = NativeAsset
	}
	proof, err := s.service.LiabilityProof(session.Account, asset)
	respond(w, proof, err, http.StatusOK)
}

func (s *Server) liquidityQuote(w http.ResponseWriter, r *http.Request) {
	quote, err := s.service.LiquidityQuote(liquidityRequestFromQuery(r.URL.Query()))
	respond(w, quote, err, http.StatusOK)
}

func (s *Server) liquidityExecute(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q LiquidityExecutionRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.ExecuteLiquidityRoute(session, q)
	respond(w, v, err, http.StatusOK)
}

func (s *Server) risk(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.service.RiskSnapshot())
}

func (s *Server) riskPolicy(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, PerpetualPolicy())
}

func (s *Server) refreshRiskOracle(w http.ResponseWriter, r *http.Request) {
	if !s.service.Authorized(r.Header.Get("Authorization")) {
		respond(w, nil, ErrUnauthorized, http.StatusOK)
		return
	}
	snapshot, err := s.service.RefreshRiskOracle()
	respond(w, snapshot, err, http.StatusOK)
}
func (s *Server) marketTrades(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"market": DefaultMarket, "source": "YNX-owned deterministic matched trades only", "externalPrice": false, "trades": s.service.PublicTrades(1000)})
}
func (s *Server) marketCandles(w http.ResponseWriter, r *http.Request) {
	market := strings.TrimSpace(r.URL.Query().Get("market"))
	if market == "" {
		market = DefaultMarket
	}
	if market != DefaultMarket && market != DefaultPerpetualMarket {
		writeError(w, http.StatusBadRequest, "invalid_market", "market is not supported")
		return
	}
	interval := int64(300)
	if raw := strings.TrimSpace(r.URL.Query().Get("interval")); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || !candleIntervals[value] {
			writeError(w, http.StatusBadRequest, "invalid_interval", "interval must be one of 60, 300, 900, 3600, 14400 or 86400 seconds")
			return
		}
		interval = value
	}
	limit := 200
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 500 {
			writeError(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 500")
			return
		}
		limit = value
	}
	writeJSON(w, http.StatusOK, map[string]any{"market": market, "intervalSeconds": interval, "source": "persisted deterministic matching-engine fills only; empty intervals omitted", "externalPrice": false, "candles": s.service.Candles(market, interval, limit)})
}
func (s *Server) marketStreamSnapshot(w http.ResponseWriter, r *http.Request) {
	v, err := s.service.StreamSnapshot("market", "")
	respond(w, v, err, 200)
}
func (s *Server) userStreamSnapshot(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:read")
	if !ok {
		return
	}
	v, err := s.service.StreamSnapshot("user", session.Account)
	respond(w, v, err, 200)
}
func (s *Server) marketWebSocket(w http.ResponseWriter, r *http.Request) {
	s.serveExecutionWebSocket(w, r, "market", "")
}
func (s *Server) userWebSocket(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:read")
	if !ok {
		return
	}
	s.serveExecutionWebSocket(w, r, "user", session.Account)
}
func (s *Server) dropCopyWebSocket(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:read")
	if !ok {
		return
	}
	s.serveExecutionWebSocket(w, r, "user", session.Account)
}

var executionUpgrader = websocket.Upgrader{HandshakeTimeout: 5 * time.Second, ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: func(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && strings.EqualFold(u.Host, r.Host) && (u.Scheme == "http" || u.Scheme == "https")
}}

func (s *Server) serveExecutionWebSocket(w http.ResponseWriter, r *http.Request, stream, account string) {
	after := int64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("after")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			writeJSON(w, 400, map[string]string{"error": "after must be a non-negative sequence"})
			return
		}
		after = parsed
	}
	conn, err := executionUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(4096)
	_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	cursor := after
	if after == 0 {
		snapshot, err := s.service.StreamSnapshot(stream, account)
		if err != nil || !writeWS(conn, map[string]any{"type": "snapshot", "snapshot": snapshot}) {
			return
		}
		cursor = snapshot.Sequence
	} else {
		events, current, err := s.service.ExecutionEvents(after, stream, account, 1000)
		if err != nil {
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "sequence gap; fetch snapshot"), time.Now().Add(time.Second))
			return
		}
		if !writeWS(conn, map[string]any{"type": "replay", "after": after, "current": current, "events": events}) {
			return
		}
		cursor = current
	}
	poll := time.NewTicker(200 * time.Millisecond)
	ping := time.NewTicker(20 * time.Second)
	defer poll.Stop()
	defer ping.Stop()
	for {
		select {
		case <-done:
			return
		case <-poll.C:
			events, current, err := s.service.ExecutionEvents(cursor, stream, account, 1000)
			if err != nil {
				return
			}
			for _, event := range events {
				if !writeWS(conn, map[string]any{"type": "event", "event": event}) {
					return
				}
			}
			cursor = current
		case <-ping.C:
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
				return
			}
		}
	}
}

func writeWS(conn *websocket.Conn, value any) bool {
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return conn.WriteJSON(value) == nil
}
func (s *Server) account(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:read")
	if !ok {
		return
	}
	writeJSON(w, 200, s.service.Snapshot(session.Account))
}
func (s *Server) marginAccount(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:read")
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, s.service.MarginSnapshot(session.Account))
}
func (s *Server) marginTransfer(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q MarginTransferRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.TransferMarginCollateral(session, q)
	respond(w, v, err, http.StatusOK)
}
func (s *Server) perpetualBook(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.service.PerpetualBook())
}
func (s *Server) perpetualOrder(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q PlacePerpetualOrderRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.PlacePerpetualOrder(session, q)
	respond(w, v, err, http.StatusCreated)
}
func (s *Server) cancelPerpetualOrder(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q CancelPerpetualOrderRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CancelPerpetualOrder(session, r.PathValue("id"), q)
	respond(w, v, err, http.StatusOK)
}
func (s *Server) depositIntent(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:deposit")
	if !ok {
		return
	}
	var q struct {
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CreateDepositIntent(session, q.IdempotencyKey)
	respond(w, v, err, 201)
}
func (s *Server) deposit(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:deposit")
	if !ok {
		return
	}
	var q struct {
		IntentID       string `json:"intentId"`
		TxHash         string `json:"txHash"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.ObserveDeposit(session, q.IntentID, q.TxHash, q.IdempotencyKey)
	respond(w, v, err, 201)
}
func (s *Server) refreshDeposit(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:deposit")
	if !ok {
		return
	}
	v, err := s.service.RefreshDeposit(session, r.PathValue("id"))
	respond(w, v, err, 200)
}
func (s *Server) withdrawal(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:withdrawal-review")
	if !ok {
		return
	}
	var q WithdrawalReviewRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.ReviewWithdrawal(session, q)
	respond(w, v, err, 201)
}
func (s *Server) order(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q PlaceOrderRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.PlaceOrder(session, q)
	respond(w, v, err, 201)
}
func (s *Server) cancel(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q struct {
		IdempotencyKey  string `json:"idempotencyKey"`
		WalletSignature string `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CancelOrder(session, r.PathValue("id"), q.IdempotencyKey, q.WalletSignature)
	respond(w, v, err, 200)
}
func (s *Server) amend(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q AmendOrderRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.AmendOrder(session, r.PathValue("id"), q)
	respond(w, v, err, 200)
}
func (s *Server) conditionalOrder(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q ConditionalOrderRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CreateConditionalOrder(session, q)
	respond(w, v, err, 201)
}
func (s *Server) cancelConditionalOrder(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q struct {
		IdempotencyKey  string `json:"idempotencyKey"`
		WalletSignature string `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CancelConditionalOrder(session, r.PathValue("id"), q.IdempotencyKey, q.WalletSignature)
	respond(w, v, err, 200)
}
func (s *Server) oco(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q OCORequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CreateOCO(session, q)
	respond(w, v, err, 201)
}
func (s *Server) twap(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q TWAPRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CreateTWAP(session, q)
	respond(w, v, err, 201)
}
func (s *Server) cancelTWAP(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q struct {
		IdempotencyKey  string `json:"idempotencyKey"`
		WalletSignature string `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CancelTWAP(session, r.PathValue("id"), q.IdempotencyKey, q.WalletSignature)
	respond(w, v, err, 200)
}
func (s *Server) iceberg(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q IcebergRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CreateIceberg(session, q)
	respond(w, v, err, 201)
}
func (s *Server) scale(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q ScaleRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CreateScale(session, q)
	respond(w, v, err, 201)
}
func (s *Server) cancelScale(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q struct {
		IdempotencyKey  string `json:"idempotencyKey"`
		WalletSignature string `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CancelScale(session, r.PathValue("id"), q.IdempotencyKey, q.WalletSignature)
	respond(w, v, err, 200)
}
func (s *Server) massCancel(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q struct {
		Market          string `json:"market"`
		IdempotencyKey  string `json:"idempotencyKey"`
		WalletSignature string `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.MassCancel(session, q.Market, q.IdempotencyKey, q.WalletSignature)
	respond(w, v, err, 200)
}
func (s *Server) deadMan(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q DeadManRequest
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.ConfigureDeadMan(session, q)
	respond(w, v, err, 200)
}

func (s *Server) quantCapabilities(w http.ResponseWriter, r *http.Request) {
	markets, source := s.quant.Markets()
	writeJSON(w, 200, map[string]any{"version": QuantAdapterVersion, "capabilities": QuantCapabilities(), "markets": markets, "source": source})
}

func (s *Server) quantAccount(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:create")
	if !ok {
		return
	}
	var q struct {
		Mandate QuantMandate `json:"mandate"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.Account(session, q.Mandate)
	respond(w, v, err, 200)
}

func (s *Server) quantBook(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:account")
	if !ok {
		return
	}
	var q struct {
		Mandate QuantMandate `json:"mandate"`
	}
	if !decode(w, r, &q) {
		return
	}
	book, source, err := s.quant.OrderBook(session, q.Mandate)
	respond(w, map[string]any{"book": book, "source": source}, err, 200)
}

func (s *Server) quantSubmit(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate QuantMandate      `json:"mandate"`
		Order   PlaceOrderRequest `json:"order"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.Submit(session, q.Mandate, q.Order)
	respond(w, v, err, 201)
}

func (s *Server) quantCancel(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate         QuantMandate `json:"mandate"`
		IdempotencyKey  string       `json:"idempotencyKey"`
		WalletSignature string       `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.Cancel(session, q.Mandate, r.PathValue("id"), q.IdempotencyKey, q.WalletSignature)
	respond(w, v, err, 200)
}

func (s *Server) quantAmend(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate QuantMandate      `json:"mandate"`
		Amend   AmendOrderRequest `json:"amend"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.Amend(session, q.Mandate, r.PathValue("id"), q.Amend)
	respond(w, v, err, 200)
}

func (s *Server) quantConditional(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate     QuantMandate            `json:"mandate"`
		Conditional ConditionalOrderRequest `json:"conditional"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.SubmitConditional(session, q.Mandate, q.Conditional)
	respond(w, v, err, 201)
}

func (s *Server) quantCancelConditional(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate         QuantMandate `json:"mandate"`
		IdempotencyKey  string       `json:"idempotencyKey"`
		WalletSignature string       `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.CancelConditional(session, q.Mandate, r.PathValue("id"), q.IdempotencyKey, q.WalletSignature)
	respond(w, v, err, 200)
}

func (s *Server) quantOCO(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate QuantMandate `json:"mandate"`
		OCO     OCORequest   `json:"oco"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.SubmitOCO(session, q.Mandate, q.OCO)
	respond(w, v, err, 201)
}

func (s *Server) quantTWAP(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate QuantMandate `json:"mandate"`
		TWAP    TWAPRequest  `json:"twap"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.SubmitTWAP(session, q.Mandate, q.TWAP)
	respond(w, v, err, 201)
}

func (s *Server) quantCancelTWAP(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate         QuantMandate `json:"mandate"`
		IdempotencyKey  string       `json:"idempotencyKey"`
		WalletSignature string       `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.CancelTWAP(session, q.Mandate, r.PathValue("id"), q.IdempotencyKey, q.WalletSignature)
	respond(w, v, err, 200)
}

func (s *Server) quantIceberg(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate QuantMandate   `json:"mandate"`
		Iceberg IcebergRequest `json:"iceberg"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.SubmitIceberg(session, q.Mandate, q.Iceberg)
	respond(w, v, err, 201)
}

func (s *Server) quantScale(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate QuantMandate `json:"mandate"`
		Scale   ScaleRequest `json:"scale"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.SubmitScale(session, q.Mandate, q.Scale)
	respond(w, v, err, 201)
}

func (s *Server) quantCancelScale(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate         QuantMandate `json:"mandate"`
		IdempotencyKey  string       `json:"idempotencyKey"`
		WalletSignature string       `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.CancelScale(session, q.Mandate, r.PathValue("id"), q.IdempotencyKey, q.WalletSignature)
	respond(w, v, err, 200)
}

func (s *Server) quantMassCancel(w http.ResponseWriter, r *http.Request) {
	s.quantMassCancelAction(w, r, false)
}

func (s *Server) quantKill(w http.ResponseWriter, r *http.Request) {
	s.quantMassCancelAction(w, r, true)
}

func (s *Server) quantControl(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate         QuantMandate `json:"mandate"`
		Action          string       `json:"action"`
		IdempotencyKey  string       `json:"idempotencyKey"`
		WalletSignature string       `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.Control(session, q.Mandate, q.Action, q.IdempotencyKey, q.WalletSignature)
	respond(w, v, err, 200)
}

func (s *Server) quantMassCancelAction(w http.ResponseWriter, r *http.Request, kill bool) {
	session, ok := s.authQuant(w, r, "quant:mandate:execute")
	if !ok {
		return
	}
	var q struct {
		Mandate         QuantMandate `json:"mandate"`
		IdempotencyKey  string       `json:"idempotencyKey"`
		WalletSignature string       `json:"walletSignature"`
	}
	if !decode(w, r, &q) {
		return
	}
	var v CancelResult
	var err error
	if kill {
		v, err = s.quant.Kill(session, q.Mandate, q.IdempotencyKey, q.WalletSignature)
	} else {
		v, err = s.quant.MassCancel(session, q.Mandate, q.IdempotencyKey, q.WalletSignature)
	}
	respond(w, v, err, 200)
}

func (s *Server) quantReconcile(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authQuant(w, r, "quant:account")
	if !ok {
		return
	}
	var q struct {
		Mandate QuantMandate `json:"mandate"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.quant.Reconcile(session, q.Mandate)
	respond(w, v, err, 200)
}
func (s *Server) security(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:read")
	if !ok {
		return
	}
	var q SecuritySettings
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.UpdateSecurity(session, q)
	respond(w, v, err, 200)
}
func (s *Server) support(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:read")
	if !ok {
		return
	}
	var q struct {
		Category       string `json:"category"`
		Message        string `json:"message"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CreateSupport(session, q.Category, q.Message, q.IdempotencyKey)
	respond(w, v, err, 201)
}
func (s *Server) ai(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:ai")
	if !ok {
		return
	}
	var q struct {
		Kind           string   `json:"kind"`
		Prompt         string   `json:"prompt"`
		ContextClasses []string `json:"contextClasses"`
		Permission     bool     `json:"permission"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.DraftAI(session, q.Kind, q.Prompt, q.ContextClasses, q.Permission)
	respond(w, v, err, 201)
}
func (s *Server) aiAction(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:ai")
	if !ok {
		return
	}
	var q struct {
		Action string `json:"action"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.ReviewAI(session, r.PathValue("id"), q.Action)
	respond(w, v, err, 200)
}
func (s *Server) testCredits(w http.ResponseWriter, r *http.Request) {
	var q struct {
		Account        string `json:"account"`
		AmountMicro    int64  `json:"amountMicro"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CreditTestQuote(r.Header.Get("Authorization"), q.Account, q.AmountMicro, q.IdempotencyKey)
	respond(w, v, err, 201)
}
func (s *Server) settlePerpetualFunding(w http.ResponseWriter, r *http.Request) {
	if !s.service.Authorized(r.Header.Get("Authorization")) {
		respond(w, nil, ErrUnauthorized, http.StatusOK)
		return
	}
	v, err := s.service.SettlePerpetualFunding()
	respond(w, v, err, http.StatusOK)
}
func (s *Server) runPerpetualLiquidations(w http.ResponseWriter, r *http.Request) {
	if !s.service.Authorized(r.Header.Get("Authorization")) {
		respond(w, nil, ErrUnauthorized, http.StatusOK)
		return
	}
	v, err := s.service.RunPerpetualLiquidations()
	respond(w, v, err, http.StatusOK)
}
func (s *Server) auth(w http.ResponseWriter, r *http.Request, scope string) (WalletSession, bool) {
	v, err := s.service.Authenticate(r.Header.Get("X-YNX-Product-Session-Proof"), scope)
	if err != nil {
		respond(w, nil, err, 200)
		return WalletSession{}, false
	}
	return v, true
}

func (s *Server) authQuant(w http.ResponseWriter, r *http.Request, scope string) (WalletSession, bool) {
	v, err := s.service.AuthenticateQuant(r.Header.Get("X-YNX-Product-Session-Proof"), scope)
	if err != nil {
		respond(w, nil, err, 200)
		return WalletSession{}, false
	}
	return v, true
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "invalid JSON request")
		return false
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		writeError(w, http.StatusBadRequest, "multiple_json_values", "request must contain one JSON value")
		return false
	}
	return true
}
func respond(w http.ResponseWriter, v any, err error, success int) {
	if err == nil {
		writeJSON(w, success, v)
		return
	}
	status := 500
	code := "internal_error"
	message := "internal server error"
	switch {
	case errors.Is(err, ErrInvalid):
		status = 400
		code, message = "invalid_request", ErrInvalid.Error()
	case errors.Is(err, ErrUnauthorized):
		status = 401
		code, message = "unauthorized", ErrUnauthorized.Error()
	case errors.Is(err, ErrForbidden):
		status = 403
		code, message = "forbidden", ErrForbidden.Error()
	case errors.Is(err, ErrNotFound):
		status = 404
		code, message = "not_found", ErrNotFound.Error()
	case errors.Is(err, ErrConflict):
		status = 409
		code, message = "conflict", ErrConflict.Error()
	case errors.Is(err, ErrInsufficient):
		status = 422
		code, message = "insufficient_balance", ErrInsufficient.Error()
	case errors.Is(err, ErrUnavailable):
		status = 503
		code, message = "unavailable", ErrUnavailable.Error()
	}
	writeError(w, status, code, message)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	errorID := newCorrelationID("error")
	requestID := w.Header().Get("X-Request-ID")
	w.Header().Set("X-Error-ID", errorID)
	writeJSON(w, status, map[string]string{"error": message, "code": code, "requestId": requestID, "errorId": errorID})
}

func newCorrelationID(prefix string) string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return prefix + "-" + hex.EncodeToString(raw[:])
	}
	return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

type IndexerChainReader struct {
	BaseURL string
	Client  *http.Client
}

type HTTPGatewayAuthorizer struct {
	BaseURL string
	Client  *http.Client
}

func (g HTTPGatewayAuthorizer) Authorize(proof, scope, clientID, bundleID string) (WalletSession, error) {
	if proof == "" || scope == "" || clientID == "" || bundleID == "" {
		return WalletSession{}, ErrUnauthorized
	}
	client := g.Client
	if client == nil {
		client = http.DefaultClient
	}
	body := []byte(`{"requiredScopes":["` + scope + `"]}`)
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(g.BaseURL, "/")+"/v1/wallet/sessions/introspect", strings.NewReader(string(body)))
	if err != nil {
		return WalletSession{}, ErrUnavailable
	}
	req.Header.Set("X-YNX-Product-Session-Proof", proof)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return WalletSession{}, ErrUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return WalletSession{}, ErrUnauthorized
	}
	if resp.StatusCode == http.StatusForbidden {
		return WalletSession{}, ErrForbidden
	}
	if resp.StatusCode != http.StatusOK {
		return WalletSession{}, ErrUnavailable
	}
	var envelope struct {
		OK     bool `json:"ok"`
		Result struct {
			Active  bool `json:"active"`
			Session struct {
				VerifierVersion  string   `json:"verifierVersion"`
				ProductClientID  string   `json:"productClientId"`
				BundleID         string   `json:"bundleId"`
				Account          string   `json:"account"`
				AccountPublicKey string   `json:"accountPublicKey"`
				ProductDeviceKey string   `json:"productDeviceKey"`
				SessionBinding   string   `json:"sessionBinding"`
				ExpiresAt        string   `json:"expiresAt"`
				Scopes           []string `json:"scopes"`
			} `json:"session"`
		} `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&envelope); err != nil || !envelope.OK || !envelope.Result.Active {
		return WalletSession{}, ErrUnavailable
	}
	v := envelope.Result.Session
	account, err := nativewallet.NormalizeNativeAddress(v.Account)
	if err != nil || v.VerifierVersion != "wallet-auth-v1" || v.ProductClientID != clientID || v.BundleID != bundleID || len(v.AccountPublicKey) != 66 || len(v.ProductDeviceKey) != 44 || len(v.SessionBinding) != 64 {
		return WalletSession{}, ErrUnauthorized
	}
	if derived, deriveErr := walletAccount(v.AccountPublicKey); deriveErr != nil || derived != account {
		return WalletSession{}, ErrUnauthorized
	}
	expires, err := time.Parse(time.RFC3339Nano, v.ExpiresAt)
	if err != nil || !time.Now().UTC().Before(expires) {
		return WalletSession{}, ErrUnauthorized
	}
	found := false
	for _, candidate := range v.Scopes {
		if candidate == scope {
			found = true
			break
		}
	}
	if !found {
		return WalletSession{}, ErrForbidden
	}
	return WalletSession{Account: account, WalletPublicKey: strings.ToLower(v.AccountPublicKey), ProductDeviceKey: v.ProductDeviceKey, SessionBinding: v.SessionBinding, Scopes: append([]string(nil), v.Scopes...), ExpiresAt: expires}, nil
}

func walletAccount(publicKeyHex string) (string, error) {
	encoded, err := hex.DecodeString(publicKeyHex)
	if err != nil || len(encoded) != 33 {
		return "", ErrUnauthorized
	}
	key, err := secp256k1.ParsePubKey(encoded)
	if err != nil {
		return "", ErrUnauthorized
	}
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(key.SerializeUncompressed()[1:])
	sum := h.Sum(nil)
	evm, err := accountaddress.FromBytes(sum[len(sum)-accountaddress.PayloadLength:])
	if err != nil {
		return "", err
	}
	return accountaddress.Encode(evm)
}

func (r IndexerChainReader) Transfer(hash string) (ChainTransfer, error) {
	client := r.Client
	if client == nil {
		client = http.DefaultClient
	}
	base := strings.TrimRight(r.BaseURL, "/")
	var tx struct {
		Hash, From, To string
		Amount         int64  `json:"amount"`
		BlockNum       uint64 `json:"blockNumber"`
	}
	if err := getJSON(client, base+"/txs/"+hash, &tx); err != nil {
		return ChainTransfer{}, err
	}
	var overview struct {
		Height uint64 `json:"height"`
	}
	if err := getJSON(client, base+"/ynx/overview", &overview); err != nil {
		return ChainTransfer{}, err
	}
	confirmations := int64(0)
	if tx.BlockNum > 0 && overview.Height >= tx.BlockNum {
		confirmations = int64(overview.Height - tx.BlockNum + 1)
	}
	if tx.Amount <= 0 || tx.Amount > (1<<63-1)/AmountScale {
		return ChainTransfer{}, fmt.Errorf("chain amount cannot be represented by the venue's six-decimal ledger")
	}
	return ChainTransfer{Hash: tx.Hash, From: tx.From, To: tx.To, AmountMicro: tx.Amount * AmountScale, Confirmations: confirmations, Committed: tx.BlockNum > 0}, nil
}

func (r IndexerChainReader) AccountBalance(address string) (ChainBalance, error) {
	client := r.Client
	if client == nil {
		client = http.DefaultClient
	}
	base := strings.TrimRight(r.BaseURL, "/")
	var account struct {
		Address string `json:"address"`
		Balance int64  `json:"balance"`
	}
	if err := getJSON(client, base+"/accounts/"+url.PathEscape(address), &account); err != nil {
		return ChainBalance{}, err
	}
	var overview struct {
		Height uint64 `json:"height"`
	}
	if err := getJSON(client, base+"/ynx/overview", &overview); err != nil {
		return ChainBalance{}, err
	}
	if account.Balance < 0 || account.Balance > (1<<63-1)/AmountScale {
		return ChainBalance{}, fmt.Errorf("chain balance cannot be represented by the venue's six-decimal ledger")
	}
	return ChainBalance{Address: address, Asset: NativeAsset, AmountMicro: account.Balance * AmountScale, CommittedHeight: overview.Height, Source: base + "/accounts/{custody}"}, nil
}
func getJSON(client *http.Client, url string, out any) error {
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("chain endpoint returned %s", resp.Status)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}
