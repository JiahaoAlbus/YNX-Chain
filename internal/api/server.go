package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type Server struct {
	devnet *chain.Devnet
	mux    *http.ServeMux
}

func NewServer(devnet *chain.Devnet) http.Handler {
	s := &Server{devnet: devnet, mux: http.NewServeMux()}
	s.routes()
	return s.withHeaders(s.mux)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /status", s.handleStatus)
	s.mux.HandleFunc("GET /blocks/latest", s.handleLatestBlock)
	s.mux.HandleFunc("GET /blocks/{height}", s.handleBlockByHeight)
	s.mux.HandleFunc("GET /accounts/{address}", s.handleAccount)
	s.mux.HandleFunc("GET /validators", s.handleValidators)
	s.mux.HandleFunc("GET /txs", s.handleRecentTransactions)
	s.mux.HandleFunc("GET /txs/{hash}", s.handleTransaction)
	s.mux.HandleFunc("GET /explorer/summary", s.handleExplorerSummary)
	s.mux.HandleFunc("POST /faucet", s.handleFaucet)
	s.mux.HandleFunc("POST /transfer", s.handleTransfer)
	s.mux.HandleFunc("POST /staking/stake", s.handleStake)
	s.mux.HandleFunc("GET /resources/{address}", s.handleResources)
	s.mux.HandleFunc("GET /trust/trace/{address}", s.handleTrustTrace)
	s.mux.HandleFunc("POST /pay/intents", s.handlePayIntent)
	s.mux.HandleFunc("GET /ai/stream", s.handleAIStream)
	s.mux.HandleFunc("POST /ide/compile", s.handleIDECompile)
}

func (s *Server) withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-YNX-Network", s.devnet.Config().Slug)
		w.Header().Set("X-YNX-Truthful-Status", "local-devnet")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"service":   "ynx-chaind",
		"network":   s.devnet.Config(),
		"timestamp": time.Now().UTC(),
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.devnet.Status())
}

func (s *Server) handleLatestBlock(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.devnet.LatestBlock())
}

func (s *Server) handleBlockByHeight(w http.ResponseWriter, r *http.Request) {
	height, err := strconv.ParseUint(r.PathValue("height"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid block height")
		return
	}
	block, ok := s.devnet.BlockByHeight(height)
	if !ok {
		writeError(w, http.StatusNotFound, "block not found")
		return
	}
	writeJSON(w, http.StatusOK, block)
}

func (s *Server) handleTransaction(w http.ResponseWriter, r *http.Request) {
	tx, ok := s.devnet.Transaction(r.PathValue("hash"))
	if !ok {
		writeError(w, http.StatusNotFound, "transaction not found")
		return
	}
	writeJSON(w, http.StatusOK, tx)
}

func (s *Server) handleRecentTransactions(w http.ResponseWriter, r *http.Request) {
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid limit")
			return
		}
		limit = parsed
	}
	writeJSON(w, http.StatusOK, map[string]any{"transactions": s.devnet.RecentTransactions(limit)})
}

func (s *Server) handleAccount(w http.ResponseWriter, r *http.Request) {
	account, ok := s.devnet.Account(r.PathValue("address"))
	if !ok {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}
	resources, _ := s.devnet.Resources(account.Address)
	trace, _ := s.devnet.TrustTrace(account.Address)
	writeJSON(w, http.StatusOK, map[string]any{
		"account":   account,
		"resources": resources,
		"trace":     trace,
	})
}

func (s *Server) handleValidators(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"validators": s.devnet.Validators()})
}

func (s *Server) handleExplorerSummary(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.devnet.ExplorerSummary())
}

func (s *Server) handleFaucet(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Address string `json:"address"`
		Amount  int64  `json:"amount"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	tx, err := s.devnet.Faucet(req.Address, req.Amount)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, tx)
}

func (s *Server) handleTransfer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		From   string `json:"from"`
		To     string `json:"to"`
		Amount int64  `json:"amount"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	tx, err := s.devnet.Transfer(req.From, req.To, req.Amount)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, tx)
}

func (s *Server) handleStake(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Address string `json:"address"`
		Amount  int64  `json:"amount"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	tx, resources, err := s.devnet.Stake(req.Address, req.Amount)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"transaction": tx, "resources": resources})
}

func (s *Server) handleResources(w http.ResponseWriter, r *http.Request) {
	resources, err := s.devnet.Resources(r.PathValue("address"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resources)
}

func (s *Server) handleTrustTrace(w http.ResponseWriter, r *http.Request) {
	trace, err := s.devnet.TrustTrace(r.PathValue("address"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, trace)
}

func (s *Server) handlePayIntent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Merchant    string `json:"merchant"`
		Amount      int64  `json:"amount"`
		CallbackURL string `json:"callbackUrl"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	intent, err := s.devnet.CreatePayIntent(req.Merchant, req.Amount, req.CallbackURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, intent)
}

func (s *Server) handleAIStream(w http.ResponseWriter, r *http.Request) {
	session := r.URL.Query().Get("session")
	query := r.URL.Query().Get("q")
	if session == "" || query == "" {
		writeError(w, http.StatusBadRequest, "session and q are required")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	status := s.devnet.Status()
	chunks := []string{
		fmt.Sprintf("session %s", session),
		fmt.Sprintf("query: %s", query),
		fmt.Sprintf("network: %s", status["network"]),
		fmt.Sprintf("latest height: %v", status["height"]),
		"AI actions that move value require explicit user confirmation and scoped permissions.",
	}
	for _, chunk := range chunks {
		_, _ = fmt.Fprintf(w, "event: token\ndata: %s\n\n", sanitizeSSE(chunk))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		time.Sleep(10 * time.Millisecond)
	}
	_, _ = fmt.Fprint(w, "event: done\ndata: ok\n\n")
}

func (s *Server) handleIDECompile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Source string `json:"source"`
		Name   string `json:"name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	result := preflightContract(req.Name, req.Source)
	status := http.StatusOK
	if !result.OK {
		status = http.StatusBadRequest
	}
	writeJSON(w, status, result)
}

type compileResult struct {
	OK           bool     `json:"ok"`
	Name         string   `json:"name"`
	BytecodeHash string   `json:"bytecodeHash,omitempty"`
	Warnings     []string `json:"warnings,omitempty"`
	Errors       []string `json:"errors,omitempty"`
	TruthfulNote string   `json:"truthfulNote"`
}

func preflightContract(name, source string) compileResult {
	result := compileResult{
		Name:         name,
		TruthfulNote: "Local devnet source preflight only. Production Solidity compilation must wire a pinned compiler.",
	}
	trimmed := strings.TrimSpace(source)
	if trimmed == "" {
		result.Errors = append(result.Errors, "source is required")
		return result
	}
	if !strings.Contains(trimmed, "contract ") {
		result.Errors = append(result.Errors, "source must contain a Solidity contract declaration")
		return result
	}
	if !strings.Contains(trimmed, "pragma solidity") {
		result.Warnings = append(result.Warnings, "missing pragma solidity declaration")
	}
	result.OK = true
	result.BytecodeHash = fmt.Sprintf("devnet-preflight-%x", len(trimmed))
	return result
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dest any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": message})
}

func sanitizeSSE(value string) string {
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	return value
}
