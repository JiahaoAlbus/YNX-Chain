package api

import (
	"encoding/hex"
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
	s.mux.HandleFunc("POST /evm", s.handleEVM)
	s.mux.HandleFunc("POST /", s.handleEVM)
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
	s.mux.HandleFunc("GET /monitoring/health", s.handleMonitoring)
}

func (s *Server) withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-YNX-Network", s.devnet.Config().Slug)
		w.Header().Set("X-YNX-Truthful-Status", "local-devnet")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "ynx-chaind", "network": s.devnet.Config(), "timestamp": time.Now().UTC()})
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
	writeJSON(w, http.StatusOK, map[string]any{"account": account, "resources": resources, "trace": trace})
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
		From, To string
		Amount   int64
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
	session, query := r.URL.Query().Get("session"), r.URL.Query().Get("q")
	if session == "" || query == "" {
		writeError(w, http.StatusBadRequest, "session and q are required")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	status := s.devnet.Status()
	chunks := []string{fmt.Sprintf("session %s", session), fmt.Sprintf("query: %s", query), fmt.Sprintf("network: %s", status["network"]), fmt.Sprintf("latest height: %v", status["height"]), "AI actions that move value require explicit user confirmation and scoped permissions."}
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
func (s *Server) handleMonitoring(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "height": s.devnet.LatestBlock().Height, "service": "ynx-monitoring-local"})
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id"`
	Method  string `json:"method"`
	Params  []any  `json:"params"`
}
type rpcResponse struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id"`
	Result  any    `json:"result,omitempty"`
	Error   any    `json:"error,omitempty"`
}

func (s *Server) handleEVM(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "EVM JSON-RPC requires POST")
		return
	}
	var req rpcRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	result, err := s.evmResult(req.Method, req.Params)
	resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
	if err != nil {
		resp.Error = map[string]any{"code": -32601, "message": err.Error()}
	} else {
		resp.Result = result
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) evmResult(method string, params []any) (any, error) {
	cfg, latest := s.devnet.Config(), s.devnet.LatestBlock()
	switch method {
	case "eth_chainId":
		return hexQuantity(uint64(cfg.ChainID)), nil
	case "net_version":
		return fmt.Sprint(cfg.ChainID), nil
	case "eth_blockNumber":
		return hexQuantity(latest.Height), nil
	case "eth_getBalance":
		if len(params) == 0 {
			return "0x0", nil
		}
		addr, _ := params[0].(string)
		acct, ok := s.devnet.Account(addr)
		if !ok {
			return "0x0", nil
		}
		return hexQuantity(uint64(acct.Balance)), nil
	case "eth_getBlockByNumber":
		return evmBlock(latest, len(s.devnet.RecentTransactions(100))), nil
	case "eth_getBlockByHash":
		return evmBlock(latest, len(s.devnet.RecentTransactions(100))), nil
	case "eth_getTransactionByHash":
		if len(params) == 0 {
			return nil, nil
		}
		tx, ok := s.devnet.Transaction(fmt.Sprint(params[0]))
		if !ok {
			return nil, nil
		}
		return evmTx(tx), nil
	case "eth_getTransactionReceipt":
		if len(params) == 0 {
			return nil, nil
		}
		tx, ok := s.devnet.Transaction(fmt.Sprint(params[0]))
		if !ok {
			return nil, nil
		}
		return map[string]any{"transactionHash": tx.Hash, "status": "0x1", "blockHash": tx.BlockHash, "blockNumber": hexQuantity(tx.BlockNum), "gasUsed": "0x5208", "logs": []any{}}, nil
	case "eth_sendRawTransaction":
		if len(params) == 0 || fmt.Sprint(params[0]) == "" {
			return nil, fmt.Errorf("raw transaction parameter is required")
		}
		tx, err := s.devnet.Faucet("0xraw_tx_sink", 1)
		if err != nil {
			return nil, err
		}
		s.devnet.ProduceBlock()
		return tx.Hash, nil
	case "eth_estimateGas":
		return "0x5208", nil
	case "eth_call":
		return "0x", nil
	case "eth_getLogs":
		return []any{}, nil
	default:
		return nil, fmt.Errorf("method %s is not implemented by the local YNX devnet RPC", method)
	}
}

func evmBlock(block chain.Block, txCount int) map[string]any {
	return map[string]any{"number": hexQuantity(block.Height), "hash": "0x" + trim0x(block.Hash), "parentHash": "0x" + trim0x(block.ParentHash), "timestamp": hexQuantity(uint64(block.Time.Unix())), "transactions": []any{}, "transactionsRoot": "0x" + strings.Repeat("0", 64), "stateRoot": "0x" + strings.Repeat("0", 64), "receiptsRoot": "0x" + strings.Repeat("0", 64), "miner": "0x0000000000000000000000000000000000000000", "gasUsed": "0x0", "gasLimit": "0x1c9c380", "transactionCount": txCount}
}
func evmTx(tx chain.Transaction) map[string]any {
	return map[string]any{"hash": tx.Hash, "from": tx.From, "to": tx.To, "value": hexQuantity(uint64(tx.Amount)), "nonce": hexQuantity(tx.Nonce), "blockHash": tx.BlockHash, "blockNumber": hexQuantity(tx.BlockNum), "gas": "0x5208", "gasPrice": "0x1"}
}
func hexQuantity(v uint64) string { return "0x" + strconv.FormatUint(v, 16) }
func trim0x(v string) string {
	v = strings.TrimPrefix(v, "0x")
	if v == "" {
		return strings.Repeat("0", 64)
	}
	if _, err := hex.DecodeString(v); err != nil {
		return fmt.Sprintf("%064x", v)
	}
	return v
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
	result := compileResult{Name: name, TruthfulNote: "Local devnet source preflight only. Production Solidity compilation must wire a pinned compiler."}
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
