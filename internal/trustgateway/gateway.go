package trustgateway

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const (
	MaxBodyBytes     = 1 << 20
	MaxResponseBytes = 2 << 20
)

type Config struct {
	ChainURL    string
	APIKey      string
	UpstreamKey string
	AuditLog    string
	Window      time.Duration
	MaxRequests int
}

func (c Config) normalized() (Config, error) {
	c.ChainURL = strings.TrimRight(strings.TrimSpace(c.ChainURL), "/")
	parsed, err := url.Parse(c.ChainURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return Config{}, fmt.Errorf("YNX_TRUST_GATEWAY_CHAIN_URL must be an absolute http(s) URL")
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return Config{}, fmt.Errorf("YNX_TRUST_API_KEY is required for ynx-trustd")
	}
	if strings.TrimSpace(c.UpstreamKey) == "" {
		return Config{}, fmt.Errorf("YNX_TRUST_GATEWAY_UPSTREAM_KEY is required for ynx-trustd")
	}
	if c.AuditLog == "" {
		c.AuditLog = "tmp/trust-gateway/audit.jsonl"
	}
	if c.Window <= 0 {
		c.Window = time.Minute
	}
	if c.MaxRequests <= 0 {
		c.MaxRequests = 60
	}
	return c, nil
}

type Service struct {
	cfg         Config
	httpClient  *http.Client
	mu          sync.Mutex
	seen        map[string][]time.Time
	requests    int64
	successes   int64
	denied      int64
	errors      int64
	active      int64
	auditErrors int64
}

func New(cfg Config) (*Service, error) {
	normalized, err := cfg.normalized()
	if err != nil {
		return nil, err
	}
	return &Service{cfg: normalized, httpClient: &http.Client{Timeout: 30 * time.Second}, seen: map[string][]time.Time{}}, nil
}

type chainStatus struct {
	ChainID              int64  `json:"chainId"`
	Height               uint64 `json:"height"`
	Network              string `json:"network"`
	NativeCurrencySymbol string `json:"nativeCurrencySymbol"`
}

type Health struct {
	OK               bool           `json:"ok"`
	Service          string         `json:"service"`
	ChainID          int64          `json:"chainId,omitempty"`
	Height           uint64         `json:"height,omitempty"`
	Network          string         `json:"network,omitempty"`
	NativeSymbol     string         `json:"nativeSymbol"`
	UpstreamOK       bool           `json:"upstreamOk"`
	RateLimit        string         `json:"rateLimit"`
	BodyLimitBytes   int            `json:"bodyLimitBytes"`
	ExportLimitBytes int            `json:"exportLimitBytes"`
	AuditLog         string         `json:"auditLog"`
	Requests         int64          `json:"requests"`
	Successes        int64          `json:"successes"`
	Denied           int64          `json:"denied"`
	Errors           int64          `json:"errors"`
	Active           int64          `json:"active"`
	AuditErrors      int64          `json:"auditErrors"`
	Build            buildinfo.Info `json:"build"`
	TruthfulStatus   string         `json:"truthfulStatus"`
	Error            string         `json:"error,omitempty"`
}

func (s *Service) Health(ctx context.Context, build buildinfo.Info) Health {
	health := s.snapshotHealth(build)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.ChainURL+"/status", nil)
	if err != nil {
		health.Error = err.Error()
		return health
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		health.Error = err.Error()
		return health
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		health.Error = fmt.Sprintf("chain status returned %d", resp.StatusCode)
		return health
	}
	var status chainStatus
	if err := json.NewDecoder(io.LimitReader(resp.Body, MaxBodyBytes)).Decode(&status); err != nil {
		health.Error = err.Error()
		return health
	}
	health.ChainID, health.Height, health.Network, health.NativeSymbol = status.ChainID, status.Height, status.Network, status.NativeCurrencySymbol
	health.UpstreamOK = status.ChainID > 0 && status.NativeCurrencySymbol == "YNXT"
	health.OK = health.UpstreamOK && health.AuditErrors == 0
	return health
}

