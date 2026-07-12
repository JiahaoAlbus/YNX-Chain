package aigateway

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

const maxBodyBytes = 2 << 20
const (
	UpstreamAuthoritative = "authoritative"
	UpstreamBFT           = "bft"
)

type Config struct {
	ChainURL       string
	ProviderURL    string
	ProviderAPIKey string
	Model          string
	AccessAPIKey   string
	UpstreamKey    string
	AuditLog       string
	Window         time.Duration
	MaxRequests    int
	UpstreamMode   string
	SignerKey      string
	SignerKeyPath  string
	SignerAddress  string
	ChainID        int64
}

func (c Config) normalized() (Config, error) {
	c.ChainURL = strings.TrimRight(strings.TrimSpace(c.ChainURL), "/")
	c.ProviderURL = strings.TrimRight(strings.TrimSpace(c.ProviderURL), "/")
	if c.ChainURL == "" {
		return Config{}, fmt.Errorf("YNX_AI_GATEWAY_CHAIN_URL is required")
	}
	if err := validServiceURL(c.ChainURL, true); err != nil {
		return Config{}, fmt.Errorf("invalid YNX_AI_GATEWAY_CHAIN_URL: %w", err)
	}
	if c.ProviderURL == "" {
		return Config{}, fmt.Errorf("YNX_AI_PROVIDER_URL is required")
	}
	if err := validServiceURL(c.ProviderURL, false); err != nil {
		return Config{}, fmt.Errorf("invalid YNX_AI_PROVIDER_URL: %w", err)
	}
	if strings.TrimSpace(c.ProviderAPIKey) == "" {
		return Config{}, fmt.Errorf("OPENAI_API_KEY is required for ynx-ai-gatewayd")
	}
	if strings.TrimSpace(c.AccessAPIKey) == "" {
		return Config{}, fmt.Errorf("YNX_AI_GATEWAY_API_KEY is required for ynx-ai-gatewayd")
	}
	c.UpstreamMode = strings.ToLower(strings.TrimSpace(c.UpstreamMode))
	if c.UpstreamMode == "" {
		c.UpstreamMode = UpstreamAuthoritative
	}
	if c.UpstreamMode != UpstreamAuthoritative && c.UpstreamMode != UpstreamBFT {
		return Config{}, fmt.Errorf("AI Gateway upstream mode must be %q or %q", UpstreamAuthoritative, UpstreamBFT)
	}
	if c.UpstreamMode == UpstreamAuthoritative && strings.TrimSpace(c.UpstreamKey) == "" {
		return Config{}, fmt.Errorf("YNX_AI_GATEWAY_UPSTREAM_KEY is required for ynx-ai-gatewayd")
	}
	if c.UpstreamMode == UpstreamBFT {
		if (strings.TrimSpace(c.SignerKey) == "") == (strings.TrimSpace(c.SignerKeyPath) == "") {
			return Config{}, fmt.Errorf("BFT AI Gateway requires exactly one signer key source")
		}
		if !consensus.IsNativeAddress(strings.TrimSpace(c.SignerAddress)) {
			return Config{}, fmt.Errorf("BFT AI Gateway requires canonical YNX_AI_GATEWAY_SIGNER_ADDRESS")
		}
		if c.ChainID == 0 {
			c.ChainID = 6423
		}
		if c.ChainID != 6423 {
			return Config{}, fmt.Errorf("BFT AI Gateway chain ID must equal 6423")
		}
	}
	if strings.TrimSpace(c.Model) == "" {
		return Config{}, fmt.Errorf("AI_MODEL_NAME is required for ynx-ai-gatewayd")
	}
	if c.AuditLog == "" {
		c.AuditLog = "tmp/ai-gateway/audit.jsonl"
	}
	if c.Window <= 0 {
		c.Window = time.Minute
	}
	if c.MaxRequests <= 0 {
		c.MaxRequests = 30
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
	errors     int64
	active     int64
	signer     *secp256k1.PrivateKey
	signerAddr string
	mutationMu sync.Mutex
}

func New(cfg Config) (*Service, error) {
	normalized, err := cfg.normalized()
	if err != nil {
		return nil, err
	}
	service := &Service{
		cfg:        normalized,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		seen:       map[string][]time.Time{},
	}
	if normalized.UpstreamMode == UpstreamBFT {
		signer, address, err := loadBFTSigner(normalized)
		if err != nil {
			return nil, err
		}
		service.signer, service.signerAddr = signer, address
		service.cfg.SignerKey = ""
	}
	return service, nil
}

func loadBFTSigner(cfg Config) (*secp256k1.PrivateKey, string, error) {
	var keyBytes []byte
	if path := strings.TrimSpace(cfg.SignerKeyPath); path != "" {
		info, err := os.Stat(path)
		if err != nil {
			return nil, "", fmt.Errorf("stat BFT AI Gateway signer key: %w", err)
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return nil, "", errors.New("BFT AI Gateway signer key file must be regular and mode-restricted")
		}
		keyBytes, err = os.ReadFile(path)
		if err != nil {
			return nil, "", fmt.Errorf("read BFT AI Gateway signer key: %w", err)
		}
	} else {
		var err error
		keyBytes, err = hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(cfg.SignerKey), "0x"))
		if err != nil {
			return nil, "", errors.New("BFT AI Gateway signer key must be canonical hex")
		}
	}
	defer clear(keyBytes)
	if len(keyBytes) != 32 || bytes.Equal(keyBytes, make([]byte, 32)) {
		return nil, "", errors.New("BFT AI Gateway signer key must be one non-zero 32-byte scalar")
	}
	privateKey := secp256k1.PrivKeyFromBytes(keyBytes)
	if !bytes.Equal(privateKey.Serialize(), keyBytes) {
		return nil, "", errors.New("BFT AI Gateway signer key scalar is outside the canonical range")
	}
	address, err := consensus.NativeAddress(privateKey.PubKey().SerializeCompressed())
	if err != nil {
		return nil, "", err
	}
	if address != strings.TrimSpace(cfg.SignerAddress) {
		return nil, "", errors.New("BFT AI Gateway configured signer address does not match private key")
	}
	return privateKey, address, nil
}

