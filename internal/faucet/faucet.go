package faucet

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

var (
	ynxAddressPattern = regexp.MustCompile(`^ynx_[a-zA-Z0-9_]{3,80}$`)
	evmAddressPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
)

type Config struct {
	RPCURL        string
	HTTPAddr      string
	FaucetKey     string
	DefaultAmount int64
	MaxAmount     int64
	Window        time.Duration
	MaxRequests   int
	RequestLog    string
}

func (c Config) normalized() (Config, error) {
	if strings.TrimSpace(c.RPCURL) == "" {
		return Config{}, fmt.Errorf("faucet RPC URL is required")
	}
	if strings.TrimSpace(c.FaucetKey) == "" {
		return Config{}, fmt.Errorf("FAUCET_PRIVATE_KEY is required for ynx-faucetd")
	}
	if c.DefaultAmount <= 0 {
		c.DefaultAmount = 100
	}
	if c.MaxAmount <= 0 {
		c.MaxAmount = c.DefaultAmount
	}
	if c.DefaultAmount > c.MaxAmount {
		return Config{}, fmt.Errorf("default faucet amount cannot exceed max amount")
	}
	if c.Window <= 0 {
		c.Window = time.Hour
	}
	if c.MaxRequests <= 0 {
		c.MaxRequests = 1
	}
	if c.RequestLog == "" {
		c.RequestLog = "tmp/faucet/requests.jsonl"
	}
	return c, nil
}

type Service struct {
	cfg        Config
	httpClient *http.Client
	mu         sync.Mutex
	seen       map[string][]time.Time
	requests   int64
	successes  int64
	denied     int64
	lastHash   string
	lastError  string
}

func New(cfg Config) (*Service, error) {
	normalized, err := cfg.normalized()
	if err != nil {
		return nil, err
	}
	return &Service{cfg: normalized, httpClient: &http.Client{Timeout: 10 * time.Second}, seen: map[string][]time.Time{}}, nil
}

type Request struct {
	Address string `json:"address"`
	Amount  int64  `json:"amount,omitempty"`
}

type Response struct {
	Transaction    chain.Transaction `json:"transaction"`
	Address        string            `json:"address"`
	Amount         int64             `json:"amount"`
	NativeSymbol   string            `json:"nativeSymbol"`
	RequestID      string            `json:"requestId"`
	TruthfulStatus string            `json:"truthfulStatus"`
}

type LogEntry struct {
	RequestID string    `json:"requestId"`
	At        time.Time `json:"at"`
	IP        string    `json:"ip"`
	Address   string    `json:"address"`
	Amount    int64     `json:"amount"`
	Status    string    `json:"status"`
	TxHash    string    `json:"txHash,omitempty"`
	Error     string    `json:"error,omitempty"`
}

func (s *Service) Request(ctx context.Context, req Request, remoteAddr string) (Response, int, error) {
	requestID := requestID()
	ip := clientIP(remoteAddr)
	amount := req.Amount
	if amount == 0 {
		amount = s.cfg.DefaultAmount
	}
	entry := LogEntry{RequestID: requestID, At: time.Now().UTC(), IP: ip, Address: req.Address, Amount: amount}
	s.mu.Lock()
	s.requests++
	s.mu.Unlock()
	if !ValidAddress(req.Address) {
		entry.Status = "rejected"
		entry.Error = "invalid address"
		_ = s.appendLog(entry)
		s.recordDenied(entry.Error)
		return Response{}, http.StatusBadRequest, fmt.Errorf("invalid address")
	}
	if amount <= 0 || amount > s.cfg.MaxAmount {
		entry.Status = "rejected"
		entry.Error = "amount exceeds faucet limits"
		_ = s.appendLog(entry)
		s.recordDenied(entry.Error)
		return Response{}, http.StatusBadRequest, fmt.Errorf("amount exceeds faucet limits")
	}
	if !s.allow(ip, req.Address, entry.At) {
		entry.Status = "rate_limited"
		entry.Error = "faucet rate limit exceeded"
		_ = s.appendLog(entry)
		s.recordDenied(entry.Error)
		return Response{}, http.StatusTooManyRequests, fmt.Errorf("faucet rate limit exceeded")
	}
	tx, err := s.callRPC(ctx, req.Address, amount)
	if err != nil {
		entry.Status = "error"
		entry.Error = err.Error()
		_ = s.appendLog(entry)
		s.mu.Lock()
		s.lastError = err.Error()
		s.mu.Unlock()
		return Response{}, http.StatusBadGateway, err
	}
	entry.Status = "sent"
	entry.TxHash = tx.Hash
	_ = s.appendLog(entry)
	s.mu.Lock()
	s.successes++
	s.lastHash = tx.Hash
	s.lastError = ""
	s.mu.Unlock()
	return Response{Transaction: tx, Address: req.Address, Amount: amount, NativeSymbol: "YNXT", RequestID: requestID, TruthfulStatus: "rpc-backed-faucet"}, http.StatusCreated, nil
}

func ValidAddress(address string) bool {
	address = strings.TrimSpace(address)
	return ynxAddressPattern.MatchString(address) || evmAddressPattern.MatchString(address)
}