func (s *Service) snapshotHealth(build buildinfo.Info) Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Health{
		Service: "ynx-trustd", NativeSymbol: "YNXT", RateLimit: fmt.Sprintf("%d per %s per api-key/ip", s.cfg.MaxRequests, s.cfg.Window),
		BodyLimitBytes: MaxBodyBytes, ExportLimitBytes: MaxResponseBytes, AuditLog: s.cfg.AuditLog,
		Requests: s.requests, Successes: s.successes, Denied: s.denied, Errors: s.errors, Active: s.active, AuditErrors: s.auditErrors,
		Build: buildinfo.Normalize(build), TruthfulStatus: "authenticated-chain-backed-trust-and-chain-law-gateway",
	}
}

func (s *Service) Authorized(value string) bool {
	value = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	return value != "" && equalHash(value, s.cfg.APIKey)
}

func (s *Service) Allow(remoteAddr, accessKey string, now time.Time) bool {
	key := clientIP(remoteAddr) + "|" + hashText(accessKey)
	s.mu.Lock()
	defer s.mu.Unlock()
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
	s.seen[key] = append(kept, now)
	return true
}

type ProxyResponse struct {
	Status      int
	ContentType string
	Body        []byte
}

func (s *Service) Proxy(ctx context.Context, method, path, rawQuery string, body []byte, requestID string) (ProxyResponse, error) {
	target := s.cfg.ChainURL + path
	if rawQuery != "" {
		target += "?" + rawQuery
	}
	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return ProxyResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", requestID)
	req.Header.Set("X-YNX-Trust-Gateway-Upstream-Key", s.cfg.UpstreamKey)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return ProxyResponse{}, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, MaxResponseBytes+1))
	if err != nil {
		return ProxyResponse{}, err
	}
	if len(payload) > MaxResponseBytes {
		return ProxyResponse{}, fmt.Errorf("Trust response or evidence export exceeds %d bytes", MaxResponseBytes)
	}
	return ProxyResponse{Status: resp.StatusCode, ContentType: resp.Header.Get("Content-Type"), Body: payload}, nil
}

type AuditEntry struct {
	RequestID string    `json:"requestId"`
	At        time.Time `json:"at"`
	RemoteIP  string    `json:"remoteIp"`
	Method    string    `json:"method"`
	Path      string    `json:"path"`
	BodyHash  string    `json:"bodyHash,omitempty"`
	Status    int       `json:"status"`
	Outcome   string    `json:"outcome"`
	AuditHash string    `json:"auditHash"`
}

func (s *Service) Audit(entry AuditEntry) error {
	entry.At, entry.RemoteIP = entry.At.UTC(), clientIP(entry.RemoteIP)
	entry.AuditHash = hashText(fmt.Sprintf("%s|%s|%s|%s|%s|%d|%s", entry.RequestID, entry.At.Format(time.RFC3339Nano), entry.Method, entry.Path, entry.BodyHash, entry.Status, entry.Outcome))
	payload, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.cfg.AuditLog), 0o700); err != nil {
		s.auditErrors++
		return err
	}
	f, err := os.OpenFile(s.cfg.AuditLog, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		s.auditErrors++
		return err
	}
	defer f.Close()
	if _, err := f.Write(append(payload, '\n')); err != nil {
		s.auditErrors++
		return err
	}
	return nil
}

func (s *Service) StartRequest()  { s.mu.Lock(); s.requests++; s.active++; s.mu.Unlock() }
func (s *Service) RejectRequest() { s.mu.Lock(); s.requests++; s.denied++; s.mu.Unlock() }
func (s *Service) FinishRequest(status int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.active--
	if status >= 200 && status < 400 {
		s.successes++
	} else if status >= 500 {
		s.errors++
	} else {
		s.denied++
	}
}

func NewRequestID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("trust-%d", time.Now().UnixNano())
	}
	return "trust-" + hex.EncodeToString(buf)
}
func BodyHash(body []byte) string { return hashText(string(body)) }
func hashText(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func equalHash(a, b string) bool {
	aHash, bHash := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(aHash[:], bHash[:]) == 1
}
func clientIP(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}