type ChainStatus struct {
	ChainID              int64  `json:"chainId"`
	Height               uint64 `json:"height"`
	Network              string `json:"network"`
	NativeCurrencySymbol string `json:"nativeCurrencySymbol"`
}

type Health struct {
	OK                 bool           `json:"ok"`
	Service            string         `json:"service"`
	ChainID            int64          `json:"chainId,omitempty"`
	Height             uint64         `json:"height,omitempty"`
	Network            string         `json:"network,omitempty"`
	NativeSymbol       string         `json:"nativeSymbol"`
	UpstreamOK         bool           `json:"upstreamOk"`
	ProviderConfigured bool           `json:"providerConfigured"`
	Model              string         `json:"model"`
	RateLimit          string         `json:"rateLimit"`
	AuditLog           string         `json:"auditLog"`
	Requests           int64          `json:"requests"`
	Successes          int64          `json:"successes"`
	Denied             int64          `json:"denied"`
	Errors             int64          `json:"errors"`
	Active             int64          `json:"active"`
	Build              buildinfo.Info `json:"build"`
	TruthfulStatus     string         `json:"truthfulStatus"`
	Error              string         `json:"error,omitempty"`
	UpstreamMode       string         `json:"upstreamMode"`
	SignerAddress      string         `json:"signerAddress,omitempty"`
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
	var status ChainStatus
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBodyBytes)).Decode(&status); err != nil {
		health.Error = err.Error()
		return health
	}
	health.ChainID = status.ChainID
	health.Height = status.Height
	health.Network = status.Network
	health.NativeSymbol = status.NativeCurrencySymbol
	health.UpstreamOK = status.ChainID > 0 && status.NativeCurrencySymbol == "YNXT"
	health.OK = health.UpstreamOK && health.ProviderConfigured
	return health
}