func (s *Service) allow(ip, address string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := ip + "|" + strings.ToLower(address)
	cutoff := now.Add(-s.cfg.Window)
	kept := s.seen[key][:0]
	for _, at := range s.seen[key] {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	if len(kept) >= s.cfg.MaxRequests {
		s.seen[key] = kept
		return false
	}
	kept = append(kept, now)
	s.seen[key] = kept
	return true
}

func (s *Service) callRPC(ctx context.Context, address string, amount int64) (chain.Transaction, error) {
	body, err := json.Marshal(Request{Address: address, Amount: amount})
	if err != nil {
		return chain.Transaction{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.cfg.RPCURL, "/")+"/faucet", bytes.NewReader(body))
	if err != nil {
		return chain.Transaction{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Faucet-Auth", "configured")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return chain.Transaction{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errorBody map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&errorBody)
		return chain.Transaction{}, fmt.Errorf("RPC faucet returned %d: %v", resp.StatusCode, errorBody)
	}
	var tx chain.Transaction
	if err := json.NewDecoder(resp.Body).Decode(&tx); err != nil {
		return chain.Transaction{}, err
	}
	if tx.Hash == "" {
		return chain.Transaction{}, fmt.Errorf("RPC faucet returned empty transaction hash")
	}
	return tx, nil
}

func (s *Service) appendLog(entry LogEntry) error {
	if s.cfg.RequestLog == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.cfg.RequestLog), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(s.cfg.RequestLog, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	payload, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	_, err = f.Write(append(payload, '\n'))
	return err
}

func (s *Service) recordDenied(reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.denied++
}

type Health struct {
	OK             bool           `json:"ok"`
	Service        string         `json:"service"`
	RPCURL         string         `json:"rpcUrl"`
	UpstreamOK     bool           `json:"upstreamOk"`
	ChainID        int64          `json:"chainId,omitempty"`
	Height         uint64         `json:"height,omitempty"`
	NativeSymbol   string         `json:"nativeSymbol"`
	DefaultAmount  int64          `json:"defaultAmount"`
	MaxAmount      int64          `json:"maxAmount"`
	RateLimit      string         `json:"rateLimit"`
	RequestLog     string         `json:"requestLog"`
	Requests       int64          `json:"requests"`
	Successes      int64          `json:"successes"`
	Denied         int64          `json:"denied"`
	LastTxHash     string         `json:"lastTxHash,omitempty"`
	LastError      string         `json:"lastError,omitempty"`
	Build          buildinfo.Info `json:"build"`
	TruthfulStatus string         `json:"truthfulStatus"`
}

func (s *Service) Health() Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Health{
		OK:             s.lastError == "",
		Service:        "ynx-faucetd",
		RPCURL:         s.cfg.RPCURL,
		NativeSymbol:   "YNXT",
		DefaultAmount:  s.cfg.DefaultAmount,
		MaxAmount:      s.cfg.MaxAmount,
		RateLimit:      fmt.Sprintf("%d per %s per ip/address", s.cfg.MaxRequests, s.cfg.Window),
		RequestLog:     s.cfg.RequestLog,
		Requests:       s.requests,
		Successes:      s.successes,
		Denied:         s.denied,
		LastTxHash:     s.lastHash,
		LastError:      s.lastError,
		TruthfulStatus: "rpc-backed-faucet",
	}
}

type rpcStatus struct {
	ChainID              int64  `json:"chainId"`
	Height               uint64 `json:"height"`
	NativeCurrencySymbol string `json:"nativeCurrencySymbol"`
}

func (s *Service) CheckHealth(ctx context.Context) Health {
	health := s.Health()
	var status rpcStatus
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(s.cfg.RPCURL, "/")+"/status", nil)
	if err != nil {
		health.OK = false
		health.LastError = err.Error()
		return health
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		health.OK = false
		health.LastError = err.Error()
		return health
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		health.OK = false
		health.LastError = fmt.Sprintf("RPC status returned %d", resp.StatusCode)
		return health
	}
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		health.OK = false
		health.LastError = err.Error()
		return health
	}
	health.UpstreamOK = status.NativeCurrencySymbol == "YNXT"
	health.ChainID = status.ChainID
	health.Height = status.Height
	if !health.UpstreamOK {
		health.OK = false
		health.LastError = "RPC native symbol is not YNXT"
	}
	return health
}

func (s *Service) Metrics() string {
	h := s.Health()
	labels := `native_symbol="YNXT"`
	return fmt.Sprintf(`# HELP ynx_faucet_requests_total Requests received by ynx-faucetd.
# TYPE ynx_faucet_requests_total counter
ynx_faucet_requests_total{%s} %d
# HELP ynx_faucet_success_total Successful faucet transactions.
# TYPE ynx_faucet_success_total counter
ynx_faucet_success_total{%s} %d
# HELP ynx_faucet_denied_total Rejected or rate-limited faucet requests.
# TYPE ynx_faucet_denied_total counter
ynx_faucet_denied_total{%s} %d
`, labels, h.Requests, labels, h.Successes, labels, h.Denied)
}

func requestID() string {
	return fmt.Sprintf("faucet_%d", time.Now().UnixNano())
}

func clientIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil {
		return host
	}
	if remoteAddr == "" {
		return "unknown"
	}
	return remoteAddr
}
