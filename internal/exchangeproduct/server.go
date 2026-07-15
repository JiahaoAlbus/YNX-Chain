package exchangeproduct

import (
	"encoding/json"
	"errors"
	"fmt"
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
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("GET /v1/config", s.config)
	s.mux.HandleFunc("GET /v1/markets", s.markets)
	s.mux.HandleFunc("GET /v1/orderbook", s.book)
	s.mux.HandleFunc("POST /v1/auth/challenges", s.challenge)
	s.mux.HandleFunc("POST /v1/auth/sessions", s.session)
	s.mux.HandleFunc("GET /v1/account", s.account)
	s.mux.HandleFunc("POST /v1/deposits", s.deposit)
	s.mux.HandleFunc("POST /v1/deposits/{id}/refresh", s.refreshDeposit)
	s.mux.HandleFunc("POST /v1/withdrawals/review", s.withdrawal)
	s.mux.HandleFunc("POST /v1/orders", s.order)
	s.mux.HandleFunc("POST /v1/orders/{id}/cancel", s.cancel)
	s.mux.HandleFunc("PUT /v1/security", s.security)
	s.mux.HandleFunc("POST /v1/support", s.support)
	s.mux.HandleFunc("POST /v1/ai/drafts", s.ai)
	s.mux.HandleFunc("POST /v1/ai/drafts/{id}/actions", s.aiAction)
	s.mux.HandleFunc("POST /v1/admin/test-credits", s.testCredits)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	s.mux.ServeHTTP(w, r)
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"status": "ok", "product": "YNX Exchange", "venue": "owned deterministic testnet only", "chainId": ChainID, "productionCustody": false})
}
func (s *Server) config(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"chainId": ChainID, "evmChainId": EVMChainID, "nativeAsset": NativeAsset, "custodyAddress": s.service.state.CustodyAddress, "networks": s.service.Networks(), "warnings": []string{"Not an exchange listing", "Not production custody", "No third-party liquidity, price, volume or market depth"}})
}
func (s *Server) markets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"markets": Markets(), "source": "YNX-owned deterministic order state only"})
}
func (s *Server) book(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.service.Book()) }
func (s *Server) challenge(w http.ResponseWriter, r *http.Request) {
	var q struct {
		Account  string   `json:"account"`
		DeviceID string   `json:"deviceId"`
		Scopes   []string `json:"scopes"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.CreateChallenge(q.Account, q.DeviceID, q.Scopes)
	respond(w, v, err, 201)
}
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	var q CompleteSessionRequest
	if !decode(w, r, &q) {
		return
	}
	v, token, err := s.service.CompleteSession(q)
	if err != nil {
		respond(w, nil, err, 201)
		return
	}
	writeJSON(w, 201, map[string]any{"session": v, "token": token})
}
func (s *Server) account(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:read")
	if !ok {
		return
	}
	writeJSON(w, 200, s.service.Snapshot(session.Account))
}
func (s *Server) deposit(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	var q struct {
		TxHash         string `json:"txHash"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decode(w, r, &q) {
		return
	}
	v, err := s.service.ObserveDeposit(session, q.TxHash, q.IdempotencyKey)
	respond(w, v, err, 201)
}
func (s *Server) refreshDeposit(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:trade")
	if !ok {
		return
	}
	v, err := s.service.RefreshDeposit(session, r.PathValue("id"))
	respond(w, v, err, 200)
}
func (s *Server) withdrawal(w http.ResponseWriter, r *http.Request) {
	session, ok := s.auth(w, r, "exchange:withdraw")
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
func (s *Server) auth(w http.ResponseWriter, r *http.Request, scope string) (WalletSession, bool) {
	v, err := s.service.Authenticate(r.Header.Get("Authorization"), scope)
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
		writeJSON(w, 400, map[string]string{"error": "invalid JSON request: " + err.Error()})
		return false
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, 400, map[string]string{"error": "request must contain one JSON value"})
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
	switch {
	case errors.Is(err, ErrInvalid):
		status = 400
	case errors.Is(err, ErrUnauthorized):
		status = 401
	case errors.Is(err, ErrForbidden):
		status = 403
	case errors.Is(err, ErrNotFound):
		status = 404
	case errors.Is(err, ErrConflict):
		status = 409
	case errors.Is(err, ErrInsufficient):
		status = 422
	case errors.Is(err, ErrUnavailable):
		status = 503
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
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