func (s *Service) snapshotHealth(build buildinfo.Info) Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	truthfulStatus := "chain-context-and-provider-backed-ai-gateway"
	if s.cfg.UpstreamMode == UpstreamBFT {
		truthfulStatus = "signed-bft-application-action-and-provider-backed-ai-gateway"
	}
	return Health{
		Service:            "ynx-ai-gatewayd",
		NativeSymbol:       "YNXT",
		ProviderConfigured: s.cfg.ProviderAPIKey != "" && s.cfg.ProviderURL != "" && s.cfg.Model != "",
		Model:              s.cfg.Model,
		RateLimit:          fmt.Sprintf("%d per %s per api-key/ip", s.cfg.MaxRequests, s.cfg.Window),
		AuditLog:           s.cfg.AuditLog,
		Requests:           s.requests,
		Successes:          s.successes,
		Denied:             s.denied,
		Errors:             s.errors,
		Active:             s.active,
		Build:              buildinfo.Normalize(build),
		TruthfulStatus:     truthfulStatus,
		UpstreamMode:       s.cfg.UpstreamMode,
		SignerAddress:      s.signerAddr,
	}
}

func (s *Service) Authorized(value string) bool {
	value = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	return value != "" && equalHash(value, s.cfg.AccessAPIKey)
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

type providerRequest struct {
	Model    string            `json:"model"`
	Messages []providerMessage `json:"messages"`
}

type providerMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type providerResponse struct {
	Choices []struct {
		Message providerMessage `json:"message"`
	} `json:"choices"`
}

func (s *Service) Complete(ctx context.Context, session, query, requestID string) (string, error) {
	status, err := s.chainStatus(ctx)
	if err != nil {
		return "", err
	}
	payload := providerRequest{
		Model: s.cfg.Model,
		Messages: []providerMessage{
			{Role: "system", Content: "You are the YNX Chain AI Gateway. Explain public chain state only. Never request, store, or reveal private keys or seed phrases. Never execute transfers, approvals, freezes, Trust labels, or evidence exports. Sensitive actions require the separate YNX permission and action-review APIs."},
			{Role: "system", Content: fmt.Sprintf("Request ID %s. Session %s. Current network %s, chain ID %d, height %d, native asset YNXT.", requestID, session, status.Network, status.ChainID, status.Height)},
			{Role: "user", Content: query},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.ProviderURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.ProviderAPIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", requestID)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("AI provider returned %d", resp.StatusCode)
	}
	var result providerResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBodyBytes)).Decode(&result); err != nil {
		return "", err
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("AI provider returned no content")
	}
	return result.Choices[0].Message.Content, nil
}

func (s *Service) chainStatus(ctx context.Context) (ChainStatus, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.ChainURL+"/status", nil)
	if err != nil {
		return ChainStatus{}, err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return ChainStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ChainStatus{}, fmt.Errorf("chain status returned %d", resp.StatusCode)
	}
	var status ChainStatus
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBodyBytes)).Decode(&status); err != nil {
		return ChainStatus{}, err
	}
	if status.ChainID <= 0 || status.NativeCurrencySymbol != "YNXT" {
		return ChainStatus{}, fmt.Errorf("chain status identity mismatch")
	}
	return status, nil
}

func (s *Service) Proxy(ctx context.Context, method, path, rawQuery string, body io.Reader, requestID string) (*http.Response, error) {
	if s.cfg.UpstreamMode == UpstreamBFT && method == http.MethodPost {
		return s.proxyBFTMutation(ctx, path, body, requestID)
	}
	url := s.cfg.ChainURL + path
	if rawQuery != "" {
		url += "?" + rawQuery
	}
	req, err := http.NewRequestWithContext(ctx, method, url, io.LimitReader(body, maxBodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", requestID)
	if s.cfg.UpstreamMode == UpstreamAuthoritative {
		req.Header.Set("X-YNX-AI-Gateway-Upstream-Key", s.cfg.UpstreamKey)
	}
	return s.httpClient.Do(req)
}

func (s *Service) proxyBFTMutation(ctx context.Context, path string, body io.Reader, requestID string) (*http.Response, error) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	if s.signer == nil || s.signerAddr == "" {
		return nil, errors.New("BFT AI Gateway signer is unavailable")
	}
	raw, err := io.ReadAll(io.LimitReader(body, maxBodyBytes+1))
	if err != nil || len(raw) > maxBodyBytes {
		return nil, errors.New("AI mutation request exceeds maximum size")
	}
	actionType, payload, err := signedActionInput(path, raw)
	if err != nil {
		return nil, err
	}
	account, err := s.bftSignerAccount(ctx)
	if err != nil {
		return nil, err
	}
	if account.Nonce == math.MaxUint64 {
		return nil, errors.New("BFT AI Gateway signer nonce is exhausted")
	}
	signed, err := consensus.NewSignedApplicationAction(s.signer, s.cfg.ChainID, actionType, payload, account.Nonce+1)
	if err != nil {
		return nil, err
	}
	encoded, err := consensus.EncodeSignedApplicationAction(signed)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.ChainURL+path, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", requestID)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp, nil
	}
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes+1))
	_ = resp.Body.Close()
	if err != nil || len(responseBody) > maxBodyBytes {
		return nil, errors.New("BFT AI Gateway upstream response exceeds maximum size")
	}
	if err := verifyBFTMutationResponse(actionType, signed, responseBody); err != nil {
		return nil, err
	}
	resp.Body = io.NopCloser(bytes.NewReader(responseBody))
	resp.ContentLength = int64(len(responseBody))
	return resp, nil
}

func (s *Service) bftSignerAccount(ctx context.Context) (chain.ConsensusAccount, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.ChainURL+"/accounts/"+s.signerAddr, nil)
	if err != nil {
		return chain.ConsensusAccount{}, err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return chain.ConsensusAccount{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return chain.ConsensusAccount{}, fmt.Errorf("BFT AI signer account query returned %d", resp.StatusCode)
	}
	var account chain.ConsensusAccount
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBodyBytes)).Decode(&account); err != nil {
		return chain.ConsensusAccount{}, err
	}
	if account.Address != s.signerAddr {
		return chain.ConsensusAccount{}, errors.New("BFT AI signer account response mismatch")
	}
	return account, nil
}

func signedActionInput(path string, raw []byte) (string, any, error) {
	decode := func(out any) error {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(out); err != nil {
			return err
		}
		if decoder.Decode(&struct{}{}) != io.EOF {
			return errors.New("AI mutation must contain one JSON value")
		}
		return nil
	}
	switch {
	case path == "/ai/permissions":
		var input chain.AIPermissionInput
		if err := decode(&input); err != nil {
			return "", nil, err
		}
		if input.ExpiryHours <= 0 {
			input.ExpiryHours = 1
		}
		return consensus.ActionAIPermissionCreate, consensus.AIPermissionPayload(input), nil
	case path == "/ai/actions":
		var input chain.AIActionProposalInput
		if err := decode(&input); err != nil {
			return "", nil, err
		}
		if input.ExpiryHours <= 0 {
			input.ExpiryHours = 1
		}
		return consensus.ActionAIProposalCreate, consensus.AIActionProposalPayload(input), nil
	case strings.HasPrefix(path, "/ai/actions/") && strings.HasSuffix(path, "/approve"):
		var input chain.AIActionApprovalInput
		if err := decode(&input); err != nil {
			return "", nil, err
		}
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/ai/actions/"), "/approve")
		return consensus.ActionAIProposalApprove, consensus.AIActionDecisionPayload{ActionID: id, Approver: input.Approver, PermissionID: input.PermissionID}, nil
	case strings.HasPrefix(path, "/ai/actions/") && strings.HasSuffix(path, "/reject"):
		var input chain.AIActionApprovalInput
		if err := decode(&input); err != nil {
			return "", nil, err
		}
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/ai/actions/"), "/reject")
		return consensus.ActionAIProposalReject, consensus.AIActionDecisionPayload{ActionID: id, Approver: input.Approver}, nil
	default:
		return "", nil, errors.New("unsupported BFT AI mutation route")
	}
}

func verifyBFTMutationResponse(actionType string, signed consensus.SignedApplicationAction, raw []byte) error {
	if actionType == consensus.ActionAIPermissionCreate {
		var record consensus.BFTAIPermission
		if err := json.Unmarshal(raw, &record); err != nil {
			return err
		}
		expectedID := consensus.ApplicationActionRecordID("ai-permission", consensus.ApplicationActionHash(mustEncodeAction(signed)))
		if record.ID != expectedID || record.Signer != signed.Signer || record.TxHash != consensus.ApplicationActionHash(mustEncodeAction(signed)) || record.Status != "active" {
			return errors.New("BFT AI permission response mismatch")
		}
		return nil
	}
	var record consensus.BFTAIAction
	if err := json.Unmarshal(raw, &record); err != nil {
		return err
	}
	if record.Signer != signed.Signer || record.TxHash != consensus.ApplicationActionHash(mustEncodeAction(signed)) {
		return errors.New("BFT AI action response mismatch")
	}
	if actionType == consensus.ActionAIProposalCreate {
		expectedID := consensus.ApplicationActionRecordID("ai-action", consensus.ApplicationActionHash(mustEncodeAction(signed)))
		if record.ID != expectedID {
			return errors.New("BFT AI proposal response ID mismatch")
		}
	}
	if actionType == consensus.ActionAIProposalApprove && (record.Status != "approved" || !record.Executable) {
		return errors.New("BFT AI approval response state mismatch")
	}
	if actionType == consensus.ActionAIProposalReject && (record.Status != "rejected" || record.Executable) {
		return errors.New("BFT AI rejection response state mismatch")
	}
	return nil
}

func mustEncodeAction(tx consensus.SignedApplicationAction) []byte {
	payload, _ := consensus.EncodeSignedApplicationAction(tx)
	return payload
}

type AuditEntry struct {
	RequestID  string    `json:"requestId"`
	At         time.Time `json:"at"`
	RemoteIP   string    `json:"remoteIp"`
	Method     string    `json:"method"`
	Path       string    `json:"path"`
	SessionID  string    `json:"sessionId,omitempty"`
	PromptHash string    `json:"promptHash,omitempty"`
	Status     int       `json:"status"`
	Outcome    string    `json:"outcome"`
	AuditHash  string    `json:"auditHash"`
}

func (s *Service) Audit(entry AuditEntry) error {
	entry.At = entry.At.UTC()
	entry.RemoteIP = clientIP(entry.RemoteIP)
	entry.AuditHash = hashText(fmt.Sprintf("%s|%s|%s|%s|%s|%d|%s", entry.RequestID, entry.At.Format(time.RFC3339Nano), entry.Method, entry.Path, entry.SessionID, entry.Status, entry.Outcome))
	payload, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.cfg.AuditLog), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(s.cfg.AuditLog, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(payload, '\n'))
	return err
}

func (s *Service) StartRequest() {
	s.mu.Lock()
	s.requests++
	s.active++
	s.mu.Unlock()
}

func (s *Service) RejectRequest() {
	s.mu.Lock()
	s.requests++
	s.denied++
	s.mu.Unlock()
}

func (s *Service) FinishRequest(status int) {
	s.mu.Lock()
	s.active--
	if status >= 200 && status < 400 {
		s.successes++
	} else if status >= 500 {
		s.errors++
	} else {
		s.denied++
	}
	s.mu.Unlock()
}

func NewRequestID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("ai-%d", time.Now().UnixNano())
	}
	return "ai-" + hex.EncodeToString(buf)
}

func PromptHash(prompt string) string { return hashText(prompt) }

func hashText(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func equalHash(a, b string) bool {
	aHash := sha256.Sum256([]byte(a))
	bHash := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(aHash[:], bHash[:]) == 1
}

func clientIP(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}

func validServiceURL(raw string, allowInternalHTTP bool) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return fmt.Errorf("absolute URL is required")
	}
	if parsed.Scheme == "https" {
		return nil
	}
	if parsed.Scheme != "http" {
		return fmt.Errorf("URL scheme must be http or https")
	}
	host := strings.ToLower(parsed.Hostname())
	ip := net.ParseIP(host)
	if allowInternalHTTP || host == "localhost" || (ip != nil && ip.IsLoopback()) {
		return nil
	}
	return fmt.Errorf("non-loopback AI provider URL must use https")
}
